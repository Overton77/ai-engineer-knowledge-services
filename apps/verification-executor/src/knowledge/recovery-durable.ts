import { DurableVerificationRecoveryService, type DurableRecoveryEvidenceAuthority } from "@aiengineer/knowledge-application";
import { PostgresDurableVerificationRecoveryStore, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import type { ArtifactCustody } from "../store-custody.js";
import type { FilesystemStore } from "../store.js";
import { createDurableRecoveryCheckpoints } from "./recovery-durable-checkpoints.js";
import { createDurableRecoveryCustody } from "./recovery-durable-custody.js";
import { createDurableRecoveryRuntime } from "./recovery-durable-runtime.js";

/** Compose with the host's existing clients and authenticated owners; their lifecycle stays with the host. */
export function createDurableRecoveryServices(input: {
  database: PostgresCanonicalRepository;
  store: FilesystemStore;
  custody: ArtifactCustody;
  evidence: DurableRecoveryEvidenceAuthority;
  checkpoints: Parameters<typeof createDurableRecoveryCheckpoints>[0];
  runtime: Omit<Parameters<typeof createDurableRecoveryRuntime>[0], "store" | "database">;
}) {
  const persistence = new PostgresDurableVerificationRecoveryStore(input.database);
  const custody = createDurableRecoveryCustody(input.store, input.custody);
  const checkpoints = createDurableRecoveryCheckpoints(input.checkpoints);
  const runtime = createDurableRecoveryRuntime({ ...input.runtime, store: persistence, database: input.database });
  const service = new DurableVerificationRecoveryService(persistence, input.evidence, custody, runtime, checkpoints);
  return { service, persistence };
}
