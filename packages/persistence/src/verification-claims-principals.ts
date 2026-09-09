import type { VerificationClaimsRuntimePrincipalPort } from "@aiengineer/knowledge-application";
import { PostgresVerificationMetricRuntimePrincipals } from "./verification-metric-principals.js";
import type { PostgresCanonicalRepository } from "./postgres.js";

/** Claims and metrics share the same native artifact -> producer attempt and
 * authenticated context -> verifier attempt ownership joins. No serialized
 * assertion or source-capture producer can choose the verifier identity. */
export class PostgresVerificationClaimsRuntimePrincipals implements VerificationClaimsRuntimePrincipalPort {
  readonly #principals: PostgresVerificationMetricRuntimePrincipals;

  constructor(database: Pick<PostgresCanonicalRepository, "transaction">) {
    this.#principals = new PostgresVerificationMetricRuntimePrincipals(database);
  }

  bind(input: Parameters<VerificationClaimsRuntimePrincipalPort["bind"]>[0]) {
    return this.#principals.bind({
      context: input.context,
      observationsArtifact: input.assertionsArtifact,
      captureIds: input.captureIds,
    });
  }
}
