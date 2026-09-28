import {
  compareVerifiedComponentVersions,
  createVerificationDriftRevalidationQueue,
  type ComponentDriftDependencies,
} from "@aiengineer/knowledge-application";
import { PostgresVerificationDriftRevalidationOutbox, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";

/** Binds the application drift queue to the canonical Postgres outbox. */
export function createVerificationDriftRevalidationRuntime(
  database: PostgresCanonicalRepository,
  raw: string,
  componentMonitorsRaw?: string,
  publicKeysRaw?: string,
  component?: ComponentDriftDependencies,
) {
  return createVerificationDriftRevalidationQueue({
    serviceIdentitiesJson: raw,
    outbox: new PostgresVerificationDriftRevalidationOutbox(database),
    compareComponents: compareVerifiedComponentVersions,
    componentMonitorsJson: componentMonitorsRaw,
    componentPublicKeysJson: publicKeysRaw,
    component,
  });
}
