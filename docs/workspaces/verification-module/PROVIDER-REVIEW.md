# Coordinator provider boundary review

Early stable-framework review, before any live call. Findings describe initial inspected code; acceptance requires fixes and meaningful proof, not merely acknowledgment.

| ID | Finding | Required proof | Status |
| --- | --- | --- | --- |
| PR-01 | New schema validator duplicates the reviewed extraction gate, canonicalizes before bounded preflight and shallow-freezes caller input. | Reuse admitted extraction schemas; mutation/depth/string-bomb/description and locally revalidated output tests. | fixed; bounded review EV-033 |
| PR-02 | Fixed-task path validates message content as a closed empty object and requires a precontext entry. | Empty any-schema request plus separately validated task name/result protocol; actual safe OCR conformance, correct explicit aliases. | fixed; bounded review EV-033 |
| PR-03 | Unknown precontext task names are accepted and full precontext is returned inline. | Expected task/result admission and bounded canonical projection/authorized handles; raw precontext retained outside model-facing results. | fixed; bounded review EV-033 |
| PR-04 | Optional artifact sink, absent Gateway sink, and persistence only after successful parsing lose failed-call evidence. | Mandatory production artifact/accounting composition, exact bounded raw bytes retained before schema admission, errors and every dispatched attempt recorded. | fixed; bounded review EV-033 |
| PR-05 | rawResponseDigest hashes parsed canonical JSON instead of raw stored response bytes. | Raw digest equals registered raw bytes; any canonical digest is separately named. | fixed; bounded review EV-033 |
| PR-06 | Fixed-endpoint fetch follows redirects; body abort becomes retryable network failure; completion after artifact writes lacks active-execution check. | Redirect refusal, total body timeout, abort classification, cancellation before admission after persistence, no quality retry. | fixed; bounded review EV-033 |
| PR-07 | Gateway identities accept arbitrary family/prompt/schema/config declarations despite fixed implementation. | Derive/check actual model family and implementation digests, returned-model binding and bounded input before serialization. | fixed; bounded review EV-033 |
| PR-08 | Concurrent markDispatched callers both receive dispatched state and may send duplicate requests. | Atomic dispatch claim/fence; exactly one contender may call provider; uncertain/restarted attempts never silently redispatch. | fixed; bounded review EV-033 |
| PR-09 | New accounting tables lack explicit tenant RLS; artifact FKs are id-only and transition guard permits state rollback. | Tenant RLS/grants, tenant/artifact binding, immutable budget/attempt identity and legal monotonic transition tests. | fixed; bounded review EV-033 |
| PR-10 | Reserve and settle use opposite lock orders; settlement replay silently ignores changed cost/response and uncertain reconciliation is incomplete. | Consistent lock order, concurrent/restart tests, strict idempotent settlement, evidence-backed uncertain reconciliation and truthful over-reservation charge handling. | fixed; bounded review EV-033 |
| PR-11 | Independent real-Postgres eight-way reservation probe produced a budget primary-key violation: conflict handling targeted only the tenant/key unique constraint. | Atomic concurrent budget creation with all identity conflicts checked afterward; exactly four 250,000-micro reservations admitted under a 1,000,000-micro synthetic ceiling and the rest classified as budget exhaustion. | fixed; independently proved EV-031 |

Protocol evidence: [Interfaze Run Tasks](https://interfaze.ai/docs/run-tasks) explicitly distinguishes empty any response format from the provider-defined name/result returned on message content. The reviewed page also shows scraper output alias ai_scraper. Actual HTTP conformance must establish the native response shape; SDK wrapper examples must not be blindly treated as raw wire JSON.

No live-call, ZDR enforcement, shared-budget correctness, model quality or modality promotion is accepted by this initial source review.

## Coordinator review of the dispatch milestone

The inspected `claimDispatch` uses budget-before-attempt locking and refuses every already-dispatched attempt. This addresses the original duplicate-dispatch mechanism; the owner reports a real two-contender local proof. Independent acceptance is still pending the complete receipt and boundary tests.

Remaining concrete issues in the inspected milestone were sent to the owner together:

- Settlement still rejected actual charges above a reservation, and uncertain reconciliation accepted no response artifact. Actual charges must remain truthful; overruns must block subsequent dispatch rather than disappear from accounting. Estimated charges must never be settled as actual.
- The transition trigger omitted attempt ID, request artifact and estimate immutability; reserve replay omitted request-artifact and estimate comparisons.
- Gateway and Interfaze catch ordering preserved a retryable network error when body reading was cancelled. Completion after artifact persistence also needed an active-execution check.
- The artifact composer attached identical empty precontext bytes to different parents. Content-addressed governance would reject the later call; a request-bound envelope or explicitly absent optional precontext is required.
- Artifact/accounting failures were mapped to provider network failures. They require a distinct infrastructure failure classification.
- The live harness must reuse one persisted pilot budget across restarts and later benchmark runs. A fresh budget per execution would defeat the shared ceiling.

The synthetic live harness is authorized once these controls are composed. Review does not require another user approval. Full real-corpus quality evaluation and modality promotion remain separate evidence gates.

The independently reproduced PR-11 failure is retained at `internal/verification-provider-concurrency-review-32c0f0fb-9853-4fa5-ae68-e881d3521d87.json` (workspace-root internal directory), SHA-256 `a56457543e38ca3bc462f665466066d9937484ceb14cd2be9320cdc89f829880`. The repeatable probe is `internal/verification-provider-concurrency-review.mts`; it reads only local Supabase connection configuration, runs synthetic accounting transactions, and makes no provider calls. Later passing receipts must retain this failed evidence.

Expanded independent PR-09 role testing confirms `verifier_agent` sees its own four attempts and none under another, empty or malformed tenant context. The intended `app_reader` SELECT fails because schema `orchestration` USAGE is absent. Receipt `internal/verification-provider-concurrency-review-88cca0ce-7f91-4c23-8fa7-776fd17d74e5.json`, SHA-256 `817fe627bdc9bb5525a6b7cdb0cf4aa11f44536b2fc8cb99434ec3d622e50db8`, preserves seven passed checks and the permission failure. Reader usability and UPDATE denial must both pass after the narrow grant fix.

## Bounded coordinator acceptance — EV-033

The provider framework and four synthetic live routes are accepted for lab use. PR-01–11 mechanisms are corrected; earlier milestone descriptions and failure receipts are historical evidence, not current unresolved findings. Final independent checks pass verification 66/66 and application 18/18; the complete workspace verification log hash is independently matched. EV-031 proves concurrent reservations/fencing, actual role isolation and the migration chain; EV-032 verifies real saved request/response bytes and exact synthetic text extraction. Canonical vendor parity covers 89 active migrations, five TypeScript sources and archived/deferred SQL.

The artifact composer is no longer structurally an adapter dispatch sink. The exported accounted sink reserves and claims before returning dispatch authorization. Repeated raw responses and repeated nonempty precontext use content-level bytes plus request-bound envelopes. Cancellation/persistence failure remains distinct from provider quality failure. Actual overrun evidence is retained and subsequent claims/reservations stop when the shared ceiling is breached. No opaque provider costs are converted into invented zero charges.

Independent read-only accounting replay found exactly four inference attempts: two settled Gateway rows totaling 1,604 microdollars after upward microdollar rounding and two uncertain Interfaze reservations totaling 2,000,000 microdollars. Receipt `internal/verification-provider-live-artifact-review-1e0c36ac-0ef6-4b11-b925-66ec8be6b7e6.json`, SHA-256 `538e510e1041ab201fd618b082039dc512878159e5c4e34e40ba8d6df6977ca8`. Remaining available reservation capacity is USD 17.998396; this is not a claim that Interfaze billed USD 2.

All modalities remain lab-only. Interfaze billing evidence, other modality conformance, human-gold calibration and promotion are not proved. Production factories must derive actual transmitted inputs and accounting identities from trusted authorized data; the sink grant is not HTTP authorization. Whole-operation cancellation, service surfaces, immutable benchmark execution and production controls remain with later workstreams.
# Post-reset custody note — 2026-09-05

The local reset described in `LOCAL-RESET-RECOVERY.md` removed the original WS-06 database registrations and accounting rows. The pre-reset evidence remains valid for what it observed. The coordinator recovered all four original request/raw/envelope byte chains by exact digest from preserved Storage files without new calls or reconstructed metadata: `internal/verification-ws06-recovery-review-0c29bb9e-deda-4302-9ba1-4e39ca0c1e00.json`, SHA-256 `c3c8ecef46a61c241279d7e8c7e75c03ae56dfeb3f31c43cabffd581f512138c`. Current replay must state this new custody and original metadata loss. The old budget pointer is historical; further dispatch uses only the reviewed successor workflow with prior liabilities carried forward.
