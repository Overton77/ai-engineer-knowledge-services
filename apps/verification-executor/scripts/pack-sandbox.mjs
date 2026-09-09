#!/usr/bin/env node
/**
 * Pack `knowledge-verify` as a standalone npm tarball that can be installed inside a
 * sandbox (Docker / Vercel Sandbox) with `npm i -g <tarball>`. The bundle already inlines
 * every workspace package; only the two published runtime dependencies remain.
 *
 *   node scripts/pack-sandbox.mjs            → dist/sandbox/knowledge-verify-<version>.tgz
 *   node scripts/pack-sandbox.mjs --print    → print the tarball path only
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const distIndex = join(appDir, "dist", "index.js");
if (!existsSync(distIndex)) {
  console.error("dist/index.js missing — run `pnpm --filter @aiengineer/knowledge-verification-executor build` first");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const versionOf = (name) => JSON.parse(readFileSync(join(appDir, "node_modules", name, "package.json"), "utf8")).version;

const stage = join(appDir, "dist", "sandbox");
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "dist"), { recursive: true });
copyFileSync(distIndex, join(stage, "dist", "index.js"));
copyFileSync(join(appDir, "README.md"), join(stage, "README.md"));

const skillDir = join(appDir, "skills", "knowledge-verify");
if (existsSync(skillDir)) {
  const copyTree = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) copyTree(join(from, entry.name), join(to, entry.name));
      else copyFileSync(join(from, entry.name), join(to, entry.name));
    }
  };
  copyTree(skillDir, join(stage, "skills", "knowledge-verify"));
}

writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "knowledge-verify",
      version: pkg.version,
      description: pkg.description,
      license: "UNLICENSED",
      private: false,
      type: "module",
      bin: { "knowledge-verify": "./dist/index.js" },
      files: ["dist", "skills", "README.md"],
      engines: { node: ">=22" },
      dependencies: {
        "@modelcontextprotocol/sdk": versionOf("@modelcontextprotocol/sdk"),
        zod: versionOf("zod"),
      },
    },
    null,
    2,
  ) + "\n",
);

const packOutput = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--json", "--pack-destination", stage], { cwd: stage, encoding: "utf8", shell: process.platform === "win32" });
const packed = JSON.parse(packOutput)[0];
const tarball = join(stage, packed.filename);
const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
writeFileSync(join(stage, "TARBALL"), `${tarball}\n`);
writeFileSync(join(stage, "TARBALL.sha256"), `${digest}\n`);
if (process.argv.includes("--print")) console.log(tarball);
else console.log(JSON.stringify({ tarball, bytes: packed.size, sha256: digest, dependencies: ["@modelcontextprotocol/sdk", "zod"] }, null, 2));
