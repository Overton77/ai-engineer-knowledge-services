import type { FastifyInstance } from "fastify";
import type { RouteContext } from "../server.js";
import type { ServerOptionDependencies } from "../http/context.js";
import type { FastifyRequest, FastifyReply } from "fastify";

export interface SystemRouteServices extends Pick<ServerOptionDependencies, "verificationDriftRevalidation"> {}

export function registerSystem(server: FastifyInstance, context: RouteContext): void {
  const { z, options, application, requireAccess, correlationId, problem } = context;
  server.get("/health", async () => ({ status: "ok" }));
  const driftConsumer = async (request: FastifyRequest, reply: FastifyReply) => {
    const scoped = await requireAccess(request, reply, "verification.drift.consume");
    if (!scoped) return;
    const runtime = options.verificationDriftRevalidation;
    if (!runtime) {
      await reply
        .status(503)
        .type("application/problem+json")
        .send(problem(503, "CAPABILITY_NOT_ADMITTED", "Drift consumer unavailable", correlationId(request)));
      return undefined;
    }
    const actor = scoped.identity.actor;
    const explicitScope = scoped.identity.grants.some(
      (grant) => grant.tenantId === scoped.tenant && grant.scopes.includes("verification.drift.consume"),
    );
    if (!explicitScope || actor.kind !== "service" || !runtime.serviceIdentities.includes(actor.serviceIdentity)) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(problem(403, "FORBIDDEN", "Service identity is not admitted", correlationId(request)));
      return undefined;
    }
    return { tenant: scoped.tenant, owner: actor.serviceIdentity, runtime };
  };
  const driftClaimSchema = z.strictObject({
    limit: z.number().int().min(1).max(100),
    visibilityTimeoutMs: z.number().int().min(1000).max(900000),
  });
  const driftAckSchema = z.strictObject({ id: z.uuid(), claimToken: z.uuid() });
  const driftScanSchema = z.strictObject({
    limit: z.number().int().min(1).max(100),
  });
  const driftDimensionSchema = z.enum(["provider", "model", "parser", "grader", "policy"]);
  const driftReasonSchema = z.string().regex(/^[A-Z0-9_]{1,128}$/);
  const driftScanResponseSchema = z.strictObject({
    planned: z.number().int().min(0).max(100),
    alreadyPlanned: z.number().int().min(0).max(100),
  });
  const driftClaimItemSchema = z.object({
    id: z.uuid(),
    observationArtifactId: z.uuid(),
    sourceOperationId: z.uuid(),
    dimensions: z.array(driftDimensionSchema).min(1).max(5),
    disposition: z.literal("review_required"),
    reviewReason: driftReasonSchema,
    claimToken: z.uuid(),
  });
  const driftAlertItemSchema = z.object({
    id: z.uuid(),
    observationArtifactId: z.uuid(),
    sourceOperationId: z.uuid(),
    dimensions: z.array(driftDimensionSchema).min(1).max(5),
    reviewReason: driftReasonSchema,
    publishedAt: z.string().datetime({ offset: true }),
  });
  server.post("/v1/internal/verification/drift-revalidations/scan", async (request, reply) => {
    const scoped = await driftConsumer(request, reply);
    if (!scoped) return;
    const output = driftScanResponseSchema.parse(
      await scoped.runtime.scan({
        tenantId: scoped.tenant,
        ...driftScanSchema.parse(request.body),
      }),
    );
    return { planned: output.planned, alreadyPlanned: output.alreadyPlanned };
  });
  server.post("/v1/internal/verification/drift-revalidations/claim", async (request, reply) => {
    const scoped = await driftConsumer(request, reply);
    if (!scoped) return;
    const items = z
      .array(driftClaimItemSchema)
      .max(100)
      .parse(
        await scoped.runtime.claim({
          tenantId: scoped.tenant,
          owner: scoped.owner,
          ...driftClaimSchema.parse(request.body),
        }),
      );
    return {
      items: items.map((item) => ({
        id: item.id,
        observationArtifactId: item.observationArtifactId,
        sourceOperationId: item.sourceOperationId,
        dimensions: item.dimensions,
        disposition: item.disposition,
        reviewReason: item.reviewReason,
        claimToken: item.claimToken,
      })),
    };
  });
  server.post("/v1/internal/verification/drift-revalidations/ack", async (request, reply) => {
    const scoped = await driftConsumer(request, reply);
    if (!scoped) return;
    const body = driftAckSchema.parse(request.body);
    await scoped.runtime.ack({
      tenantId: scoped.tenant,
      owner: scoped.owner,
      ...body,
    });
    return { acknowledged: true };
  });
  server.get("/v1/internal/verification/drift-alerts", async (request, reply) => {
    const scoped = await driftConsumer(request, reply);
    if (!scoped) return;
    const query = z.strictObject({ limit: z.coerce.number().int().min(1).max(100) }).parse(request.query);
    const items = z
      .array(driftAlertItemSchema)
      .max(100)
      .parse(
        await scoped.runtime.listAlerts({
          tenantId: scoped.tenant,
          ...query,
        }),
      );
    return {
      items: items.map((item) => ({
        id: item.id,
        observationArtifactId: item.observationArtifactId,
        sourceOperationId: item.sourceOperationId,
        dimensions: item.dimensions,
        reviewReason: item.reviewReason,
        publishedAt: item.publishedAt,
      })),
    };
  });
  server.get("/readiness", async () => application.getStatus());
  server.get("/v1/system", async (request, reply) =>
    (await requireAccess(request, reply, "system.read")) ? application.getStatus() : undefined,
  );
}
