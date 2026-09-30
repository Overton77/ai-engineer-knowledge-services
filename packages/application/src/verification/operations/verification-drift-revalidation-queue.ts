import { z } from "zod";
import { VerificationArtifactHandleSchema } from "@aiengineer/knowledge-contracts";
import { createEd25519Verifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import type { compareVerifiedComponentVersions } from "./verification-component-drift.js";
import { parseBenchmarkReadPublicKeys } from "./verification-read-public-keys.js";

const identities = z
  .array(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/))
  .min(1)
  .max(32)
  .refine((value) => new Set(value).size === value.length, "duplicate service identity");
const monitors = z
  .array(
    z.strictObject({
      tenantId: z.uuid(),
      baseline: VerificationArtifactHandleSchema,
      candidate: VerificationArtifactHandleSchema,
    }),
  )
  .min(1)
  .max(100)
  .refine(
    (value) => value.every((row) => row.baseline.tenantId === row.tenantId && row.candidate.tenantId === row.tenantId),
    "monitor tenant mismatch",
  );

type CompareComponents = typeof compareVerifiedComponentVersions;

export interface ComponentDriftPublisher {
  publishComponentObservation(input: Awaited<ReturnType<CompareComponents>>): Promise<"planned" | "already_planned">;
}

export interface ComponentDriftDependencies {
  forTenant(tenantId: string): Readonly<{
    publisher: ComponentDriftPublisher;
    createResolver: () => TrustedArtifactResolver;
  }>;
}

/** Durable drift revalidation outbox; implemented by persistence. */
export interface VerificationDriftRevalidationOutbox {
  scanModelObservations(tenantId: string, limit: number): Promise<{ planned: number; alreadyPlanned: number }>;
  claim(
    tenantId: string,
    owner: string,
    limit: number,
    visibilityTimeoutMs: number,
  ): Promise<
    readonly {
      id: string;
      observationArtifactId: string;
      sourceOperationId: string;
      dimensions: readonly string[];
      disposition: "revalidate" | "review_required";
      reviewReason?: string;
      claimToken: string;
    }[]
  >;
  ack(tenantId: string, id: string, owner: string, claimToken: string): Promise<void>;
  listPublishedReviewAlerts(
    tenantId: string,
    limit: number,
  ): Promise<
    readonly {
      id: string;
      observationArtifactId: string;
      sourceOperationId: string;
      dimensions: readonly string[];
      reviewReason: string;
      publishedAt: string;
    }[]
  >;
}

/**
 * Server-configured, bounded component comparison and durable review planning.
 * The configured service-identity allowlist is the consumer authority; transports
 * additionally require an explicit tenant scope before calling any queue method.
 */
export function createVerificationDriftRevalidationQueue(input: {
  readonly serviceIdentitiesJson: string;
  readonly outbox: VerificationDriftRevalidationOutbox;
  readonly compareComponents: CompareComponents;
  readonly componentMonitorsJson?: string | undefined;
  readonly componentPublicKeysJson?: string | undefined;
  readonly component?: ComponentDriftDependencies | undefined;
}) {
  const { outbox, component, compareComponents } = input;
  const serviceIdentities = identities.parse(JSON.parse(input.serviceIdentitiesJson));
  if (Boolean(input.componentMonitorsJson) !== Boolean(input.componentPublicKeysJson))
    throw new Error("VERIFICATION_COMPONENT_DRIFT_MONITOR_CONFIG_INCOMPLETE");
  const componentMonitors = input.componentMonitorsJson ? monitors.parse(JSON.parse(input.componentMonitorsJson)) : [];
  if (componentMonitors.length > 0 && !component) throw new Error("VERIFICATION_COMPONENT_DRIFT_PUBLISHER_REQUIRED");
  const verifier = input.componentPublicKeysJson
    ? createEd25519Verifier(parseBenchmarkReadPublicKeys(input.componentPublicKeysJson))
    : undefined;
  // The configured monitor set is capped at 100, so this per-tenant cursor remains bounded.
  const monitorCursors = new Map<string, number>();

  return {
    serviceIdentities,
    async scan(request: { tenantId: string; limit: number }) {
      const model = await outbox.scanModelObservations(request.tenantId, request.limit);
      let componentPlanned = 0;
      let componentAlreadyPlanned = 0;
      const remaining = Math.max(0, request.limit - model.planned - model.alreadyPlanned);
      const tenantMonitors = componentMonitors.filter((row) => row.tenantId === request.tenantId);
      const count = Math.min(remaining, tenantMonitors.length);
      let cursor = monitorCursors.get(request.tenantId) ?? 0;

      for (let offset = 0; offset < count; offset += 1) {
        const pair = tenantMonitors[cursor]!;
        const port = component!.forTenant(request.tenantId);
        const observation = await compareComponents({
          baseline: { artifact: pair.baseline },
          candidate: { artifact: pair.candidate },
          createResolver: port.createResolver,
          verifier: verifier!,
        });
        // A failed comparison is retried; successfully evaluated pairs cannot starve.
        cursor = (cursor + 1) % tenantMonitors.length;
        if (observation.changedDimensions.length > 0) {
          const published = await port.publisher.publishComponentObservation(observation);
          if (published === "planned") componentPlanned += 1;
          else componentAlreadyPlanned += 1;
        }
      }
      if (count > 0) monitorCursors.set(request.tenantId, cursor);
      return {
        planned: model.planned + componentPlanned,
        alreadyPlanned: model.alreadyPlanned + componentAlreadyPlanned,
      };
    },
    claim: (request: { tenantId: string; owner: string; limit: number; visibilityTimeoutMs: number }) =>
      outbox.claim(request.tenantId, request.owner, request.limit, request.visibilityTimeoutMs),
    ack: (request: { tenantId: string; id: string; owner: string; claimToken: string }) =>
      outbox.ack(request.tenantId, request.id, request.owner, request.claimToken),
    listAlerts: (request: { tenantId: string; limit: number }) =>
      outbox.listPublishedReviewAlerts(request.tenantId, request.limit),
  };
}
