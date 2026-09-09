import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "internal", "verification-vr027-canonical-write-path-audit-r3-20260908.json");
const sourceRoots = ["apps", "packages"];

async function filesUnder(relativeRoot) {
  const absoluteRoot = resolve(root, relativeRoot);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(absoluteRoot, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(relative(root, path)));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

const productionFiles = (await Promise.all(sourceRoots.map(filesUnder))).flat();
const records = await Promise.all(productionFiles.map(async (path) => {
  const source = await readFile(path, "utf8");
  return {
    path: relative(root, path).split(sep).join("/"),
    sha256: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    directObjectStorePutLines: source.split(/\r?\n/u).flatMap((line, index) => /\.put\(/u.test(line) ? [index + 1] : []),
    registrationCallLines: source.split(/\r?\n/u).flatMap((line, index) => /register(?:Fenced)?ContentAddressedArtifact\(/u.test(line) ? [index + 1] : []),
  };
}));
const directWrites = records.filter((record) => record.directObjectStorePutLines.length > 0);
const expectedDirectPath = "packages/persistence/src/verification.ts";
const genericPreparationPaths = new Set([
  "apps/worker/src/index.ts",
  "packages/application/src/preparation.ts",
  "packages/conversion/src/deterministic.ts",
  "packages/conversion/src/providers.ts",
]);
const genericAcquisitionPrefix = "packages/acquisition/src/";
const classifiedDirectWrites = directWrites.map((record) => ({
  ...record,
  classification: record.path === expectedDirectPath ? "canonical_verification_registrar"
    : genericPreparationPaths.has(record.path) ? "generic_preparation_or_conversion"
      : record.path.startsWith(genericAcquisitionPrefix) ? "generic_acquisition"
        : "unclassified",
}));
const canonicalDirectWrites = classifiedDirectWrites.filter((record) => record.classification === "canonical_verification_registrar");
const unexpectedDirectWrites = classifiedDirectWrites.filter((record) => record.classification === "unclassified");
if (canonicalDirectWrites.length !== 1 || canonicalDirectWrites[0]?.path !== expectedDirectPath || unexpectedDirectWrites.length > 0) {
  throw new Error(`CURRENT_PRODUCTION_OBJECT_STORE_WRITE_INVENTORY_DRIFT:${JSON.stringify({ canonicalDirectWrites, unexpectedDirectWrites })}`);
}
const index = await readFile(resolve(root, "apps/worker/src/index.ts"), "utf8");
if (!index.includes("new PostgresVerificationRepository(persistence.database,verificationArtifacts")
  || !index.includes("new PostgresVerificationAdjudicationRepository(persistence.database,repository)")) {
  throw new Error("CANONICAL_VERIFICATION_COMPOSITION_DRIFT");
}
const registry = await readFile(resolve(root, expectedDirectPath), "utf8");
for (const required of [
  "'pending',null,'verification.v1'", "this.artifacts.put", "OBJECT_STORE_WRITE_NOT_VERIFIED",
  "storage_state='available'", "storage_state='failed'", "registration_error_class='object_write_failed'",
]) if (!registry.includes(required)) throw new Error(`CANONICAL_VERIFICATION_REGISTRATION_PROTOCOL_DRIFT:${required}`);
const adjudication = await readFile(resolve(root, "packages/persistence/src/verification-adjudication.ts"), "utf8");
if (adjudication.includes(".artifacts.put(") || !adjudication.includes("registerFencedContentAddressedArtifact")) {
  throw new Error("ADJUDICATION_BYPASSES_CANONICAL_ARTIFACT_REGISTRATION");
}
const report = {
  schemaVersion: "verification-vr027-canonical-write-path-audit.v1",
  scope: "All current non-test TypeScript production source files under apps/ and packages/. Classifies direct object-store writes, then evaluates the canonical verification write subset.",
  directObjectStoreWrites: classifiedDirectWrites,
  canonicalRegistrar: {
    path: expectedDirectPath,
    protocol: ["pending relational row and metadata/lineage before CAS write", "CAS identity and byte/digest re-hydration", "available state after verified write", "failed/object_write_failed after CAS write failure"],
  },
  adjudication: {
    path: "packages/persistence/src/verification-adjudication.ts",
    route: "PostgresVerificationRepository.registerFencedContentAddressedArtifact",
    result: "no direct object-store write remains",
  },
  productionComposition: {
    path: "apps/worker/src/index.ts",
    repository: "PostgresVerificationRepository(persistence.database, verificationArtifacts)",
    adjudication: "PostgresVerificationAdjudicationRepository(persistence.database, repository)",
  },
  registrationCallers: records.filter((record) => record.registrationCallLines.length > 0),
  currentProductionInvariant: "All currently inventoried canonical verification artifact writes route through PostgresVerificationRepository; the sole direct verification CAS write is its pending/available/failed registrar implementation.",
  limitations: ["Static source inventory does not prove external object-store durability.", "Generic preparation/conversion/acquisition stores are inventoried and classified, but are not canonical verification artifact writers."],
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(outputPath, serialized, { flag: "wx" });
console.log(JSON.stringify({ outputPath: relative(root, outputPath).split(sep).join("/"), sha256: `sha256:${createHash("sha256").update(serialized).digest("hex")}`, directWrites: directWrites.length, canonicalDirectWrites: canonicalDirectWrites.length, registrationCallers: report.registrationCallers.length }));
