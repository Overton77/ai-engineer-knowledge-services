import type { ArtifactLedger } from "@aiengineer/knowledge-db-read";
import type { PromotionSelectionArtifact, PromotionSelectionPorts } from "@aiengineer/knowledge-persistence";
import type { ArtifactStore } from "@aiengineer/knowledge-runtime";
import type { PromotionSelectionProgress, PromotionSelectionReference } from "@aiengineer/knowledge-application";
import type { CanonicalEvidenceReader } from "../evidence-reader.js";
import { startWorker, type RunningWorker } from "../../../worker/src/index.js";
import {
  composePromotionSelectionWorkerHost,
  createCanonicalPromotionSelectionApplication,
  parsePromotionSelectionAuthorityLocator,
  PromotionSelectionAuthorityLocatorSchema,
  type CanonicalPromotionSelectionConfiguration,
  type ComposedPromotionSelectionHost,
} from "../../../worker/src/promotion-selection.js";
import { createPromotionSelectionPorts } from "./promotion-selection.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface PromotionSelectionHostPins {
  readonly tenantId: string;
  readonly policyDigest: string;
  readonly artifacts: ArtifactLedger;
  readonly artifactStores: Readonly<Record<string, ArtifactStore>>;
  readonly evidence: CanonicalEvidenceReader;
  readonly measure: PromotionSelectionPorts["measure"];
  readonly authorityArtifact: PromotionSelectionArtifact;
}

export type PromotionSelectionAdvance = (input: {
  readonly selection: unknown;
  readonly artifact: PromotionSelectionReference;
}) => Promise<PromotionSelectionProgress>;

function requireHostCompositionPins(pins: PromotionSelectionHostPins): void {
  if (typeof pins.measure !== "function" || !pins.artifacts || !pins.evidence || !pins.artifactStores)
    throw new Error("PROMOTION_SELECTION_HOST_PINS_REQUIRED");
}

function requireMatchingAuthorityLocator(
  locator: PromotionSelectionArtifact | undefined,
  authorityArtifact: PromotionSelectionArtifact,
): void {
  if (!locator) return;
  if (locator.id === authorityArtifact.id && locator.digest === authorityArtifact.digest) return;
  throw new Error("PROMOTION_SELECTION_AUTHORITY_LOCATOR_MISMATCH");
}

/**
 * Executor composition for selected promotion. Ports stay here; the worker
 * receives only the already-composed authority. Tenant, run pin, policy,
 * budget and reviewer are read from independently registered authority bytes.
 */
export function composePromotionSelectionHost(pins: PromotionSelectionHostPins): ComposedPromotionSelectionHost {
  requireHostCompositionPins(pins);
  return composePromotionSelectionWorkerHost({
    ports: createPromotionSelectionPorts(pins),
    authorityArtifact: PromotionSelectionAuthorityLocatorSchema.parse(pins.authorityArtifact),
  });
}

/**
 * Minimal public progress interface: `{ selection, artifact }`.
 * `complete` is prepare/embed/index, not publication. Canonical operations
 * own scheduling; this only reconciles the pinned selection.
 */
export function createPromotionSelectionAdvance(
  configuration: CanonicalPromotionSelectionConfiguration,
): PromotionSelectionAdvance {
  const application = createCanonicalPromotionSelectionApplication(configuration);
  return (input) => application.advance(input);
}

/** The host that starts a selection worker. Missing authority fails before poll. */
export async function startPromotionSelectionWorker(input: {
  readonly environment: Environment;
  readonly pins: PromotionSelectionHostPins;
}): Promise<RunningWorker> {
  const workerTenant = input.environment.WORKER_TENANT_ID?.trim();
  if (!workerTenant) throw new Error("WORKER_TENANT_ID_REQUIRED");
  if (workerTenant !== input.pins.tenantId) throw new Error("PROMOTION_SELECTION_HOST_TENANT_MISMATCH");
  requireMatchingAuthorityLocator(
    parsePromotionSelectionAuthorityLocator(input.environment),
    input.pins.authorityArtifact,
  );
  return startWorker(input.environment, composePromotionSelectionHost(input.pins));
}
