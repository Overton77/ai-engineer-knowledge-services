import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { boundedResponseBytes, canonicalizeJson, providerDigest, sha256Digest } from "@aiengineer/knowledge-verification";
import { PostgresCanonicalRepository, PostgresVerificationProviderAccounting, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";

const root = resolve("..");
const originalPath = resolve(root, "internal", "verification-provider-live-conformance-6659519f-5a87-4422-86a6-cc8455631158.json");
const receiptPath = resolve(root, "internal", `verification-provider-gateway-cost-reconciliation-${randomUUID()}.json`);
const text = new TextEncoder();
const keyFile = await readFile(resolve(".env"), "utf8");
const apiKey = keyFile.split(/\r?\n/u).find((line) => line.startsWith("AI_GATEWAY_API_KEY="))?.slice("AI_GATEWAY_API_KEY=".length).trim().replace(/^(['"])(.*)\1$/u, "$2");
const postgresUrl = process.env.POSTGRES_URL?.trim(), supabaseUrl = process.env.SUPABASE_URL?.trim(), supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim();
if (!apiKey || !postgresUrl || !supabaseUrl || !supabaseSecret || new URL(postgresUrl).port !== "54322" || new URL(supabaseUrl).port !== "54321") throw new Error("LOCAL_GATEWAY_COST_RECONCILIATION_REQUIRED");
const originalBytes = await readFile(originalPath);
const original = JSON.parse(new TextDecoder().decode(originalBytes)) as { budget: { tenantId: string }; calls: readonly { name: string; provider: string; providerResponseId?: string; rawResponseArtifactId?: string; rawResponseDigest?: string; responseEnvelopeArtifactId?: string }[] };
const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
const store = new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: supabaseSecret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 });
const repository = new PostgresVerificationRepository(database, store, { async authorize() {} });
const accounting = new PostgresVerificationProviderAccounting(database);
const results: Array<Record<string, unknown>> = [];
try {
  for (const call of original.calls.filter((item) => item.provider === "vercel-ai-gateway")) {
    if (!call.responseEnvelopeArtifactId || !call.rawResponseArtifactId || !call.rawResponseDigest) throw new Error("GATEWAY_COST_ORIGINAL_IDENTITIES_MISSING");
    let generationId = call.providerResponseId;
    if (!generationId) {
      const raw = await store.get(original.budget.tenantId, call.rawResponseDigest as `sha256:${string}`);
      if (!raw || sha256Digest(raw) !== call.rawResponseDigest) throw new Error("GATEWAY_COST_RAW_COMPLETION_MISSING");
      const parsed = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(raw)) as { id?: unknown };
      if (typeof parsed.id !== "string" || !/^gen_[A-Za-z0-9]+$/u.test(parsed.id)) throw new Error("GATEWAY_COST_GENERATION_ID_INVALID");
      generationId = parsed.id;
    }
    const attempt = await database.transaction(original.budget.tenantId, async (client) => (await client.query<{ id: string }>("select id from orchestration.verification_provider_attempt where tenant_id=$1 and response_artifact_id=$2", [original.budget.tenantId, call.responseEnvelopeArtifactId])).rows[0]);
    if (!attempt) throw new Error("GATEWAY_COST_ATTEMPT_MISSING");
    const url = `https://ai-gateway.vercel.sh/v1/generation?id=${encodeURIComponent(generationId)}`;
    const requestBytes = text.encode(canonicalizeJson({ method: "GET", url }));
    const requestArtifact = await repository.registerContentAddressedArtifact({ tenantId: original.budget.tenantId, bytes: requestBytes, mediaType: "application/json", createdAt: new Date().toISOString(), producerActivityId: "verification-provider-cost-reconciliation", producerVersion: "ws06.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [call.responseEnvelopeArtifactId], transformationSignature: providerDigest({ kind: "gateway_generation_lookup_request.v1", generationId }), artifactType: "verification_provider_request", bucketClass: "ledger", storageBucket: "ai-engineer-cloud-bucket", producerAttemptId: attempt.id });
    const candidates = await database.transaction(original.budget.tenantId, async (client) => (await client.query<{ id: string; sha256: string }>("select artifact.id,artifact.sha256 from orchestration.artifact artifact join orchestration.verification_artifact_metadata metadata on metadata.tenant_id=artifact.tenant_id and metadata.artifact_id=artifact.id where artifact.tenant_id=$1 and artifact.artifact_type='verification_provider_raw_response' and metadata.producer_activity_id='verification-provider-cost-reconciliation' order by artifact.created_at desc", [original.budget.tenantId])).rows);
    let rawBytes: Uint8Array | undefined, rawArtifact: { artifactId: string; digest: `sha256:${string}` } | undefined, httpStatus: number | undefined;
    for (const candidate of candidates) {
      const candidateBytes = await store.get(original.budget.tenantId, `sha256:${candidate.sha256}`);
      if (!candidateBytes) continue;
      try { if ((JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(candidateBytes)) as { data?: { id?: unknown } }).data?.id === generationId) { rawBytes = candidateBytes; rawArtifact = { artifactId: candidate.id, digest: `sha256:${candidate.sha256}` }; break; } } catch { /* A malformed retained response cannot be cost evidence. */ }
    }
    if (!rawBytes || !rawArtifact) {
      const response = await fetch(url, { method: "GET", redirect: "error", headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
      httpStatus = response.status;
      rawBytes = await boundedResponseBytes(response, 96_000);
      rawArtifact = await repository.registerContentAddressedArtifact({ tenantId: original.budget.tenantId, bytes: rawBytes, mediaType: "application/octet-stream", createdAt: new Date().toISOString(), producerActivityId: "verification-provider-cost-reconciliation", producerVersion: "ws06.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", artifactType: "verification_provider_raw_response", bucketClass: "ledger", storageBucket: "ai-engineer-cloud-bucket", producerAttemptId: attempt.id });
    }
    const lookupEnvelope = await repository.registerContentAddressedArtifact({ tenantId: original.budget.tenantId, bytes: text.encode(canonicalizeJson({ schemaVersion: "verification-provider-cost-lookup.v1", generationId, requestArtifactId: requestArtifact.artifactId, rawResponseArtifactId: rawArtifact.artifactId, originalResponseEnvelopeArtifactId: call.responseEnvelopeArtifactId })), mediaType: "application/vnd.aiengineer.verification-provider-cost-lookup+json", createdAt: new Date().toISOString(), producerActivityId: "verification-provider-cost-reconciliation", producerVersion: "ws06.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [call.responseEnvelopeArtifactId, requestArtifact.artifactId, rawArtifact.artifactId], transformationSignature: providerDigest({ kind: "gateway_generation_lookup_envelope.v1", generationId, rawDigest: rawArtifact.digest }), artifactType: "verification_provider_cost_lookup", bucketClass: "ledger", storageBucket: "ai-engineer-cloud-bucket", producerAttemptId: attempt.id });
    let actualCostMicros: number | undefined, isByok: boolean | undefined, status = "unknown";
    if (httpStatus === undefined || (httpStatus >= 200 && httpStatus < 300)) {
      const value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(rawBytes)) as { data?: { total_cost?: unknown; is_byok?: unknown } };
      isByok = value.data?.is_byok === true;
      if (!isByok && typeof value.data?.total_cost === "number" && Number.isFinite(value.data.total_cost) && value.data.total_cost >= 0) actualCostMicros = Math.ceil(value.data.total_cost * 1_000_000);
    }
    const accounted = actualCostMicros === undefined ? await accounting.markUncertain({ tenantId: original.budget.tenantId, attemptId: attempt.id, responseArtifactId: call.responseEnvelopeArtifactId }) : (await accounting.settle({ tenantId: original.budget.tenantId, attemptId: attempt.id, actualCostMicros, responseArtifactId: call.responseEnvelopeArtifactId })).attempt;
    results.push({ originalCallName: call.name, generationId, lookupRequestArtifactId: requestArtifact.artifactId, lookupRawArtifactId: rawArtifact.artifactId, lookupEnvelopeArtifactId: lookupEnvelope.artifactId, ...(httpStatus === undefined ? { recoveredPersistedLookup: true } : { httpStatus }), isByok, ...(actualCostMicros === undefined ? {} : { actualCostMicros }), accountingState: accounted.state, status: actualCostMicros === undefined ? "unknown_or_byok_retained" : "actual_cost_settled" });
  }
  await writeFile(receiptPath, JSON.stringify({ schemaVersion: "verification-provider-gateway-cost-reconciliation.v1", originalReceiptPath: originalPath, originalReceiptDigest: sha256Digest(originalBytes), lookupModel: "Gateway GET /v1/generation", results }), { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ receipt: receiptPath, results: results.map((item) => ({ name: item.originalCallName, status: item.status, accountingState: item.accountingState })) }));
} finally { await database.close(); }
