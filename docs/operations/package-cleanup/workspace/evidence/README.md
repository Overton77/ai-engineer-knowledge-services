# Unit 0 inventory evidence

`inventory.mjs` records the thirteen source packages named in unit 1. It reads tracked test-file paths through `git ls-files`, resolves public exports through the installed TypeScript 7 compiler's symbol graph, imports each built `dist/index.js` to record actual runtime names, and checks the declared workspace manifest graph for cycles. Built files are untracked: their SHA-256 digests identify the bytes inspected but do not prove which source commit produced them.

There is no `before.json` yet. The script-development capture was removed because its runtime fields came from an earlier static parser version. Create the baseline capture only after a successful build and full verify.

From the repository root, after the baseline gate:

```powershell
node docs/operations/package-cleanup/workspace/evidence/inventory.mjs collect before docs/operations/package-cleanup/workspace/evidence/before.json
```

After unit 1's four packages are built:

```powershell
node docs/operations/package-cleanup/workspace/evidence/inventory.mjs collect after docs/operations/package-cleanup/workspace/evidence/after.json
node docs/operations/package-cleanup/workspace/evidence/inventory.mjs compare docs/operations/package-cleanup/workspace/evidence/before.json docs/operations/package-cleanup/workspace/evidence/after.json
```

The comparison exits nonzero for missing or added source/runtime names, type/value classification changes, missing or extra tracked test files (including example tests), or unavailable runtime exports. Inspect `collisions` and `manifestGraph.cycles` in each capture; collection exits nonzero if the declared graph has a cycle or built runtime imports fail.

`test-inventory.mjs` runs packages sequentially with at most two Vitest workers per package and stores test names and outcomes, while keeping raw Vitest JSON in a disposable OS temporary directory. Run it only after the coordinator releases test execution:

```powershell
node docs/operations/package-cleanup/workspace/evidence/test-inventory.mjs collect before docs/operations/package-cleanup/workspace/evidence/before-tests.json
node docs/operations/package-cleanup/workspace/evidence/test-inventory.mjs collect after docs/operations/package-cleanup/workspace/evidence/after-tests.json
node docs/operations/package-cleanup/workspace/evidence/test-inventory.mjs compare docs/operations/package-cleanup/workspace/evidence/before-tests.json docs/operations/package-cleanup/workspace/evidence/after-tests.json
```

The test command has not been run as part of this tooling change. It reports skipped tests as skipped and records package failures independently; it does not substitute for the full `verify` gate.
