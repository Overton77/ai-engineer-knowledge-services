import { parseSemanticJudgeProfileCatalog } from "@aiengineer/knowledge-application";
import {
  VerificationAdmissionService,
  VerificationAdjudicationReadService,
  VerificationAuditInspectionGrantCatalog,
  VerificationClaimsProjectionGrantCatalog,
  type VerificationClaimsProjectionGrant,
  type VerificationAdjudicationPacketReplayPort,
} from "@aiengineer/knowledge-application";
import { UuidSchema, type Actor } from "@aiengineer/knowledge-contracts";
import {
  PostgresVerificationAdjudicationReadRepository,
  PostgresVerificationRepository,
  createVerificationAdjudicationRequestService,
  parseVerificationAuditInspectionPublicKeys,
  type PostgresCanonicalRepository,
} from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { createVerificationOperationReadAuthorizer } from "./verification-ownership.js";

type Environment = Readonly<Record<string, string | undefined>>;
type ReadInput = { readonly tenantId: string; readonly operationId: string; readonly actor: Actor };
type ArtifactAuthorityInput = { readonly tenantId: string; readonly purpose: string };

const parserLimits = Object.freeze({ inputBytes: 8_000_000, outputBytes: 4_000_000, timeoutMs: 45_000, memoryBytes: 536_870_912, cpuSeconds: 15, cpus: 1, temporaryBytes: 67_108_864, pages: 40, pids: 32 });

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 120_000) throw new Error("VERIFICATION_ADJUDICATION_READ_TIMEOUT_INVALID");
  return parsed;
}

function parseArray(value: string, code: string): unknown[] {
  if (value.length > 262_144) throw new Error(code);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(code); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 256) throw new Error(code);
  return parsed;
}

export function allowsVerificationAdjudicationReadArtifact(input: ArtifactAuthorityInput, tenantId: string): boolean {
  return input.tenantId === tenantId && ["verification_replay", "policy_replay", "verification_admission"].includes(input.purpose);
}

/** Composes ownership, registered Storage, signed audit replay, and immutable subject verification. */
export function createVerificationAdjudicationReads(database: PostgresCanonicalRepository | undefined, environment: Environment) {
  const publicKeys = environment.VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON?.trim();
  if (!publicKeys) return undefined;
  const semanticProfiles = environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON ? parseSemanticJudgeProfileCatalog(environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON) : undefined;
  const auditGrantsValue = environment.VERIFICATION_ADJUDICATION_GRANTS_JSON?.trim();
  const projectionGrantsValue = environment.VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON?.trim();
  const ownershipGrants = environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  const projectUrl = environment.SUPABASE_URL?.trim();
  const serviceRoleKey = environment.SUPABASE_SECRET_KEY?.trim();
  const imageDigest = environment.VERIFICATION_PARSER_IMAGE_DIGEST?.trim();
  if (!database || !auditGrantsValue || !projectionGrantsValue || !ownershipGrants || !projectUrl || !serviceRoleKey
    || !imageDigest || !/^sha256:[a-f0-9]{64}$/u.test(imageDigest)) {
    throw new Error("VERIFICATION_ADJUDICATION_READ_RUNTIME_REQUIRED");
  }
  const auditGrants = new VerificationAuditInspectionGrantCatalog(parseArray(auditGrantsValue, "VERIFICATION_ADJUDICATION_READ_GRANTS_INVALID"));
  const projectionGrants = new VerificationClaimsProjectionGrantCatalog(parseArray(projectionGrantsValue, "VERIFICATION_ADJUDICATION_READ_PROJECTION_GRANTS_INVALID") as VerificationClaimsProjectionGrant[]);
  const trustedPublicKeys = parseVerificationAuditInspectionPublicKeys(publicKeys);
  const authorize = createVerificationOperationReadAuthorizer(database, ownershipGrants, ["verification_adjudication"]);
  const storageBucket = environment.VERIFICATION_STORAGE_BUCKET?.trim() || "ai-engineer-cloud-bucket";
  const maximumInspectionMs = positiveInteger(environment.VERIFICATION_ADJUDICATION_TIMEOUT_MS, 30_000);
  const store = new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket: storageBucket, maximumBytes: 32_000_000 });

  return { async getPendingSubject(input: ReadInput) {
    const scoped = { tenantId: UuidSchema.parse(input.tenantId), operationId: UuidSchema.parse(input.operationId), actor: structuredClone(input.actor) };
    if (!await authorize(scoped)) throw Object.assign(new Error("VERIFICATION_ADJUDICATION_NOT_FOUND"), { code: "NOT_FOUND" });
    const repository = new PostgresVerificationRepository(database, store, { async authorize(request) {
      if (!allowsVerificationAdjudicationReadArtifact(request, scoped.tenantId)) throw new Error("VERIFICATION_ADJUDICATION_READ_DENIED");
    } });
    // Reads hydrate already-admitted projections only. Parsing is unreachable at this boundary.
    const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("VERIFICATION_ADJUDICATION_READ_PARSER_DISABLED"); } }, {
      parserVersion: "verification-native-parser.v1", imageDigest: imageDigest as `sha256:${string}`, limits: parserLimits,
    }, { storageBucket, producerVersion: "verification-admission.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
    const native = { ...(semanticProfiles ? { semanticProfiles } : {}), database, repository, admission, projectionGrants, auditGrants, trustedPublicKeys, storageBucket, maximumInspectionMs, now: () => new Date().toISOString() };
    const packetReplay = { async replayPacket(replay: Parameters<VerificationAdjudicationPacketReplayPort["replayPacket"]>[0]) {
      return createVerificationAdjudicationRequestService({ ...native, reviewRequirements: replay.reviewRequirements }).prepare(replay.request, replay.context, replay.signal);
    } };
    return new VerificationAdjudicationReadService(new PostgresVerificationAdjudicationReadRepository(
      database, () => repository.createTrustedArtifactResolver(), packetReplay, { maximumReplayMs: maximumInspectionMs },
    )).getPendingSubject(scoped);
  } };
}
