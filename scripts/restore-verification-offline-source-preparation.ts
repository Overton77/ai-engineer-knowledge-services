import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VerificationArtifactHandle, VerificationSource, VerificationSourceCapture } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";

const expectedManifest = "sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e";
const root = resolve(import.meta.dirname, ".."), preparation = resolve(root, "../internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed");
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`SOURCE_RESTORE_${name}_MISSING`); return value; };
const postgresUrl = required("POSTGRES_URL"), storageUrl = required("SUPABASE_URL"), secret = required("SUPABASE_SECRET_KEY");
if (new URL(postgresUrl).port !== "54322" || new URL(storageUrl).port !== "54321") throw new Error("SOURCE_RESTORE_LOCAL_ONLY");
const manifestBytes = await readFile(resolve(preparation, "manifest.json"));
if (sha256Digest(manifestBytes) !== expectedManifest) throw new Error("SOURCE_RESTORE_MANIFEST_DIGEST_MISMATCH");
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { artifacts: { file: string; handle: VerificationArtifactHandle }[]; captures: { sourceKey: string; source: VerificationSource; capture: VerificationSourceCapture }[] };
const tenantId = manifest.artifacts[0]!.handle.tenantId, database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: storageUrl, serviceRoleKey: secret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 8_000_000 }), { async authorize(input) { if (input.tenantId !== tenantId) throw new Error("SOURCE_RESTORE_TENANT_DENIED"); } });
const proofId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID(), attemptId = randomUUID(), now = new Date().toISOString();
await database.transaction(tenantId, async (client) => {
  await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, tenantId, `ws07-source-restore-${proofId}`, "Restore the byte-identical authenticated offline source preparation after local schema reset"]);
  await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [workItemId, tenantId, missionId, JSON.stringify({ sourcePreparationDigest: expectedManifest, noParserInvocation: true })]);
  await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,'verification-offline-source-restore',$4)", [attemptId, tenantId, workItemId, now]);
});
const pending = new Map(manifest.artifacts.map((item) => [item.handle.artifactId, item])), registered = new Set<string>();
const type = (handle: VerificationArtifactHandle) => handle.mediaType.includes("verification-parser-output") ? ["verification_parser_native_output", "candidate"] as const : handle.mediaType.includes("verification-projection-admission") ? ["verification_transformation_envelope", "ledger"] as const : handle.mediaType.includes("verification-projection.") ? ["verification_canonical_projection", "candidate"] as const : handle.artifactId === (JSON.parse(manifestBytes.toString("utf8")) as any).registryArtifact.artifactId ? ["evaluation_case_input", "ledger"] as const : ["source_capture", "source_captures"] as const;
while (pending.size) {
  let advanced = false;
  for (const [artifactId, item] of [...pending]) {
    if (item.handle.parentArtifactIds.some((parent) => !registered.has(parent))) continue;
    const bytes = await readFile(resolve(preparation, item.file)); if (bytes.byteLength !== item.handle.byteLength || sha256Digest(bytes) !== item.handle.digest) throw new Error(`SOURCE_RESTORE_ARTIFACT_DIGEST_MISMATCH:${artifactId}`);
    const [artifactType, bucketClass] = type(item.handle);
    await repository.registerArtifact({ handle: item.handle, bytes, artifactType, bucketClass, storageBucket: "ai-engineer-cloud-bucket" });
    pending.delete(artifactId); registered.add(artifactId); advanced = true;
  }
  if (!advanced) throw new Error("SOURCE_RESTORE_PARENT_CLOSURE_INVALID");
}
for (const item of manifest.captures) await repository.recordCapture({ tenantId, source: item.source, capture: item.capture, producerAttemptId: attemptId });
await database.close();
const receipt = { schemaVersion: "verification-offline-source-restore.v1", proofId, createdAt: now, sourcePreparationDigest: expectedManifest, tenantId, missionId, workItemId, attemptId, artifactCount: registered.size, captureCount: manifest.captures.length, parserInvocations: 0 };
const body = `${canonicalizeJson(receipt)}\n`, path = resolve(root, `../internal/verification-offline-source-restore-${proofId}.json`); await writeFile(path, body, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ...receipt, path, receiptSha256: createHash("sha256").update(body).digest("hex") }, null, 2)}\n`);
