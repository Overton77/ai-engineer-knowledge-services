import {
  VerificationAdmissionService,
  VerificationMetricApplicationService,
  VerificationMetricProfileCatalog,
  VerificationSealPolicyCatalog,
} from "@aiengineer/knowledge-application";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresVerificationMetricRuntimePrincipals, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { projectionSelectorResolver } from "@aiengineer/knowledge-verification";
import { CanonicalActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { verificationMetricActivityHandler } from "../apps/worker/src/verification-metric-activity.js";
import { createVerificationMetricAuditSealer } from "../apps/worker/src/verification-metric-sealer.js";

const bucket = "ai-engineer-cloud-bucket";
type Digest = `sha256:${string}`;
type Fixture = {
  readonly tenantId: string; readonly operationId: string;
  readonly profileGrant: { readonly profileArtifact: { readonly artifactId: string; readonly digest: Digest }; readonly observations: { readonly artifactId: string; readonly digest: Digest } };
  readonly policyGrant: { readonly tenantId: string; readonly policyVersion: string; readonly policyArtifact: { readonly artifactId: string; readonly digest: Digest } };
  readonly imageDigest: Digest; readonly verifierDeploymentId: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = /^sha256:[a-f0-9]{64}$/u;
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(), expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function requiredString(value: unknown, maximum: number): string | undefined { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value : undefined; }
function artifactReference(value: unknown): { artifactId: string; digest: Digest } | undefined {
  const item = record(value); if (!item || !exact(item, ["artifactId", "digest"]) || typeof item.artifactId !== "string" || !uuid.test(item.artifactId) || typeof item.digest !== "string" || !digest.test(item.digest)) return undefined;
  return { artifactId: item.artifactId, digest: item.digest as Digest };
}
function parseFixture(raw: unknown): Fixture {
  const message = record(raw); if (!message || !exact(message, ["kind", "fixture"]) || message.kind !== "fixture") throw new Error("SEAL_CRASH_CHILD_IPC_INVALID");
  const value = record(message.fixture); if (!value || !exact(value, ["tenantId", "operationId", "profileGrant", "policyGrant", "imageDigest", "verifierDeploymentId"])) throw new Error("SEAL_CRASH_CHILD_IPC_INVALID");
  const profile = record(value.profileGrant), policy = record(value.policyGrant);
  const profileArtifact = profile && exact(profile, ["profileArtifact", "observations"]) ? artifactReference(profile.profileArtifact) : undefined;
  const observations = profile && exact(profile, ["profileArtifact", "observations"]) ? artifactReference(profile.observations) : undefined;
  const policyArtifact = policy && exact(policy, ["tenantId", "policyVersion", "policyArtifact"]) ? artifactReference(policy.policyArtifact) : undefined;
  const tenantId = requiredString(value.tenantId, 64), operationId = requiredString(value.operationId, 64), policyTenantId = policy && requiredString(policy.tenantId, 64);
  const policyVersion = policy && requiredString(policy.policyVersion, 160), verifierDeploymentId = requiredString(value.verifierDeploymentId, 255);
  if (!tenantId || !uuid.test(tenantId) || !operationId || !uuid.test(operationId) || !profileArtifact || !observations || !policyArtifact || !policyTenantId || !uuid.test(policyTenantId) || !policyVersion || typeof value.imageDigest !== "string" || !digest.test(value.imageDigest) || !verifierDeploymentId) throw new Error("SEAL_CRASH_CHILD_IPC_INVALID");
  return { tenantId, operationId, profileGrant: { profileArtifact, observations }, policyGrant: { tenantId: policyTenantId, policyVersion, policyArtifact }, imageDigest: value.imageDigest as Digest, verifierDeploymentId };
}

function localUrl(value: string | undefined, port: string, missingCode: string, refusedCode: string): string {
  if (!value?.trim()) throw new Error(missingCode);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(refusedCode); }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!local || parsed.port !== port) throw new Error(refusedCode);
  return value;
}

const postgresUrl = localUrl(process.env.POSTGRES_URL, "54322", "SEAL_CRASH_CHILD_POSTGRES_REQUIRED", "SEAL_CRASH_CHILD_REFUSED_NONLOCAL_POSTGRES");
const supabaseUrl = localUrl(process.env.SUPABASE_URL, "54321", "SEAL_CRASH_CHILD_SUPABASE_REQUIRED", "SEAL_CRASH_CHILD_REFUSED_NONLOCAL_SUPABASE");
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY?.trim();
if (!serviceRoleKey) throw new Error("SEAL_CRASH_CHILD_SUPABASE_KEY_REQUIRED");
const checkedServiceRoleKey: string = serviceRoleKey;
if (typeof process.send !== "function") throw new Error("SEAL_CRASH_CHILD_IPC_REQUIRED");

const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
let received = false;
let closed = false;
const timeout = setTimeout(() => void failAndExit("SEAL_CRASH_CHILD_FIXTURE_TIMEOUT"), 30_000);

function codeFor(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message) ? message : "SEAL_CRASH_CHILD_FAILURE";
}
function send(value: unknown): Promise<void> {
  return new Promise((resolve) => {
    if (typeof process.send !== "function" || !process.connected) { resolve(); return; }
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const fallback = setTimeout(finish, 1_000);
    try { process.send(value, () => { clearTimeout(fallback); finish(); }); }
    catch { clearTimeout(fallback); finish(); }
  });
}
async function close(): Promise<void> {
  if (closed) return;
  closed = true;
  clearTimeout(timeout);
  await database.close().catch(() => undefined);
}
async function failAndExit(code: string): Promise<void> {
  if (closed) return;
  await send({ kind: "error", code });
  await close();
  if (process.connected) process.disconnect?.();
  process.exit(1);
}
async function waitForever(): Promise<never> { return new Promise<never>(() => undefined); }

async function executeFixture(fixture: Fixture): Promise<void> {
  if (fixture.policyGrant.tenantId !== fixture.tenantId) throw new Error("SEAL_CRASH_CHILD_POLICY_TENANT_MISMATCH");
  const artifacts = new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: checkedServiceRoleKey, bucket, maximumBytes: 8_000_000 });
  const repository = new PostgresVerificationRepository(database, artifacts, {
    async authorize(input) {
      if (input.tenantId !== fixture.tenantId) throw new Error("SEAL_CRASH_CHILD_TENANT_DENIED");
    },
  });
  // The parser is constructed with the same bounded deployment metadata as the
  // metric proof. This fixture only rehydrates admitted projections; it never
  // calls parseAndAdmit and therefore never starts a parser or provider.
  const admission = new VerificationAdmissionService(repository, new SandboxedVerificationParser(fixture.imageDigest as `sha256:${string}`), {
    parserVersion: "verification-native-parser.v1", imageDigest: fixture.imageDigest as `sha256:${string}`, limits: VERIFICATION_PARSER_LIMITS,
  }, { storageBucket: bucket, producerVersion: "verification-seal-crash-child.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
  const profiles = new VerificationMetricProfileCatalog([fixture.profileGrant]);
  const service = new VerificationMetricApplicationService({
    artifactResolver: repository.createTrustedArtifactResolver(), captures: repository, profiles,
    runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(database), nativeProjectionAdmission: admission,
    selectorResolvers: [projectionSelectorResolver],
  });
  const sealer = createVerificationMetricAuditSealer({
    repository, policyCatalog: new VerificationSealPolicyCatalog([fixture.policyGrant]), storageBucket: bucket,
    runtime: { code: { gitSha: "verification-seal-crash-child.v1", dirty: true, normalizerVersion: "RFC8785.v1" }, platform: "local-supabase", deploymentId: fixture.verifierDeploymentId },
    now: () => new Date().toISOString(),
  });
  let capturedClaim: unknown;
  const trappingSealer = {
    async seal(input: Parameters<typeof sealer.seal>[0]) {
      const seal = await sealer.seal(input);
      if (!capturedClaim) throw new Error("SEAL_CRASH_CHILD_CLAIM_NOT_CAPTURED");
      await send({ kind: "sealed", seal, claim: JSON.parse(JSON.stringify(capturedClaim)) });
      return await waitForever();
    },
  };
  const handler = verificationMetricActivityHandler({ service, repository, operations: database, storageBucket: bucket, now: () => new Date().toISOString(), sealer: trappingSealer });
  const registry = new CanonicalActivityRegistry([handler]);
  const worker = new CanonicalDurableKnowledgeWorker("verification-seal-crash-child", fixture.tenantId, database, async (claim) => {
    capturedClaim = claim;
    const operation = await database.getOperationRecord(fixture.tenantId, claim.operationId);
    if (!operation) throw new Error("SEAL_CRASH_CHILD_OPERATION_NOT_FOUND");
    return registry.execute(operation, claim);
  }, 1_500, registry.operationKinds());
  const result = await worker.runOperationOnce(fixture.operationId);
  if (!result) throw new Error("SEAL_CRASH_CHILD_OPERATION_NOT_CLAIMED");
  throw new Error("SEAL_CRASH_CHILD_UNEXPECTED_COMPLETION");
}

process.once("message", (raw: unknown) => {
  if (received) return;
  received = true;
  clearTimeout(timeout);
  void (async () => {
    try { await executeFixture(parseFixture(raw)); }
    catch (error) { await failAndExit(codeFor(error)); }
  })();
});
process.once("disconnect", () => { void (async () => { await close(); process.exit(0); })(); });
