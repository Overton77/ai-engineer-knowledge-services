// Architecture rules for FINAL-LAYOUT section 4 as the workspace stands today (slice Q0).
// Run after `pnpm build`: workspace packages export `dist/`, and pnpm links them from node_modules, so an edge to another
// workspace package resolves (through the symlink) to its real `packages/<name>/dist/...` path, which the rules match.
// Known violations live in tools/quality/boundaries-baseline.json and may only shrink; see tools/quality/README.md.

const TEST_PATH = String.raw`(^|/)(tests?|__tests__)/|\.(test|spec)\.[cm]?[jt]sx?$`;

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-app-to-other-app",
      comment:
        "An app must not import a module of another app, including relative paths into its src (FINAL-LAYOUT 4.1). Tests are not exempt.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "apps-import-host-contracts-client",
      comment:
        "Production app code imports only packages/host, packages/contracts and packages/client from the workspace (FINAL-LAYOUT 4.1); transport libraries from node_modules are allowed. Tests are exempt.",
      severity: "error",
      from: { path: "^apps/", pathNot: TEST_PATH },
      to: { path: "^packages/", pathNot: "^packages/(host|contracts|client)/" },
    },
    {
      name: "host-imports-no-app",
      comment: "packages/host is the composition root apps call; it must not import an app.",
      severity: "error",
      from: { path: "^packages/host/" },
      to: { path: "^apps/" },
    },
    {
      name: "packages-import-no-apps",
      comment: "Packages must not import apps.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "knowledge-db-no-persistence-in-production",
      comment:
        "Production knowledge-db must not depend on persistence (R1 inversion, slice 5A); its tests may.",
      severity: "error",
      from: { path: "^packages/knowledge-db/", pathNot: TEST_PATH },
      to: { path: "^packages/persistence/" },
    },
  ],
  options: {
    // Edges into other workspace packages are recorded but their `dist/` and dependencies are not traversed.
    doNotFollow: { path: ["node_modules", "(^|/)dist/"] },
    // Count type-only imports too: they still couple the layers.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: { text: { highlightFocused: true } },
  },
};
