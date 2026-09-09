# SW-13 prototype compatibility cutover ledger

Status: implemented and locally verified on 2026-09-08.

## Implemented boundary

- `@aiengineer/knowledge-verification` now owns `prototypeSha256`,
  `resolvePrototypeTextLocator`, and `resolvePrototypeJsonPointer`.
- Exact text quote matching is translated through KS's canonical built-in selector
  resolver. The adapter first projects source text into the historic locator basis,
  so its returned `start` and `end` remain zero-based, half-open UTF-16 offsets in
  that basis.
- The three retained bases are `raw_utf16`, `lf_normalized`, and
  `lf_normalized_newlines_collapsed`. The last is intentionally adapter-local: it
  replaces whitespace surrounding a newline only, which differs from a general
  whitespace-collapse normalization.
- The legacy core's exported `sha256`, `resolveTextLocator`, JSON pointer path,
  and `verifyBundle` now delegate to KS-owned compatibility APIs. The legacy
  package retains only the 0.1 Zod input/output schema validation and a frozen
  private reference implementation for archival comparison.
- `verifyPrototypeBundle` intentionally reproduces the legacy result shape and
  IEEE-754 arithmetic. It does not mint authenticated provenance, establish a
  runtime-principal binding, perform semantic verification, or admit a policy.

## Frozen parity evidence

`prototype-compat.test.ts` pins these legacy return values:

- `sha256("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
- Exact raw quote `RAG was basically just a hack` resolves to `7:36` with digest
  `ceeff18e421941a228b863d1d0464c596dc0e0c936a22d8a79d790a1f38a7530`.
- Filler-normalized quote resolves to `0:46` with digest
  `e06a2515f4ae8f29ca2db0acf122784df012537da3cdfdab6f2f99a324094962`.
- JSON Pointer `/a/b~1c/~0key` resolves to `7` with digest
  `7902699be42c8a8e46fbbb4501726517e86b22c56a189f7625a6da49081b2451`.
- The legacy fixture bundle result serializes to SHA-256
  `fce3da0e8e4fad86a746429336f914343faa6b063606cafa9738f2d629dd3dff`.

## Commands and results

- `packages/verification/node_modules/.bin/vitest.cmd run src/prototype-compat.test.ts` — pass (3 tests).
- `packages/verification/node_modules/.bin/tsc.cmd --noEmit` — pass.
- `packages/verification/node_modules/.bin/tsup.cmd src/index.ts --format esm` and declaration emit — pass.
- `packages/verification-core/node_modules/.bin/tsx.cmd --test src/index.test.ts` — pass (5 tests).
- `packages/verification-core/node_modules/.bin/tsc.cmd --noEmit` — pass.
- After the bundle cutover: KS compatibility tests pass (4 tests), and legacy
  core tests pass (6 tests) with the frozen bundle-result digest above.

## Completion receipt

The legacy production entrypoint now contains only legacy schema validation and
delegation to the KS compatibility API. The previous generic evidence, arithmetic,
and bundle algorithms were removed from that entrypoint. The result digest above
is the immutable parity receipt for the retained historical fixture; negative
legacy tests continue to cover offset drift and self-verification rejection.

Differential receipt: the immutable checkpoint fixture is compared with delegated
KS behavior for offset drift (`497f585d9a990b8969ffca19d2416fbf7d784b310d6e46cb6963f5db08caeaab`)
and self-verification (`0b199a6e57190c277aed6ee39ab34aedc86c166eb510e363a115beb4667df795`).

The executable original was recovered only into the test fixture
`research_ingestion_systems_agent/packages/verification-core/src/testing/legacy-verify-bundle-reference.fixture.ts`
from checkpoint source SHA-256 `d862f907b6aa08a737d17ce9f1b9fe8a47f0b51d459a8708d68389d9bb1e8b36`.
Focused differential execution compares full result objects for the positive,
offset-drift, and self-verification bundles; it passed 7/7 legacy tests.
The expanded VR033 receipt records nine focused differential tests, immutable
source hashes, executed commands, and the rollback source path in
`VR033-PROTOTYPE-CUTOVER-COMPLETION-RECEIPT.md`.

The bounded VR001 current-source graph audit is recorded in
`VR001-SINGLE-ALGORITHM-OWNER-AUDIT-20260908.md`.

## Coordinator package-boundary correction

The agent initially wrote this ledger under a literal root `KS docs` directory and imported cross-repository TypeScript source directly. Root retained that original ledger, copied it to the canonical workspace path, replaced the source import with `@aiengineer/knowledge-verification`, and made the local dependency an explicit `link:` (consistent with the existing local research/KS links). The installed junction resolves to the canonical KS package, and the lock importer records the same link. No legacy generic verification algorithm is newly authoritative.

Root validation through the package entry: legacy 5/5 tests and typecheck pass; canonical compatibility 3/3 tests pass; `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts` passes for all 15 research workspace projects without installing/purging modules. Logs are under root internal: verification-prototype-package-parity-20260908.log, verification-prototype-package-typecheck-20260908.log, verification-prototype-compat-root-20260908.log, verification-prototype-lock-consistency-20260908.log. VR001/033 remain partial because verifyBundle's legacy contract/arithmetic is still staged for migration. Cross-repository runtime service calls remain HTTP; this link supplies the historical offline experiment compatibility facade.


## Independent cutover audit — 2026-09-08

- Receipt: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-prototype-cutover-independent-audit-20260908.json` (`sha256:977edb6ad3a301f0efcf0b4567e9b8507b28ea67535da3734d1b71add189204b`). The independently copied current-source manifest is `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-prototype-cutover-independent-source-20260908\manifest.json` (`sha256:7b14560113018d02028923995e21046ec220a5be71bd55138b2964772f3ecdbb`).
- Current KS compatibility test/typecheck passed: 4/4. Research package entry test/typecheck passed: 6/6. The research package manifest and lock importer both resolve `@aiengineer/knowledge-verification` to the canonical KS package link; the installed link resolves to that package.
- **Open cutover finding:** `research_ingestion_systems_agent/packages/verification-core/src/index.ts` still compiles private generic legacy verifier helpers at lines 40 (`verifyEvidence`), 122 (`calculate`), and 134 (`verifyBundleLegacyReference`). Active `verifyBundle` at line 231 delegates to the KS compatibility boundary and those helpers are neither exported nor called, but retaining them in the production entry prevents treating generic-implementation removal as complete for VR001/VR033.
- Safe completion: move the frozen reference helpers to an unexported test fixture/archive module; add an explicit differential parity test against the KS-delegating `verifyBundle`; remove their support imports from the production entry; retain a fresh machine source snapshot and rerun focused checks. This is an audit finding only; no acceptance matrix or status row was promoted.


Audit receipt clarification: `verification-prototype-cutover-independent-audit-20260908-r2.json` (`sha256:b4a2f20f10c1f0f68ff309d84f492a6ed5cbef00fdf8b596f9d6bf75788b40f2`) preserves the r1 receipt and adds the precise parity limit: current tests exercise frozen active outputs but do not directly differential-compare the retained private legacy reference across a fixture corpus. The proposed test-only archival move must add that comparison before cutover acceptance.
