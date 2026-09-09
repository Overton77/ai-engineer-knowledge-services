# Component drift comparator focused review — 2026-09-08

Scope: bounded application-level runtime tests for compareVerifiedComponentVersions; no database, provider, network, or production persistence calls.

The focused Vitest command corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-component-drift.test.ts passed **4/4 tests**:

- Two signed audit-manifest artifacts derive all five dimensions (provider, model, parser, grader, policy) when each changes.
- Equal signed manifests produce an empty changed-dimension set.
- Unsigned and cross-tenant artifact bindings fail closed; the resolver uses trusted registered bytes and Ed25519 verification.
- Caller artifact input is mutated immediately after comparator invocation; the comparator still succeeds from its pre-await snapshot, proving function-bearing resolver/verifier ports are not cloned and data is isolated.

Fixtures use the production signing/sealing path and the test-only relative prototypeClaimInput fixture. No test-only fixture was added to public exports. The test found and fixed its own fixture issue by keeping resolver registration state independent from the mutated caller object; the final production behavior passed unchanged.

Source hashes:

- comparator: 0e752acec3d3b8ff5bbbded07fddd6d116667a9a4889b2e904a537a75c4e9061
- focused test: f11d3c0228ff54fa02ee779897efeb2e2197033cd529c08cd8f0a4efff2df861

Receipt: internal/verification-component-drift-comparator-test-20260908.json.
