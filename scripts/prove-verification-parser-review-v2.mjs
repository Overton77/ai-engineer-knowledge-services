import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { SandboxedVerificationParser } from "../packages/conversion/dist/index.js";
import { sha256Digest } from "../packages/verification/dist/index.js";

const execute = promisify(execFile);
const root = resolve("..");
const expectedImage = process.env.VERIFICATION_PARSER_EXPECTED_IMAGE_ID ?? "sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37";
const imageReference = process.env.VERIFICATION_PARSER_IMAGE ?? "aiengineer-verification-parser:v2";
const image = execFileSync("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference], { encoding: "utf8", windowsHide: true }).trim();
if (!/^sha256:[a-f0-9]{64}$/u.test(expectedImage)) throw new Error("PARSER_PROOF_IMAGE_ID_INVALID");
const namespace = `verification-parser-resource-v2-${randomUUID()}`;
const output = resolve(process.env.VERIFICATION_PARSER_PROOF_OUTPUT ?? resolve(root, "internal", `verification-parser-resource-proof-v2-${namespace.slice(-36)}.json`));
const snapshotDirectory = resolve(root, "internal", `verification-parser-resource-proof-v2-source-${namespace.slice(-36)}`);
const sourceFiles = Object.freeze([
  "packages/conversion/src/verification-parser.ts",
  "packages/conversion/dist/index.js",
  "services/verification-parser/parser.py",
  "services/verification-parser/requirements.txt",
  "services/verification-parser/Dockerfile",
  "scripts/prove-verification-parser-review-v2.mjs",
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hashFile = async (path) => hash(await readFile(path));
const docker = async (args, options = {}) => execute("docker", args, { windowsHide: true, maxBuffer: 8_192, ...options });
const ownContainer = (suffix) => `${namespace}-${suffix}`;
const sandboxRun = (name, entrypoint, args) => [
  "run", "--rm", "--name", ownContainer(name), "--network", "none", "--read-only", "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges:true", "--pids-limit", "32", "--memory", "512m", "--memory-swap", "512m", "--cpus", "1",
  "--ulimit", "nofile=64:64", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--entrypoint", entrypoint, image, ...args,
];
const cleanupOwned = async (name) => { await docker(["rm", "--force", name], { timeout: 10_000 }).catch(() => undefined); };
const runProbe = async (name, code, timeout = 30_000) => {
  const container = ownContainer(name);
  const startedAt = Date.now();
  try {
    const result = await docker(sandboxRun(name, "python", ["-c", code]), { timeout });
    return { name, exitCode: 0, stdout: result.stdout.trim(), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { name, exitCode: typeof error.code === "number" ? error.code : null, signal: error.signal ?? null, stdout: (error.stdout ?? "").trim(), elapsedMs: Date.now() - startedAt };
  } finally { await cleanupOwned(container); }
};
const parserContainers = () => execFileSync("docker", ["ps", "--all", "--filter", "name=verification-parser-", "--format", "{{.Names}}"], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/u).filter(Boolean).sort();

assert.equal(image, expectedImage, "PARSER_PROOF_IMAGE_ID_MISMATCH");
const [imageConfig] = JSON.parse(execFileSync("docker", ["image", "inspect", imageReference], { encoding: "utf8", windowsHide: true }));
assert.equal(imageConfig.Config.User, "65534:65534", "PARSER_PROOF_IMAGE_USER_MISMATCH");
assert.deepEqual(imageConfig.Config.Entrypoint, ["python", "/app/parser.py"], "PARSER_PROOF_ENTRYPOINT_MISMATCH");
const integrityName = ownContainer("integrity");
let integrityOutput;
try {
  integrityOutput = (await docker(sandboxRun("integrity", "sha256sum", ["/app/parser.py", "/app/requirements.txt"]), { timeout: 15_000 })).stdout;
} finally { await cleanupOwned(integrityName); }
const imageHashes = Object.fromEntries(integrityOutput.trim().split(/\r?\n/u).map((line) => {
  const match = /^([a-f0-9]{64})\s+\/?(.+)$/u.exec(line.trim());
  if (!match) throw new Error("PARSER_PROOF_IMAGE_HASH_OUTPUT_INVALID");
  return [match[2].replace(/^app\//u, ""), match[1]];
}));
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (relative) => [relative, await hashFile(resolve(relative))])));
assert.equal(imageHashes["parser.py"], sourceHashes["services/verification-parser/parser.py"], "PARSER_PROOF_IMAGE_PARSER_SOURCE_MISMATCH");
assert.equal(imageHashes["requirements.txt"], sourceHashes["services/verification-parser/requirements.txt"], "PARSER_PROOF_IMAGE_REQUIREMENTS_SOURCE_MISMATCH");

const network = await runProbe("network", "import socket\ntry:\n socket.create_connection(('1.1.1.1',443),1)\n raise Exception('NETWORK_ALLOWED')\nexcept OSError as error:\n assert error.errno == 101, error\n print('network_unreachable')");
assert.deepEqual({ exitCode: network.exitCode, stdout: network.stdout }, { exitCode: 0, stdout: "network_unreachable" });
const readonly = await runProbe("readonly", "try:\n open('/var/tmp/proof-write','w')\n raise Exception('ROOT_WRITABLE')\nexcept OSError as error:\n assert error.errno == 30, error\n print('root_write_denied')");
assert.deepEqual({ exitCode: readonly.exitCode, stdout: readonly.stdout }, { exitCode: 0, stdout: "root_write_denied" });
const memory = await runProbe("memory", "import runpy\nrunpy.run_path('/app/parser.py',run_name='limits_only')\ntry:\n bytearray(600*1024*1024)\n raise Exception('MEMORY_ALLOWED')\nexcept MemoryError:\n print('memory_limit_enforced')");
assert.deepEqual({ exitCode: memory.exitCode, stdout: memory.stdout }, { exitCode: 0, stdout: "memory_limit_enforced" });
const disk = await runProbe("tmpfs", "try:\n with open('/tmp/proof-disk','wb') as file:\n  for _ in range(80): file.write(b'x'*1024*1024)\n raise Exception('TMPFS_ALLOWED')\nexcept OSError as error:\n assert error.errno == 28, error\n print('tmpfs_limit_enforced')");
assert.deepEqual({ exitCode: disk.exitCode, stdout: disk.stdout }, { exitCode: 0, stdout: "tmpfs_limit_enforced" });
const cpu = await runProbe("cpu", "import runpy\nrunpy.run_path('/app/parser.py',run_name='limits_only')\nwhile True: pass", 30_000);
assert.ok([137, 152].includes(cpu.exitCode), `PARSER_PROOF_CPU_EXIT_INVALID:${cpu.exitCode}`);
assert.ok(cpu.elapsedMs < 26_000, "PARSER_PROOF_CPU_LIMIT_TOO_SLOW");

const beforeParserContainers = parserContainers();
assert.deepEqual(beforeParserContainers, [], "PARSER_PROOF_PREEXISTING_PARSER_CONTAINER");
const parser = new SandboxedVerificationParser(image);
const html = Buffer.from("<html><body>Current parser v2 proof</body></html>");
const parsed = await parser.parse({ kind: "html", bytes: html, parentDigest: sha256Digest(html) });
assert.equal(parsed.parserVersion, "verification-native-parser.v1");
assert.equal(parsed.imageDigest, image);
assert.equal(parsed.parentDigest, sha256Digest(html));
const realPdf = await readFile(resolve(root, "internal", "verification-source-captures", "20260905", "tru-sample-report.pdf"));
const controller = new AbortController();
const cancellationStartedAt = Date.now();
const cancellationTimer = setTimeout(() => controller.abort(), 1_000);
await assert.rejects(parser.parse({ kind: "pdf", bytes: realPdf, parentDigest: sha256Digest(realPdf), signal: controller.signal }), /PARSER_CANCELLED/);
clearTimeout(cancellationTimer);
const cancellationMs = Date.now() - cancellationStartedAt;
const boundedPdf = (pageCount) => {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(" ")} ] >>`, ...Array.from({ length: pageCount }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>")];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  return Buffer.from(`${pdf}xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
};
const valid40PagePdf = boundedPdf(40);
const valid40Page = await parser.parse({ kind: "pdf", bytes: valid40PagePdf, parentDigest: sha256Digest(valid40PagePdf) });
assert.equal(valid40Page.projections.length, 2, "PARSER_PROOF_40_PAGE_POSITIVE_FAILED");
const oversizedPdf = boundedPdf(41);
await assert.rejects(parser.parse({ kind: "pdf", bytes: oversizedPdf, parentDigest: sha256Digest(oversizedPdf) }), /PARSER_INPUT_OR_RESOURCE_FAILURE/);
const afterParserContainers = parserContainers();
assert.deepEqual(afterParserContainers, beforeParserContainers, "PARSER_PROOF_OWNED_CONTAINER_CLEANUP_FAILED");

await mkdir(snapshotDirectory, { recursive: false });
for (const relative of sourceFiles) {
  const destination = resolve(snapshotDirectory, relative);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(relative), destination);
  assert.equal(await hashFile(destination), sourceHashes[relative], `PARSER_PROOF_SNAPSHOT_HASH_MISMATCH:${relative}`);
}
const snapshotManifest = { schemaVersion: "verification-parser-resource-proof-source-manifest.v1", sourceHashes };
await writeFile(resolve(snapshotDirectory, "manifest.json"), `${JSON.stringify(snapshotManifest)}\n`);
const evidence = {
  schemaVersion: "verification-parser-resource-proof.v2",
  status: "passed",
  scope: "local current parser image resource and adapter proof",
  execution: { proofCommand: `${process.execPath} scripts/prove-verification-parser-review-v2.mjs`, imageReference, expectedImageId: expectedImage, sandbox: { network: "none", readOnly: true, capabilitiesDropped: "ALL", noNewPrivileges: true, pidsLimit: 32, memory: "512m", memorySwap: "512m", cpus: 1, nofile: "64:64", temporaryFilesystem: "/tmp:rw,noexec,nosuid,nodev,size=64m" } },
  image: { reference: imageReference, immutableId: image, expectedImmutableId: expectedImage, user: imageConfig.Config.User, entrypoint: imageConfig.Config.Entrypoint, contentHashes: imageHashes },
  resourceBounds: { network: network.stdout, readonly: readonly.stdout, memory: memory.stdout, temporaryFilesystem: disk.stdout, cpu: { exitCode: cpu.exitCode, elapsedMs: cpu.elapsedMs } },
  parserAdapter: { normalHtml: { parserVersion: parsed.parserVersion, nativeOutputDigest: parsed.nativeOutputDigest, transformationSignature: parsed.transformationSignature }, cancellation: { input: "retained local PDF", elapsedMs: cancellationMs, outcome: "PARSER_CANCELLED" }, validPageBoundary: { pages: 40, projections: valid40Page.projections.length, outcome: "accepted" }, oversizedPage: { pages: 41, outcome: "PARSER_INPUT_OR_RESOURCE_FAILURE" }, ownedContainersBefore: beforeParserContainers, ownedContainersAfter: afterParserContainers },
  sourceSnapshot: { directory: snapshotDirectory, manifest: resolve(snapshotDirectory, "manifest.json"), sourceHashes },
  limitations: ["The network probe is a sandbox control, not a full hostile-input security review.", "Adapter wall-clock timeout is not exercised here; the CPU hard-limit probe is distinct.", "No remote service, provider, database, or object-store call occurred.", "Only uniquely named proof containers were removed; no broad Docker cleanup was issued."],
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence)}\n`);
console.log(JSON.stringify({ status: evidence.status, output, image: evidence.image.immutableId, namespace, sourceSnapshot: snapshotDirectory }));