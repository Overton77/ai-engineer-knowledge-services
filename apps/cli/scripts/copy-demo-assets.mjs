import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeJson } from '../../../packages/verification/dist/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('../dist/demo-assets/', import.meta.url));
const catalog = resolve(root, 'catalog/verification-benchmarks/diagnostics-companies-v1');
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const manifestBytes = await readFile(resolve(catalog, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.manifestDigest, 'sha256:fc927c53f8bc308227fe3e9f1f5d321e3075986140a25ce07755208c86ac09e1');
const files = [{ name: 'manifest.json', bytes: manifestBytes }];
for (const entry of manifest.files) {
  assert.match(entry.name, /^[a-z0-9-]+\.json$/u);
  const source = resolve(catalog, entry.name);
  assert.equal(await realpath(source), source);
  const bytes = await readFile(source);
  assert.equal(hash(bytes), entry.digest); assert.equal(bytes.byteLength, entry.bytes);
  files.push({ name: entry.name, bytes });
}
const preparationDigest = manifest.sourcePreparationDigest;
assert.match(preparationDigest, /^sha256:[a-f0-9]{64}$/u);
const preparation = resolve(root, 'catalog/verification-assets', preparationDigest.slice(7));
const preparationBytes = await readFile(resolve(preparation, 'manifest.json'));
assert.equal(hash(preparationBytes), preparationDigest);
const artifacts = [{ name: 'manifest.json', bytes: preparationBytes }];
for (const item of JSON.parse(preparationBytes).artifacts) {
  assert.match(item.file, /^artifacts\/[a-f0-9-]{36}\.bin$/u);
  const source = resolve(preparation, item.file);
  assert.equal(await realpath(source), source);
  const bytes = await readFile(source);
  assert.equal(hash(bytes), item.handle.digest); assert.equal(bytes.byteLength, item.handle.byteLength);
  artifacts.push({ name: item.file, bytes });
}
const semanticDigest = 'sha256:7067f432979212167ca1d7b797e37e6d0b5f5b180dc5919a210010017860c82c';
const semanticDirectory = resolve(root, 'catalog/verification-semantic-fixtures', semanticDigest.slice(7));
const semanticBytes = await readFile(resolve(semanticDirectory, 'manifest.json'));
const { fixtureDigest, ...semanticMaterial } = JSON.parse(semanticBytes);
assert.equal(fixtureDigest, semanticDigest); assert.equal(hash(canonicalizeJson(semanticMaterial)), semanticDigest);
const semanticFiles = [{ name: 'manifest.json', bytes: semanticBytes }];
for (const item of semanticMaterial.artifacts) {
  assert.match(item.file, /^artifacts\/[a-f0-9-]{36}\.bin$/u);
  const source = resolve(semanticDirectory, item.file);
  assert.equal(await realpath(source), source);
  const bytes = await readFile(source);
  assert.equal(hash(bytes), item.handle.digest); assert.equal(bytes.byteLength, item.handle.byteLength);
  semanticFiles.push({ name: item.file, bytes });
}
const reportSemanticDigest = 'sha256:e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d';
const reportSemanticDirectory = resolve(root, 'catalog/verification-semantic-fixtures', reportSemanticDigest.slice(7));
const reportSemanticBytes = await readFile(resolve(reportSemanticDirectory, 'manifest.json'));
const { fixtureDigest: reportFixtureDigest, ...reportMaterial } = JSON.parse(reportSemanticBytes);
assert.equal(reportFixtureDigest, reportSemanticDigest); assert.equal(hash(canonicalizeJson(reportMaterial)), reportSemanticDigest);
const reportSemanticFiles = [{ name: 'manifest.json', bytes: reportSemanticBytes }];
for (const artifact of reportMaterial.artifacts) {
  assert.equal(artifact.file, `artifacts/${artifact.kind}-${artifact.digest.slice(7)}.bin`);
  assert.match(artifact.file, /^artifacts\/(?:request|raw_response|judge_output)-[a-f0-9]{64}\.bin$/u);
  const source = resolve(reportSemanticDirectory, artifact.file);
  assert.equal(await realpath(source), source);
  const bytes = await readFile(source);
  assert.equal(hash(bytes), artifact.digest); assert.equal(bytes.byteLength, artifact.bytes);
  reportSemanticFiles.push({ name: artifact.file, bytes });
}
// Verify the complete source closure before copying into the generated CLI assets.
for (const [directory, entries] of [[resolve(output, 'catalog/diagnostics-companies-v1'), files], [resolve(output, 'preparations', preparationDigest.slice(7)), artifacts], [resolve(output, 'semantic', semanticDigest.slice(7)), semanticFiles], [resolve(output, 'report-semantic', reportSemanticDigest.slice(7)), reportSemanticFiles]]) {
  for (const item of entries) {
    const target = resolve(directory, item.name);
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, item.bytes);
  }
}
console.log(`Offline demo assets: ${files.length} catalog files, ${artifacts.length - 1} preparation artifacts, ${semanticFiles.length - 1} claim semantic replay artifacts, ${reportSemanticFiles.length - 1} report semantic replay artifacts`);
