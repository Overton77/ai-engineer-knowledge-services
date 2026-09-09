import { z } from "zod";
import { SemanticJudgeIdentitySchema, VerificationArtifactHandleSchema } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { deepFreeze } from "@aiengineer/knowledge-domain";

export const SemanticJudgeProfileSchema = z.strictObject({ schemaVersion: z.literal("verification-semantic-judge-profile.v1"), identity: SemanticJudgeIdentitySchema });
const grantSchema = z.strictObject({ tenantId: z.uuid(), operationId: z.uuid(), host: z.enum(["claims","report"]), role: z.enum(["primary","cross_family"]), profileArtifact: VerificationArtifactHandleSchema, identity: SemanticJudgeIdentitySchema });
export type SemanticJudgeProfileGrant = z.infer<typeof grantSchema>;

/** Server-owned grants bind exact profile bytes and judge roles to a single operation. */
export class SemanticJudgeProfileCatalog {
  readonly #grants = new Map<string, readonly SemanticJudgeProfileGrant[]>();
  constructor(values: readonly SemanticJudgeProfileGrant[]) {
    if (values.length > 512) throw new Error("SEMANTIC_PROFILE_GRANT_LIMIT");
    const grouped = new Map<string, SemanticJudgeProfileGrant[]>();
    for (const value of values) {
      const grant = grantSchema.parse(value);
      if (grant.tenantId !== grant.profileArtifact.tenantId) throw new Error("SEMANTIC_PROFILE_TENANT_MISMATCH");
      const key = `${grant.tenantId}:${grant.operationId}:${grant.host}`, group = grouped.get(key) ?? [];
      if (group.some(item => item.role === grant.role || item.profileArtifact.artifactId === grant.profileArtifact.artifactId || item.identity.deploymentId === grant.identity.deploymentId)) throw new Error("SEMANTIC_PROFILE_GRANT_DUPLICATE");
      group.push(grant); grouped.set(key,group);
    }
    for (const [key,group] of grouped) {
      if (!group.some(item => item.role === "primary") || (group.length === 2 && group[0]!.identity.family === group[1]!.identity.family)) throw new Error("SEMANTIC_PROFILE_JUDGE_SEPARATION_REQUIRED");
      this.#grants.set(key,deepFreeze(group.sort((a,b) => a.role === b.role ? 0 : a.role === "primary" ? -1 : 1)));
    }
  }
  resolve(tenantId: string, operationId: string, host: "claims" | "report"): readonly SemanticJudgeProfileGrant[] {
    const grants = this.#grants.get(`${tenantId}:${operationId}:${host}`);
    if (!grants) throw new Error("SEMANTIC_PROFILE_GRANT_REQUIRED");
    return grants;
  }
  async hydrate(grantValue: SemanticJudgeProfileGrant, resolver: TrustedArtifactResolver) {
    const requested = grantSchema.parse(grantValue), grant = this.resolve(requested.tenantId,requested.operationId,requested.host).find(item => item.role === requested.role);
    if (!grant || canonicalizeJson(grant) !== canonicalizeJson(requested)) throw new Error("SEMANTIC_PROFILE_GRANT_MISMATCH");
    const handle = grant.profileArtifact;
    if (handle.byteLength > 32_000) throw new Error("SEMANTIC_PROFILE_TOO_LARGE");
    await resolver.authorizeArtifact({tenantId:grant.tenantId,artifactId:handle.artifactId,purpose:"verification_admission"});
    const loaded = await resolver.hydrateRegisteredArtifact({tenantId:grant.tenantId,artifactId:handle.artifactId});
    if (canonicalizeJson(loaded.registration) !== canonicalizeJson(handle) || loaded.bytes.byteLength !== handle.byteLength || sha256Digest(loaded.bytes) !== handle.digest) throw new Error("SEMANTIC_PROFILE_ARTIFACT_MISMATCH");
    const text = new TextDecoder("utf-8",{fatal:true}).decode(loaded.bytes), profile = SemanticJudgeProfileSchema.parse(JSON.parse(text));
    if (text !== canonicalizeJson(profile) || canonicalizeJson(profile.identity) !== canonicalizeJson(grant.identity)) throw new Error("SEMANTIC_PROFILE_IDENTITY_MISMATCH");
    return deepFreeze({profile,artifact:handle,role:grant.role});
  }
}


export function parseSemanticJudgeProfileCatalog(value: string): SemanticJudgeProfileCatalog {
  if (value.length > 1_048_576) throw new Error("SEMANTIC_PROFILE_CONFIGURATION_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("SEMANTIC_PROFILE_CONFIGURATION_INVALID"); }
  return new SemanticJudgeProfileCatalog(z.array(grantSchema).min(1).max(512).parse(parsed));
}
