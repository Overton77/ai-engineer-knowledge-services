# SW-02 adjudication terminal-read progress

## 2026-09-07 boundary

This slice adds a typed read of a completed `requestAdjudication` operation whose only durable outcome is an immutable pending human-review subject. The public resource will contain compact target/review/source summaries and artifact ID+digest references. It will not expose object keys, packet bytes, raw evidence, signer keys, credentials, requester internals, human decisions, authority grants, overrides, or changed admission state.

The native reader must authenticate the exact tenant operation, durable request, step input, receipt, terminal event, output digest, event fence, packet artifact registration and bytes, immutable subject row, exact packet/row parity, source verification run, and packet parent closure. It will then re-run the existing server-owned adjudication preparer, which itself uses the canonical signed audit inspection/replay factory and server-configured trust, and require the recomposed packet to equal retained canonical bytes. No caller-supplied trust or inspection algorithm will be added.

Ownership remains outside the repository and is supplied by the existing server-side operation read authorizer before any resource is returned. API/client/CLI/MCP integration is assigned to root/dashboard after the contracts, application service, and persistence reader freeze.

Owned files are new adjudication-read contract/application/persistence sources and focused tests, plus their package barrel exports and this ledger. The EV117 producer files remain frozen and unmodified.

## 2026-09-07 implemented checkpoint

The strict terminal resource, application projection, and native PostgreSQL/Storage reader are implemented. The native reader verifies the canonical operation request and step hashes; actor, attempt, mission, work item and external-execution fields; the explicit attempt-to-work-to-mission relation when a work item is present; the receipt, terminal event, output hash and fence; packet registration metadata and canonical bytes; full packet parent handles; every immutable subject field; the source verification run and producer operation family; and a fresh server-owned packet preparation replay. Subject creation fencing may precede a recovery receipt fence but cannot exceed it. The fresh replay is bounded with `Promise.race`, so a port that ignores its abort signal still fails closed on deadline. A second native snapshot rejects terminal drift.

The public result contains only the pending subject status, target digest, server-recorded review requirements, original policy outcome, compact signed source references, replay proof digests, and terminal fence. It fixes `humanDecisionRecorded` and `admissionChanged` to false and carries no packet bytes, object keys, evidence bodies, signer material, grants, credentials, decision, or override.

Focused evidence:

- `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/adjudication-reads.test.ts`: exit 0, 2/2.
- `corepack pnpm --filter @aiengineer/knowledge-contracts typecheck`: exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-adjudication-reads.test.ts`: exit 0, 3/3.
- `corepack pnpm --filter @aiengineer/knowledge-application typecheck`: exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-adjudication-reads.test.ts`: exit 0, 4/4, including hostile event/subject/source/ownership/replay drift, future creation fence, nonterminal privacy, and a noncooperative replay timeout.
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck`: exit 0.
- Dependency-order builds of contracts, application, and persistence: all exit 0 after the final reader changes.

Current source SHA-256 values:

- contracts source `7bd083d0408c66f4c58dcb6005ad46cd92bb535d5f7733418c69bbe043804118`; test `ac4ef0d482afba43f4f8f78b580f8a4b24f9bff1e6e410ae3e66730de82d6dfe`.
- application source `98f319287f22801de0bd00199546ad68357a0d051b6efac72d235bf71ca45f53`; test `71f96921a300b7b7a36a4c85703c251c7ff58cbda97f5b118d12991f9a586d72`.
- persistence source `ccfa7994915a1518fec5105fea93dc7200c93f3d127ffed51e79e41a79316c36`; test `eeda7a241b3ec363a4992fbbe04e889f3ee9b535ac73d3f3a7ff6d70693f0ab1`.

Root owns the retained read-only native proof over all eight EV117 subjects and its hostile fixtures. Dashboard owns API/client/CLI/MCP transport. The transport service must authorize `verification_adjudication` operation ownership before constructing the repository and must inject a packet replay backed by `VerificationAdjudicationRequestApplicationService.prepare` plus the canonical server-owned audit inspection trust composition and stored packet review requirements. No caller trust or caller review requirements are accepted. Decision and override reads remain outside this subject-only slice.

## 2026-09-07 native and public completion checkpoint

The retained native reader proof completed over all eight EV117 subjects and six hostile cases. Receipt `internal/verification-adjudication-native-reads-372a7139-b497-4d19-b0e5-48ef304686d8.json` has SHA-256 `89190cca84e74676886a66f849e92b0a6f4035bff33a3d6ce0a78fe164233fd3`. It is read only and covers the existing claims/report subjects plus future subject fence, reason, ownership, metadata, event, and noncooperative replay failures.

The canonical audit trust composition and adjudication request composition were moved without algorithm changes from the worker app into neutral persistence runtime modules. The worker now wraps and re-exports those shared factories. The API runtime uses the same factory, server public keys, registered audit and projection grants, and exact stored packet review requirements. It authorizes only `verification_adjudication` operations before any artifact access and scopes artifact access to the authorized tenant and the three canonical purposes `verification_replay`, `policy_replay`, and `verification_admission`. Its parser port always throws because public reads may hydrate already-admitted projections but cannot parse or write.

Runtime verification:

- persistence typecheck/build: exit 0.
- worker typecheck/build: exit 0; audit/adjudication focused suites 9/9.
- API typecheck/build: exit 0; runtime configuration and authority suite 3/3; adjudication route suites 3/3.
- The first public proof failed closed when `policy_replay` was absent from the scoped purpose allowlist. No receipt was produced by that failed execution. The allowlist was corrected and given a direct wrong-purpose/wrong-tenant regression test.
- Final command: `corepack pnpm exec tsx --tsconfig scripts/tsconfig.verification-adjudication-public-reads.json scripts/prove-verification-adjudication-public-reads.ts`; exit 0 in 20.0 seconds.
- Final immutable receipt: `internal/verification-adjudication-public-reads-1c8dd352-4837-4e03-98fa-17ebf4814937.json`; SHA-256 `0b2247b762210bc4ed6956d2a14d5e8489eff587c800c52af1a6d3b10bbbd963`.
- The final proof returned all eight retained subjects identically through direct application, HTTP, typed client, CLI, and MCP paths and passed six negative controls: unauthenticated, authenticated but unowned actor, wrong tenant, missing/denied operation, wrong operation family, and cancelled operation. Native operation/artifact/subject counts were unchanged.

Shared runtime source SHA-256 values at the successful proof:

- persistence audit runtime `79c28a7e55bf7c755b12ec85723879525c300f4fe321aa5c362afc0914afecbf`.
- persistence adjudication runtime `8f22dec0993b14e62bca98bdb3e416fdaac7a5cbe21c7690e3bf6104daabba89`.
- worker audit wrapper `7a98381e1b102e35ea23e5bb86552c52ee6bacd74ff944fa2b1115bc281bd815`; adjudication wrapper `75aed4bfafae89a95e64254d05f49558757940a48f6527a7e3d3a06098e12781`.
- API adjudication read runtime `4909a64f0dd4c1dedb17da823a65a2e691eb8e09befff4436ff8dd28f32504e0`; test `20d6769aef19dffbfe6bcaa2a05d8c6e6d21880d818bf5d6cacfb9591ef51add`.

This completes public access to a pending subject only. It does not create, represent, or authorize a human decision, reviewer grant, override, or admission change.
