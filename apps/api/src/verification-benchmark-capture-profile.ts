import { ActorSchema, OperationContextSchema, UuidSchema, type OperationContext } from "@aiengineer/knowledge-contracts";
import { actorsMatch, isAuthorized, type LocalApiIdentity } from "@aiengineer/knowledge-config";
import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { z } from "zod";
import { createVerificationOwnershipResolver } from "./verification-ownership.js";

const profileSchema = z.strictObject({
  profileName: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
  tenantId: UuidSchema,
  actor: ActorSchema,
  missionId: UuidSchema,
  workItemId: UuidSchema,
  attemptId: UuidSchema,
});

type Profile = z.infer<typeof profileSchema>;
type OwnershipResolver = ReturnType<typeof createVerificationOwnershipResolver>;

/**
 * Resolves a named deployment profile to existing canonical ownership.
 * Profile contents never originate in a CLI request; bearer identity remains
 * the authority for both actor and tenant action access.
 */
export class ServerOwnedBenchmarkCaptureProfileResolver {
  readonly #profiles: readonly Profile[];
  readonly #ownership: OwnershipResolver;

  constructor(
    database: Pick<PostgresCanonicalRepository, "transaction">,
    rawProfiles: string,
    rawOwnershipGrants: string,
  ) {
    if (Buffer.byteLength(rawProfiles) > 262_144) throw new Error("VERIFICATION_BENCHMARK_CLI_PROFILE_CONFIG_TOO_LARGE");
    const profiles = z.array(profileSchema).min(1).max(256).parse(JSON.parse(rawProfiles));
    const names = new Set<string>();
    for (const profile of profiles) {
      if (names.has(profile.profileName)) throw new Error("DUPLICATE_VERIFICATION_BENCHMARK_CLI_PROFILE");
      names.add(profile.profileName);
    }
    this.#profiles = Object.freeze(profiles.map(profile => Object.freeze({ ...profile })));
    this.#ownership = createVerificationOwnershipResolver(database, rawOwnershipGrants);
  }

  async resolve(
    profileName: string,
    authenticatedIdentity: LocalApiIdentity,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<OperationContext | undefined> {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(profileName)) return undefined;
    const profile = this.#profiles.find(candidate => candidate.profileName === profileName);
    if (!profile || !actorsMatch(profile.actor, authenticatedIdentity.actor)
      || !isAuthorized(authenticatedIdentity, profile.tenantId, "operation.submit")) return undefined;
    const resolved = await this.#ownership({
      tenantId: profile.tenantId,
      identity: authenticatedIdentity,
      correlationId,
      idempotencyKey,
      useCase: "captureSource",
      hints: { attemptId: profile.attemptId, missionId: profile.missionId, workItemId: profile.workItemId },
    });
    return resolved === undefined ? undefined : OperationContextSchema.parse(resolved);
  }
}

export function createVerificationBenchmarkCaptureProfileResolver(
  database: Pick<PostgresCanonicalRepository, "transaction">,
  rawProfiles: string,
  rawOwnershipGrants: string,
) {
  const resolver = new ServerOwnedBenchmarkCaptureProfileResolver(database, rawProfiles, rawOwnershipGrants);
  return (input: { readonly profileName: string; readonly identity: LocalApiIdentity; readonly correlationId: string; readonly idempotencyKey: string }) =>
    resolver.resolve(input.profileName, input.identity, input.correlationId, input.idempotencyKey);
}
