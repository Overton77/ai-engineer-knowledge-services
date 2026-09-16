#!/usr/bin/env node
/**
 * Skill conformance check: every command and MCP tool a skill names must exist in an actual
 * implemented catalog, and the manifest must describe the directories that exist.
 *
 *   node skills/check.mjs            # exit 1 on drift, 2 on a broken catalog source
 *   node skills/check.mjs --json     # also print manifest/skill digests for run-pin freezing
 *
 * Catalogs are read from source, never invented here:
 *   executor operations  apps/verification-executor/src/knowledge/{operations,recovery-host-operations,content-link-operations}.ts
 *   executor MCP tools   apps/verification-executor/src/mcp.ts  (verify_* tools) + the operations above
 *   platform CLI         apps/cli/src/commands.ts CLI_COMMANDS + apps/cli/src/index.ts local commands
 *   platform MCP tools   apps/mcp/src/index.ts
 * When apps/verification-executor/dist/knowledge.js exists, its `ops` output is compared against the
 * parsed executor catalog so a stale parser cannot pass silently.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const executorRoot = join(repoRoot, "apps/verification-executor");
const problems = [];
const fail = (message) => problems.push(message);
const die = (message) => { console.error(message); process.exit(2); };
const read = (path) => readFileSync(path, "utf8");

/** Minimum sizes: a silently empty catalog must never let a skill pass. */
const MINIMUM = { executorOperations: 25, executorMcpTools: 35, platformCommands: 50, platformMcpTools: 20 };

function executorOperationCatalog() {
  const files = ["operations.ts", "recovery-host-operations.ts", "content-link-operations.ts"].map((name) => read(join(executorRoot, "src/knowledge", name)));
  const operations = new Map();
  for (const source of files) {
    for (const match of source.matchAll(/name:\s*"([a-z][a-z0-9_]*)"[\s\S]{0,2000}?cli:\s*\{\s*command:\s*\[([^\]]*)\]/g)) {
      const command = [...match[2].matchAll(/"([^"]+)"/g)].map((part) => part[1]);
      if (command.length === 2) operations.set(match[1], command.join(" "));
    }
    // `checkpoint_${action}` style templates: keep their literal command pair.
    for (const match of source.matchAll(/name:\s*`([a-z][a-z0-9_]*)_\$\{action\}`[\s\S]{0,600}?command:\s*\[\s*"([^"]+)",\s*action\s*\]/g)) {
      for (const action of ["read", "restore"]) operations.set(`${match[1]}_${action}`, `${match[2]} ${action}`);
    }
  }
  return operations;
}

function verifyMcpTools() {
  const source = read(join(executorRoot, "src/mcp.ts"));
  return new Set([...source.matchAll(/registerTool\(\s*"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]));
}

function platformCommands() {
  const source = read(join(repoRoot, "apps/cli/src/commands.ts"));
  const table = source.slice(source.indexOf("export const CLI_COMMANDS"), source.indexOf("export function resolveCommand"));
  if (!table) die("apps/cli/src/commands.ts: CLI_COMMANDS table not found");
  const commands = new Map();
  let group;
  for (const line of table.split("\n")) {
    const groupMatch = /^\s{2}([a-z_]+):\s*\{\s*$/.exec(line);
    if (groupMatch) { group = groupMatch[1]; continue; }
    const actionMatch = /^\s{4}"?([a-z][a-z-]*)"?:\s*(submit\(|unsupported\(|\{)/.exec(line);
    if (group && actionMatch) commands.set(`${group} ${actionMatch[1]}`, actionMatch[2] === "unsupported(" ? "unsupported" : "admitted");
  }
  for (const match of read(join(repoRoot, "apps/cli/src/index.ts")).matchAll(/group === "([a-z]+)" &&\s*\n?\s*action === "([a-z-]+)"/g)) {
    commands.set(`${match[1]} ${match[2]}`, "admitted");
  }
  return commands;
}

function platformMcpTools() {
  const catalog = read(join(repoRoot, "apps/mcp/src/catalog.ts"));
  const source = read(join(repoRoot, "apps/mcp/src/index.ts")) + catalog;
  return new Set([
    ...[...source.matchAll(/"(knowledge_[a-z_]+)"/g)].map((match) => match[1]),
    ...[...catalog.matchAll(/^\s*"([a-z_]+\.[a-z_]+)":/gm)].map((match) => match[1]),
  ]);
}

const executorOperations = executorOperationCatalog();
const executorMcpTools = new Set([...executorOperations.keys(), ...verifyMcpTools()]);
const executorCommands = new Set(executorOperations.values());
const platform = platformCommands();
const platformTools = platformMcpTools();
for (const [name, minimum] of Object.entries(MINIMUM)) {
  const size = { executorOperations, executorMcpTools, platformCommands: platform, platformMcpTools: platformTools }[name].size;
  if (size < minimum) die(`catalog ${name} parsed only ${size} entries (expected >= ${minimum}); the parser or the source moved`);
}

const distCli = join(executorRoot, "dist/knowledge.js");
if (existsSync(distCli)) {
  const listed = JSON.parse(execFileSync(process.execPath, [distCli, "ops"], { encoding: "utf8", windowsHide: true }));
  const built = new Set(listed.map((entry) => entry.tool));
  for (const name of built) if (!executorOperations.has(name)) fail(`built executor exposes ${name} but the parsed source catalog does not`);
  for (const name of executorOperations.keys()) if (!built.has(name)) fail(`parsed source catalog has ${name} but the built executor does not (rebuild the executor)`);
}

const manifest = JSON.parse(read(join(skillsRoot, "manifest.json")));
const declared = new Map(manifest.skills.map((skill) => [skill.id, skill]));
const directories = readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
for (const name of directories) if (!declared.has(name)) fail(`skills/${name}/ exists but manifest.json does not declare it`);
for (const skill of manifest.skills) if (!directories.includes(skill.id)) fail(`manifest declares ${skill.id} without a skills/${skill.id}/ directory`);

const SURFACES = new Set(["executor-cli", "executor-mcp", "platform-cli", "platform-mcp", "workspace-files"]);
const filesOf = (directory) => {
  const files = {};
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[relative(directory, path).split("\\").join("/")] = read(path);
    }
  };
  walk(directory);
  return files;
};
/** Identical to the research run-pin installation digest: sorted relative paths, UTF-8 bytes. */
const contentDigest = (files) => createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))).digest("hex");

const codeSpans = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
  .concat([...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((match) => match[1].split("\n")));

const report = { skills: [], manifestDigest: contentDigest({ "manifest.json": read(join(skillsRoot, "manifest.json")) }) };

for (const skill of manifest.skills) {
  const directory = join(skillsRoot, skill.id);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
  const files = filesOf(directory);
  if (!files["SKILL.md"]) { fail(`${skill.id}: SKILL.md missing`); continue; }
  if (skill.path !== `${skill.id}/SKILL.md`) fail(`${skill.id}: manifest path must be ${skill.id}/SKILL.md`);
  for (const reference of skill.references ?? []) if (!files[reference]) fail(`${skill.id}: declared reference ${reference} is missing`);
  for (const surface of skill.surfaces ?? []) if (!SURFACES.has(surface)) fail(`${skill.id}: unknown surface ${surface}`);

  const body = Object.entries(files).map(([, text]) => text).join("\n");

  // 1. Declared operations must exist on their declared surfaces.
  for (const operation of skill.operations ?? []) {
    const known = executorOperations.has(operation) || executorMcpTools.has(operation) || platformTools.has(operation) || platform.has(operation);
    if (!known) fail(`${skill.id}: declared operation "${operation}" is not in any implemented catalog`);
    if (platform.get(operation) === "unsupported") fail(`${skill.id}: declared operation "${operation}" is an explicitly unsupported platform command`);
  }

  // 2. Every command spelled in the text must resolve, on one of the skill's declared surfaces.
  const surfaces = new Set(skill.surfaces ?? []);
  for (const span of codeSpans(body)) {
    const invocation = /^\s*(?:\$\s+)?knowledge(?:-verify)?\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/.exec(span);
    if (!invocation) continue;
    const pair = `${invocation[1]} ${invocation[2]}`;
    if (["help", "serve", "health", "ops"].includes(invocation[1])) continue;
    const onExecutor = executorCommands.has(pair);
    const onPlatform = platform.has(pair);
    if (!onExecutor && !onPlatform) fail(`${skill.id}: "knowledge ${pair}" is not an implemented command on either distribution`);
    else if (onPlatform && !onExecutor && platform.get(pair) === "unsupported") fail(`${skill.id}: "knowledge ${pair}" is explicitly unsupported on the platform CLI`);
    else if (onExecutor && !onPlatform && !surfaces.has("executor-cli")) fail(`${skill.id}: uses executor command "knowledge ${pair}" without declaring the executor-cli surface`);
    else if (onPlatform && !onExecutor && !surfaces.has("platform-cli")) fail(`${skill.id}: uses platform command "knowledge ${pair}" without declaring the platform-cli surface`);
  }

  // 3. Every MCP tool name spelled in the text must exist, unless the skill declares it absent on purpose.
  const absent = new Set([...(skill.absentOperations ?? []), ...(skill.artifactTypes ?? [])]);
  for (const name of absent) {
    if (executorMcpTools.has(name) || platformTools.has(name) || platform.get(name) === "admitted") fail(`${skill.id}: declares "${name}" unavailable, but it is now an admitted operation — update the skill`);
  }
  for (const span of codeSpans(body)) {
    for (const candidate of span.matchAll(/\b((?:knowledge|verify|schema|db|ingest|artifact|report|recovery|content|checkpoint|source)_[a-z0-9_]+)(\*?)/g)) {
      const name = candidate[1];
      if (candidate[2] === "*" || name.endsWith("_")) continue;
      if (executorMcpTools.has(name) || platformTools.has(name) || absent.has(name)) continue;
      if (/_(v1|json|md|id|ids|digest|sha256|key|dir|url|tokens|micros|schema|seq|state|kind)$/.test(name)) continue;
      fail(`${skill.id}: "${name}" looks like a tool name but is not in any implemented MCP catalog`);
    }
  }

  // 3b. A skill that owns a catalog prefix must name every operation the catalog exposes under it.
  for (const prefix of skill.requireCatalogPrefix ?? []) {
    const owned = [...executorMcpTools, ...platformTools].filter((name) => name.startsWith(prefix));
    if (!owned.length) fail(`${skill.id}: no implemented operation starts with "${prefix}"`);
    for (const name of owned) {
      if (!(skill.operations ?? []).includes(name)) fail(`${skill.id}: manifest omits catalog operation "${name}"`);
      if (!body.includes(name)) fail(`${skill.id}: catalog operation "${name}" is not documented in the skill`);
    }
  }

  // 4. A structural seal must never be described as admission.
  const flowing = body.replace(/\s+/g, " ");
  if (/\bseal/i.test(flowing)) {
    const separated = /seal[^.]{0,200}\b(not|never)\b[^.]{0,160}\b(admission|admitted|verified|verification|publication|published)\b/i.test(flowing)
      || /\b(admission|verification|publication)[^.]{0,140}\bseparate[^.]{0,140}\bseal/i.test(flowing)
      || /\bseal[^.]{0,140}\bseparate\b/i.test(flowing);
    if (!separated) fail(`${skill.id}: mentions sealing without stating that a seal is not admission`);
  }

  // 5. Relative markdown links must resolve inside the repository.
  for (const link of body.matchAll(/\]\((\.{1,2}\/[^)\s#]+|[A-Za-z0-9._-]+\.md)(?:#[^)]*)?\)/g)) {
    const target = resolve(directory, link[1]);
    if (!existsSync(target)) fail(`${skill.id}: broken relative link ${link[1]}`);
  }

  report.skills.push({ id: skill.id, version: skill.version, digest: contentDigest(files), files: Object.keys(files).sort() });
}

if (problems.length) {
  for (const problem of problems) console.error(`drift: ${problem}`);
  console.error(`${problems.length} skill conformance problem(s)`);
  process.exit(1);
}
const summary = { skills: report.skills.length, executorOperations: executorOperations.size, executorMcpTools: executorMcpTools.size, platformCommands: platform.size, platformMcpTools: platformTools.size };
if (process.argv.includes("--json")) console.log(JSON.stringify({ ...summary, ...report }, null, 2));
else console.log(`skills conformant: ${JSON.stringify(summary)}`);
