import { defineConfig } from "tsup";

// Workspace packages are inlined so each `dist/*.js` can be copied into a sandbox
// (Vercel Sandbox, Docker) and run with only the published runtime dependencies
// (@modelcontextprotocol/sdk, zod, pg). Splitting is off so the two bins stay self-contained.
export default defineConfig({
  entry: ["src/index.ts", "src/knowledge.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^@aiengineer\//],
  banner: { js: "#!/usr/bin/env node" },
});
