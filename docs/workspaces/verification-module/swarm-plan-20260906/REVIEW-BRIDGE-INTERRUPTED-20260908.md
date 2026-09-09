# Packet review bridge: interrupted implementation

The credit-limited subagents stopped during implementation. This is unfinished work, not an accepted review capability. No new adjudication migration was applied.

## Current draft

Canonical draft: `ai-engineer-db-contract/supabase/migrations/20260908020000_verification_adjudication_packet_review.sql`.

KS has preliminary decision request/result schemas, the `verification_adjudication_decision` operation vocabulary, and a step-map entry. It has no completed application submission service, persistence implementation, configured worker handler, transport, or dashboard decision control. Existing pending-subject behavior remains authoritative.

## Required before applying the draft

- Corrected in the unapplied draft: executor/control-plane now have tenant-RLS-scoped SELECT on reviewer grants, with no INSERT/UPDATE/DELETE authority. The rollback-only PostgreSQL check confirms access and tenantless isolation.
- Corrected in the unapplied draft: an invoker-security view computes quorum at read time. Only human-origin affirmations count; rejection and expiry withhold quorum. Tests execute the actual view definition over temporary engineering fixtures for threshold, synthetic exclusion, defer, rejection, and expiry. No canonical human-origin records were inserted.
- Test exact active lease/fence, rationale binding, packet parent closure, expiry, explicit reviewer authority, wrong tenant, and duplicate reviewer decisions in rollback-only PostgreSQL transactions before local application.
- Define retry and deferred-review behavior. One immutable decision per reviewer/subject currently prevents revising a deferred decision; provide an explicit follow-up subject or supersession design rather than overwriting history.
- Never map a shared dashboard service token or browser-supplied actor header to human origin. Human-origin requests need a bearer-resolved human identity and explicit reviewer authority. An optional server-only per-operator reviewer token can support the dashboard; absent that configuration, controls must remain unavailable.

Synthetic engineering decisions must remain distinguishable from human decisions and cannot satisfy human gold or admission gates. The bridge records review evidence; policy overrides and promotion remain separate human-controlled capabilities.

## Finish sequence

Finish and review canonical DDL/core implementation; run rollback-only schema and guard tests; apply the reviewed additive migration locally; regenerate/pin canonical types; implement HTTP/client/CLI/MCP command and read parity; add authenticated dashboard controls; run native isolated synthetic recovery/authorization tests and independent audit. Do not repeat provider generation when retained signed packets suffice.

## Coordinator continuation evidence

`internal/verification-review-draft-rollback-20260908-r2.json` records executed DDL/access/view-expression tests and successful rollback, SHA-256 `c1a2c93e7e09b8b67782bd5f2fefadaa136755e6337b21fba6f1cf8db0797849`. The migration remains unapplied. This is not an insertion/fencing, native human-review, or complete bridge proof.

### 2026-09-08 — local review schema applied and contract packed
Applied only 20260908020000_verification_adjudication_packet_review.sql after dry-run confirmed it was the sole pending migration. Canonical local database now has 142 applied migrations. No human grants or decisions exist; executor cannot insert grants. Generated database types regenerated and independently checked current; database typecheck passed. Canonical package is now 0.2.37, packed at internal/aiengineer-database-contract-0.2.37.tgz (SHA256 d0e75391334acbcd273d86398187f9eae792530e46dc7cb74e2203fb770b53c5). Consumer references remain 0.2.36 pending cutover. Receipt: internal/verification-review-schema-applied-20260908.json. Earlier unapplied statements are historical. Fresh-chain 142-migration audit, consumer cutover, native adapter recovery, production worker registration and transports/dashboard remain required. No acceptance promotion, remote database change or provider call.


### 2026-09-08 — 0.2.37 integrated and fresh-chain verified
All 72 Knowledge Services typecheck/test/build tasks passed (58 cached) in internal/verification-review-integration-0237-20260908-r2.log. First run retained at internal/verification-review-integration-0237-20260908.log: 58/63 tasks, existing offline benchmark test exceeded 15 seconds during parallel load. Serial rerun retained unchanged assertions/deadline and passed. Decision insert now satisfies the generated canonical database Insert type. Isolated fresh-chain audit applied all 142 migrations and independently read 142|20260908020000; its own container was stopped. Receipt internal/fresh-chain-audit-vr026-0237.json SHA256 464ddf53799e71a61a74a3f7fb9e3a53a7cbb08a1583fdce04c98e06d3ce92f8. All active consumers already verified on 0.2.37; read-only reference dashboard unchanged. Native full adapter recovery, production command/read transport wiring and dashboard review controls remain required. No acceptance promotion and no provider calls.

