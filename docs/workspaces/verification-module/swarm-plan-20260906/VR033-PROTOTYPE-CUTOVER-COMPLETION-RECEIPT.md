# VR033 prototype cutover completion receipt

Date: 2026-09-08. Scope is the historical offline experiment compatibility
facade only; this receipt makes no universal correctness or policy-admission
claim.

## Immutable source and rollback

- Original source snapshot:
  `internal/verification-checkpoints/20260905-initial/research_ingestion_systems_agent/packages/verification-core/src/index.ts`
- Snapshot SHA-256:
  `d862f907b6aa08a737d17ce9f1b9fe8a47f0b51d459a8708d68389d9bb1e8b36`
- Test-only recovered implementation:
  `research_ingestion_systems_agent/packages/verification-core/src/testing/legacy-verify-bundle-reference.fixture.ts`
- Recovered fixture SHA-256:
  `709a5748fa4a9596c8786280121ea7f2020f201ff9f9469358b2e0cae36b0c9e`
- Rollback source is the snapshot path above. It is retained under `internal`;
  do not copy it back into the production package entrypoint. Revert the
  compatibility cutover through the repository change history only if rollback
  is explicitly required.

## Differential evidence

The delegated production facade was deep-compared with the recovered fixture for:

- passing, claimed-offset drift, and self-verification bundle results;
- exact, ambiguous, absent, filler-normalized, all three historical coordinate
  bases, and escaped JSON Pointer locator results;
- normalized-evidence review and metric arithmetic bundle paths.

Machine receipts: passing result
`fce3da0e8e4fad86a746429336f914343faa6b063606cafa9738f2d629dd3dff`;
offset drift
`497f585d9a990b8969ffca19d2416fbf7d784b310d6e46cb6963f5db08caeaab`;
self-verification
`0b199a6e57190c277aed6ee39ab34aedc86c166eb510e363a115beb4667df795`.

## Executed verification log

`packages/verification-core/node_modules/.bin/tsx.cmd --test src/index.test.ts`
completed with 9 passing tests. Immediately after, the command
`packages/verification-core/node_modules/.bin/tsc.cmd --noEmit` completed
without errors. The differential test file SHA-256 is
`23e97cb307b652b37096e764b2d937f4cc56aa1e8f1973e6ab2919cda6ac930a`.
