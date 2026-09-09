# Current modules and engineering invariants

## Ownership and package map

| Boundary | Current location | What is implemented / how to interpret it |
|---|---|---|
| Contracts | packages/contracts/src/verification; generated schemas/OpenAPI | Strict evidence, operation, benchmark, publication and reconciliation shapes. Contract validity is not semantic truth. |
| Pure verification | packages/verification/src/{deterministic,selectors,extraction,claims,authority,semantic,provenance,providers} | Mechanical checks, selector/evidence primitives, bounded semantics/provider ports. Review each modality's actual admission; a union member alone is not support. |
| Domain/policy | packages/domain and packages/policy/src/verification* | Deep immutability and separately versioned policy; deterministic failure cannot be overridden by semantics. |
| Application | packages/application/src/verification* | Admission, execution composition, replay, publication, read projections, benchmarks, reconciliation signature/evidence admission. |
| Persistence | packages/persistence/src/verification* and postgres.ts | Registered artifacts, scoped accounting, native execution/capture/publication/ledger integration; canonical schema comes from DB-contract. |
| Runtime | packages/runtime; apps/worker/src/verification* | Durable worker leases, canonical step completion, configured providers, sealing/replay and extraction recovery. |
| API | apps/api/src/verification*, server.ts,index.ts | Authentication, ownership, capability admission, compact reads and mutation adapters. |
| Client/CLI/MCP | packages/client-typescript/src/client.ts; apps/cli/src/commands.ts; apps/mcp/src/index.ts | Shared HTTP facade; no copied verification algorithms. |
| Evaluation | packages/evaluation/src/verification*; catalog/verification-benchmarks | Statistics, benchmark inputs/execution/reports. Engineering fixture labels must not become human gold. |
| Parser | services/verification-parser; packages/conversion/src/verification-parser* | Reviewed isolated parser/projection implementation and source-transform lineage. |
| Orchestration consumer | ../ai-engineer-mission-control | Local dispatch/cancellation/recovery/Temporal evidence; Cloud/cutover requirements still open. |
| Dashboard/human review | Specification WS-11 / consuming app | Full required user workflow remains unaccepted. Do not claim it from backend reads. |

Generated inventory contains actual current files and SHA256; consult it when names in older handoffs have changed. Earlier WS-08 documents often begin with now-obsolete remaining-work statements. Later EV entries supersede those statements only for their named bounded slice.

## Structured extraction end-to-end

1. The API authenticates the actor, resolves server-owned mission/deployment/capability context and admits exact registered capture/representation/schema inputs.
2. The canonical worker acquires a fenced lease. Runtime configuration, original code/source custody, profile and parser identity are bound in the native execution artifact before provider reservation.
3. Native profile admission hydrates immutable source/projection/schema artifacts and builds bounded selected evidence. Current fixed-leaf proof does not establish arrays/open-object/dynamic evidence support.
4. Accounting reserves against the budget and claims exactly one original dispatch. Dispatch UUID/fence and request identity are immutable.
5. Raw response, envelope and transport/status capture are retained before interpretation. Known reported cost can settle; missing cost remains uncertain and reserved.
6. Accepted producer output creates an **unverified candidate** with shape-only validation and provenance. A provider is not its own verifier. Captured failures use the dedicated failure publication path.
7. Success/failure publications sign artifact custody, original execution, profile, response and provider-call accounting snapshots. Terminal canonical receipts bind exact native result bodies and original step input.
8. Replacement workers recover already published results instead of rerunning the provider. Terminal reads hydrate real registered bytes, verify signatures/native relationships and recheck receipt state before exposing compact output.

Important files: apps/worker/src/verification-structured-extraction-runtime.ts; packages/application/src/verification-structured-extraction-*; packages/persistence/src/verification-structured-extraction-*; apps/api/src/verification-structured-extraction-reads-runtime.ts. Locate exported classes via inventory and source rather than inventing a parallel pipeline.

## Recovery and terminal-state distinctions

- Actual post-publication/pre-terminal SIGKILL replacement is proved for success and captured failures (EV-090).
- Actual post-dispatch/pre-response SIGKILL replacement is proved for both providers (EV-091): mark dispatched accounting uncertain under the replacement lease, then fail non-retryably. There is no captured failure publication when no response exists.
- A failed operation, failed step, cancelled operation, captured provider failure and incomplete lifecycle are distinct states. Canonical cancellation may release the lease while leaving the step running; do not relabel it cancelled without evidence.
- A dispatched or uncertain original call must never be automatically redispatched merely because a lease expired or a new worker arrived.
- Partial retention, different cancellation windows and crash points between artifact registration/lifecycle transitions are not covered by the two proven process-death windows.
- Runtime/source identity changes fail closed. No broad upgrade allowlist has been established for replay/recovery.

## Provider reconciliation implementation

Contract: packages/contracts/src/verification/provider-reconciliation.ts. Strict signed decision binds tenant, operation/step, provider attempt/budget/provider/model, original dispatch UUID/fence, request digest, full execution/request/billing handles, original liability state/reserve, actual cost, issuer/ticket and <=24h validity. Purpose is provider_accounting_only and redispatchAuthorized is false. Actual cost may exceed reservation within the global bound; the overrun must remain visible.

Application: ProviderReconciliationAdmission hydrates actual registered bytes, validates native ancestry/execution mode/request and signature, checks configured issuer/provider/basis authority, freezes output and brands a per-instance permit. A caller clone or a permit from another instance is rejected. Synthetic execution requires synthetic_fixture basis; opaque supplier billing evidence is an operator assertion, not automatic proof of billing truth.

Persistence: PostgresProviderReconciliationStore.apply checks the live permit, locks the terminal extraction operation first, rechecks expiry, then inserts the immutable ledger or returns an exact existing entry. Conflicting artifact/body is rejected. Native trigger locks budget/provider and atomically releases reservation and adds actual cost. Original response and dispatch references remain unchanged. Allowed terminal operations are succeeded,failed,cancelled. Provider state must be dispatched/uncertain for a new decision.

Historical reads: ProviderReconciliationAdmission.verifyEvidenceAt verifies at the native appliedAt time with a separate issuer and returns no usable mutation permit. PostgresProviderReconciliationReadRepository binds actual ledger, terminal operation and settled provider state, hydrates/signature-checks retained evidence and rechecks the snapshot after I/O. This is necessary for expiry-safe audit reads; calling admit with a changed clock in mutation code is not a substitute.

Runtime: apps/api/src/verification-provider-reconciliation-runtime.ts filters configured grants by authenticated actor/tenant, checks original ownership, restricts signature admission to matched grants, and compares operation/provider-attempt path IDs before apply. Both read and mutation use control_plane for ledger access. Ordinary executor_service cannot insert reconciliation decisions.

Native migrations:

| Migration | Purpose |
|---|---|
|327|Dedicated registered reconciliation artifact type.|
|328|Immutable tenant ledger, full registered-handle/native decision binding, atomic settlement and exact reconciliation claim guard.|
|329|Exact ledger-authorized settlement can preserve a missing response; ordinary settlement still requires response evidence.|
|330|Terminal operation predicate includes succeeded as well as failed/cancelled.|

SQL does not itself verify Ed25519. The trusted application issuer and restricted control_plane insertion boundary are material security assumptions. Native SQL validates hashes, registered artifact type/ancestry, original durable identity, time and accounting transition. Do not grant broad insertion to worker/browser roles.

## Other accepted bounded foundations

- Foundation deterministic/contract reviews: FOUNDATION-REVIEW.md and HANDOFF-WS-01-02.md. Mechanical checks include source/digest/selector/identity/units/numeric replay and independence; all-modalities acceptance is not implied.
- Persistence and parser/admission: PERSISTENCE-REVIEW.md, PARSER-REVIEW.md, ADMISSION-REVIEW.md and HANDOFF-WS-03/04*. Native bytes and capture-transform lineage are the authority.
- Semantic/policy kernel: SEMANTIC-POLICY-REVIEW.md and HANDOFF-WS-05.md. Bounded synthetic semantic adapters and immutable recorded policy input replay exist; production evidence-closed semantic workflows/gold calibration remain open.
- Metrics: WS-08-METRIC-* and sealing/replay reviews. Configured mechanical metric verification, trusted provenance, terminal run recording and native replay have local evidence. Mechanical success is not clinical or policy admission.
- Benchmarks: WS-08-BENCHMARK-* cover registered input/profile/source projections, execution/publication, durable comparison and reads. WS-07-INDEPENDENT-ACCEPTANCE.md records the paid engineering pilot and corrected V5 reports. Review input/case/label custody before claiming full frozen benchmark acceptance.
- Mission Control: WS-10-* and EV-043–048 record local authenticated dispatch, duplicate/cancellation/uncertain submission recovery and Temporal history replay. Real Cloud/EVE/Cursor integration is not established by local replay.

## Non-negotiable invariants

One authoritative algorithm owner; immutable content-addressed registered evidence; deterministic-before-semantic monotonicity; producer/verifier independence; strict server-owned trust and tenant scope; full evidence hydration rather than claimed digests; append-only decisions/publications; no uncertain redispatch; no unknown cost silently converted to zero; artifact-custody signatures never relabelled as truth; human gold only from actual qualified humans; promotion remains human-controlled; no deletion of legacy implementations until parity/cutover/rollback evidence exists.
