# Unit 0 inventory evidence

`inventory.mjs` records the thirteen source packages named in unit 1. It reads tracked test-file paths through `git ls-files`, resolves public exports through the installed TypeScript 7 compiler's symbol graph, imports each built `dist/index.js` to record actual runtime names, and checks the declared workspace manifest graph for cycles. Built files are untracked: their SHA-256 digests identify the bytes inspected but do not prove which source commit produced them.

`pending-before-exports.json` and `pending-before-tests.json` are observed captures from commit `82965b3c2087784297728bbaac42717a266cf23e` after the 28-package build passed. They remain **pending**, because the full baseline verification gate still has a missing-judge failure outside these thirteen packages. Both captures record a dirty working tree. The built runtime exports are identified by byte digests, but the build output is untracked, so the digests alone do not prove source provenance. Do not treat these captures as a green Unit 0 acceptance or rename them to `before*.json` until the coordinator resolves the full gate.

The pending export capture has 422 compiler-resolved source names and 189 imported runtime names across thirteen packages, no merge-group name collisions, and no manifest cycles. The pending test capture covers all 78 tracked test files, including 18 example tests: 684 test identities, with 652 passed, 32 skipped, and none failed. Every test run exited zero. File identities agree between the two captures.

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

The pending test capture was run sequentially at a maximum of two Vitest workers per package. The script reports skipped tests as skipped and records package failures independently; it does not substitute for the full `verify` gate.
