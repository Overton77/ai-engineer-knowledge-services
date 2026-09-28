import {
  createVerificationOperationReadAuthorizer,
  createVerificationOwnershipResolver as createOwnedResolver,
  isVerifiedEveRuntimeRetry,
  type ResolveVerificationContext,
  type VerificationOwnershipResolverOptions,
  type VerificationOwnershipStore,
} from "@aiengineer/knowledge-application";
import {
  resolveEveVerificationBinding,
  type PostgresCanonicalRepository,
} from "@aiengineer/knowledge-persistence";

export { createVerificationOperationReadAuthorizer, isVerifiedEveRuntimeRetry };

/** Binds the application ownership resolver to the Eve persistence adapter. */
export function createVerificationOwnershipResolver(
  database: VerificationOwnershipStore,
  rawGrants: string,
  options: Omit<VerificationOwnershipResolverOptions, "resolveEveBinding"> = {},
): ResolveVerificationContext {
  return createOwnedResolver(database, rawGrants, {
    ...options,
    resolveEveBinding: (envelope) =>
      resolveEveVerificationBinding(
        database as PostgresCanonicalRepository,
        envelope,
      ),
  });
}
