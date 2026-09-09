import { z } from "zod";
import { VerificationArtifactHandleSchema } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresVerificationDriftRevalidationOutbox } from "@aiengineer/knowledge-persistence";
import { compareVerifiedComponentVersions } from "@aiengineer/knowledge-application";
import { createEd25519Verifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { parseBenchmarkReadPublicKeys } from "./verification-benchmark-reads-runtime.js";

const identities = z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)).min(1).max(32)
  .refine(value => new Set(value).size === value.length, "duplicate service identity");
const monitors = z.array(z.strictObject({
  tenantId: z.uuid(), baseline: VerificationArtifactHandleSchema, candidate: VerificationArtifactHandleSchema,
})).min(1).max(100).refine(value => value.every(row =>
  row.baseline.tenantId === row.tenantId && row.candidate.tenantId === row.tenantId,
), "monitor tenant mismatch");

export interface ComponentDriftPublisher {
  publishComponentObservation(input: Awaited<ReturnType<typeof compareVerifiedComponentVersions>>): Promise<"planned" | "already_planned">;
}

export interface ComponentDriftDependencies {
  forTenant(tenantId: string): Readonly<{
    publisher: ComponentDriftPublisher;
    createResolver: () => TrustedArtifactResolver;
  }>;
}

/** Server-configured, bounded component comparison and durable review planning. */
export function createVerificationDriftRevalidationRuntime(
  database: PostgresCanonicalRepository,
  raw: string,
  componentMonitorsRaw?: string,
  publicKeysRaw?: string,
  component?: ComponentDriftDependencies,
) {
  const serviceIdentities = identities.parse(JSON.parse(raw));
  const outbox = new PostgresVerificationDriftRevalidationOutbox(database);
  if (Boolean(componentMonitorsRaw) !== Boolean(publicKeysRaw)) throw new Error("VERIFICATION_COMPONENT_DRIFT_MONITOR_CONFIG_INCOMPLETE");
  const componentMonitors = componentMonitorsRaw ? monitors.parse(JSON.parse(componentMonitorsRaw)) : [];
  if (componentMonitors.length > 0 && !component) throw new Error("VERIFICATION_COMPONENT_DRIFT_PUBLISHER_REQUIRED");
  const verifier = publicKeysRaw ? createEd25519Verifier(parseBenchmarkReadPublicKeys(publicKeysRaw)) : undefined;
  // The configured monitor set is capped at 100, so this per-tenant cursor remains bounded.
  const monitorCursors = new Map<string, number>();

  return {
    serviceIdentities,
    async scan(input: { tenantId: string; limit: number }) {
      const model = await outbox.scanModelObservations(input.tenantId, input.limit);
      let componentPlanned = 0;
      let componentAlreadyPlanned = 0;
      const remaining = Math.max(0, input.limit - model.planned - model.alreadyPlanned);
      const tenantMonitors = componentMonitors.filter(row => row.tenantId === input.tenantId);
      const count = Math.min(remaining, tenantMonitors.length);
      let cursor = monitorCursors.get(input.tenantId) ?? 0;

      for (let offset = 0; offset < count; offset += 1) {
        const pair = tenantMonitors[cursor]!;
        const port = component!.forTenant(input.tenantId);
        const observation = await compareVerifiedComponentVersions({
          baseline: { artifact: pair.baseline }, candidate: { artifact: pair.candidate },
          createResolver: port.createResolver, verifier: verifier!,
        });
        // A failed comparison is retried; successfully evaluated pairs cannot starve.
        cursor = (cursor + 1) % tenantMonitors.length;
        if (observation.changedDimensions.length > 0) {
          const published = await port.publisher.publishComponentObservation(observation);
          if (published === "planned") componentPlanned += 1;
          else componentAlreadyPlanned += 1;
        }
      }
      if (count > 0) monitorCursors.set(input.tenantId, cursor);
      return { planned: model.planned + componentPlanned, alreadyPlanned: model.alreadyPlanned + componentAlreadyPlanned };
    },
    claim: (input: { tenantId: string; owner: string; limit: number; visibilityTimeoutMs: number }) => outbox.claim(input.tenantId, input.owner, input.limit, input.visibilityTimeoutMs),
    ack: (input: { tenantId: string; id: string; owner: string; claimToken: string }) => outbox.ack(input.tenantId, input.id, input.owner, input.claimToken),
    listAlerts: (input: { tenantId: string; limit: number }) => outbox.listPublishedReviewAlerts(input.tenantId, input.limit),
  };
}