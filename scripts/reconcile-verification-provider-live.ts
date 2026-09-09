import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { admitOutputSchema, canonicalizeJson, sha256Digest, validateOutputAgainstSchema } from "@aiengineer/knowledge-verification";
import { PostgresCanonicalRepository, PostgresVerificationProviderAccounting } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";

const root = resolve("..");
const originalPath = resolve(root, "internal", "verification-provider-live-conformance-6659519f-5a87-4422-86a6-cc8455631158.json");
const receiptPath = resolve(root, "internal", `verification-provider-live-reconciliation-${randomUUID()}.json`);
const postgresUrl = process.env.POSTGRES_URL?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseSecret = process.env.SUPABASE_SECRET_KEY?.trim();
if (!postgresUrl || !supabaseUrl || !supabaseSecret || new URL(postgresUrl).port !== "54322" || new URL(supabaseUrl).port !== "54321") throw new Error("LOCAL_PROVIDER_RECONCILIATION_REQUIRED");
const [originalBytes, schemaText, expectedText, pointerText] = await Promise.all([readFile(originalPath), readFile(resolve(root, "internal", "verification-provider-fixtures", "20260906", "schema.json"), "utf8"), readFile(resolve(root, "internal", "verification-provider-fixtures", "20260906", "expected.json"), "utf8"), readFile(resolve(root, "internal", "verification-provider-pilot-budget.json"), "utf8")]);
const original = JSON.parse(new TextDecoder().decode(originalBytes)) as { budget: { tenantId: string }; calls: readonly { name: string; requestDigest?: string; rawResponseDigest?: string; rawResponseArtifactId?: string; responseEnvelopeArtifactId?: string }[] };
const schema = admitOutputSchema(JSON.parse(schemaText), "synthetic_record", "v1");
const expected = (JSON.parse(expectedText) as { expected: Record<string, unknown> }).expected;
const pointer = JSON.parse(pointerText) as { tenantId: string };
if (original.budget.tenantId !== pointer.tenantId) throw new Error("RECONCILIATION_BUDGET_POINTER_MISMATCH");
const store = new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: supabaseSecret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 });
const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
const accounting = new PostgresVerificationProviderAccounting(database);
const usage = (payload: Record<string, unknown>) => {
  const input = payload.usage;
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const values = input as Record<string, unknown>;
  const number = (name: string) => typeof values[name] === "number" && Number.isSafeInteger(values[name]) && values[name] >= 0 ? values[name] as number : undefined;
  const cost = typeof values.cost === "number" && Number.isFinite(values.cost) && values.cost >= 0 ? Math.ceil(values.cost * 1_000_000) : undefined;
  return { ...(number("prompt_tokens") === undefined ? {} : { promptTokens: number("prompt_tokens")! }), ...(number("completion_tokens") === undefined ? {} : { completionTokens: number("completion_tokens")! }), ...(number("total_tokens") === undefined ? {} : { totalTokens: number("total_tokens")! }), ...(cost === undefined ? {} : { costMicros: cost }) };
};
const calls = [] as Array<Record<string, unknown>>;
try {
  for (const call of original.calls.filter((item) => item.name.startsWith("interfaze_"))) {
    if (!call.rawResponseArtifactId || !call.responseEnvelopeArtifactId) throw new Error("RECONCILIATION_CALL_IDENTITIES_MISSING");
    const identities = await database.transaction(pointer.tenantId, async (client) => (await client.query<{ raw_sha256: string; id: string; request_sha256: string }>("select raw.sha256 raw_sha256, attempt.id, attempt.request_sha256 from orchestration.artifact raw join orchestration.verification_provider_attempt attempt on attempt.response_artifact_id=$2 where raw.tenant_id=$1 and raw.id=$3", [pointer.tenantId, call.responseEnvelopeArtifactId, call.rawResponseArtifactId])).rows[0]);
    if (!identities) throw new Error("RECONCILIATION_ATTEMPT_IDENTITIES_MISSING");
    const rawDigest = `sha256:${identities.raw_sha256}` as const;
    const raw = await store.get(pointer.tenantId, rawDigest);
    if (!raw || sha256Digest(raw) !== rawDigest) throw new Error("RECONCILIATION_RAW_RESPONSE_UNAVAILABLE");
    const payload = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(raw)) as Record<string, unknown>;
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length !== 1 || !choices[0] || typeof choices[0] !== "object") throw new Error("RECONCILIATION_RESPONSE_SHAPE_INVALID");
    const content = ((choices[0] as { message?: { content?: unknown } }).message?.content);
    if (typeof content !== "string") throw new Error("RECONCILIATION_RESPONSE_CONTENT_INVALID");
    const output = JSON.parse(content) as Record<string, unknown>;
    let outputMatchesExpected: boolean | undefined;
    if (call.name === "interfaze_strict_text") { validateOutputAgainstSchema(schema, output); outputMatchesExpected = canonicalizeJson(output) === canonicalizeJson(expected); }
    else if (output.name !== "ocr" || !Object.hasOwn(output, "result") || Object.keys(output).length !== 2) throw new Error("RECONCILIATION_OCR_SHAPE_INVALID");
    const observedUsage = usage(payload);
    const settled = observedUsage.costMicros === undefined
      ? await accounting.markUncertain({ tenantId: pointer.tenantId, attemptId: identities.id, responseArtifactId: call.responseEnvelopeArtifactId })
      : (await accounting.settle({ tenantId: pointer.tenantId, attemptId: identities.id, actualCostMicros: observedUsage.costMicros, responseArtifactId: call.responseEnvelopeArtifactId })).attempt;
    calls.push({ originalCallName: call.name, originalRawResponseArtifactId: call.rawResponseArtifactId, originalResponseEnvelopeArtifactId: call.responseEnvelopeArtifactId, requestDigest: `sha256:${identities.request_sha256}`, rawResponseDigest: rawDigest, responseEnvelopeArtifactId: call.responseEnvelopeArtifactId, observedModel: typeof payload.model === "string" ? payload.model : undefined, providerResponseId: typeof payload.id === "string" ? payload.id : undefined, usage: observedUsage, accountingState: settled.state, ...(outputMatchesExpected === undefined ? {} : { outputMatchesExpected }) });
  }
  await writeFile(receiptPath, JSON.stringify({ schemaVersion: "verification-provider-live-reconciliation.v1", originalReceiptPath: originalPath, originalReceiptDigest: sha256Digest(originalBytes), noAdditionalProviderDispatches: true, calls }), { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ receipt: receiptPath, calls: calls.map((call) => ({ name: call.originalCallName, accountingState: call.accountingState, outputMatchesExpected: call.outputMatchesExpected })) }));
} finally {
  await database.close();
}
