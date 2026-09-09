import { defineConfig } from "tsup";

// Workspace packages are inlined so `dist/index.js` can be copied into a sandbox
// (Vercel Sandbox, Docker) and run with only the published runtime dependencies.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [
    "@aiengineer/knowledge-contracts",
    "@aiengineer/knowledge-policy",
    "@aiengineer/knowledge-verification",
  ],
  banner: { js: "#!/usr/bin/env node" },
});
