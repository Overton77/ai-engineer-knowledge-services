# SW-02 verification adjudication progress

## 2026-09-07 request-subject implementation boundary

The initial implementation is limited to `requestAdjudication`: a caller requests review of one assertion, evidence edge, or completed signed run; the server replays the exact registered claims/report audit artifact with trusted keys and runtime bindings; the worker composes and registers an immutable adjudication packet; and the native ledger appends a packet-bound pending subject through the request operation's live lease. Success means only `pending_human_adjudication`. It records no human decision, policy override, admission change, or human-gold label.

The full draft `ai-engineer-db-contract/docs/workspaces/verification-adjudication/20260907012000_verification_adjudication_ledger.sql` is not applied. Independent review found that its decision request semantics and operation kind are undefined, and that its policy override lacks an independent operation/lease/actor boundary and exact authorizing-decision closure. Root therefore retained that draft and assigned a separate subject-only migration to the database-contract owner.

The packet contract will bind the durable request digest and authenticated requester actor kind/ID; exact target plus its canonical object digest; reason/note; server-owned eligible reviewer roles and quorum; exact full handles for the signed run manifest, verification bundle, deterministic result, policy definition, recorded policy inputs, policy decision, and optional report gate; original policy outcome; and canonical signature/replay digests. The packet's artifact parents must be exactly those retained artifacts, including recorded policy inputs and policy decision, with no duplicates. Request input cannot supply reviewer identity, reviewer role, quorum, approval, decision, override, or human-gold status.

Owned source files are new adjudication-specific contract, application, worker, and persistence files with focused tests plus only the index exports required to compile them. The persistence adapter and native proof remain dependent on root review/application of the subject-only migration and regenerated DB contract. No migration, database, Storage, provider, parser, or remote mutation has occurred in this implementation phase.

## 2026-09-07 subject schema review and local dependency

The subject-only SQL was initially withheld for three row/packet gaps: it lacked the canonical public request payload digest, the claims/report run family and producer-operation binding, and the exact verification-bundle digest. The corrected migration adds `request_payload_sha256`, `run_kind` with a succeeded `verification_claims`/`verification_report` producer binding and report-gate iff constraint, and `bundle_sha256` with exact artifact admission. The remaining packet fields map to native columns: target and canonical target digest, requester actor and note, reviewer roles/quorum/expiry, manifest artifact and internal manifest payload digests, deterministic result, policy definition, recorded policy inputs, policy decision, original outcome, audit payload, optional report gate, packet artifact, and exact packet parent closure.

Root applied the reviewed additive migration `20260907012000_verification_adjudication_subject_ledger.sql` locally and installed database contract `0.2.33`. Root's independent read-only post-apply check reported 138 migrations, 72 artifact types, one RLS-protected subject table, and no adjudicator-authority roles. SQL deliberately does not hash `jsonb` text as RFC 8785. The KS atomic adapter recomputes the canonical public request digest from the durable request and packet bytes while SQL independently binds the whole operation request digest, step input digest, exact public fields, authenticated actor/context, active lease, and source run.

## 2026-09-07 implemented bounded runtime

The contracts define the server-composed immutable packet, pending-only output, strict operation result, and safe error taxonomy. Quorum is bounded to 1..16 distinct human reviewers and is intentionally independent of the number of eligible role categories. A request can never supply reviewer roles, quorum, decision, override, or admission status.

`VerificationAdjudicationRequestApplicationService.prepare` accepts only canonical signed claims/report inspections from its injected server-owned audit port. It binds the exact registered manifest handle and tenant, canonical signature and policy replay summaries, all retained full handles and exact manifest parent closure, run family, and target object digest. It copies canonical packet bytes without freezing a typed array. The worker independently canonicalizes and hashes those bytes, uses non-overlapping fail-closed cancellation polling, and returns only `pending_human_adjudication`, `humanDecisionRecorded:false`, and `admissionChanged:false` after the native commit.

`PostgresVerificationAdjudicationRepository.commitPendingSubject` snapshots and validates all caller-owned values before its first await, writes and rehydrates immutable CAS bytes, locks the exact running operation/step/current lease, reparses and hashes the durable request and step, verifies every full packet parent handle against native registration, then registers packet artifact metadata and appends the pending subject in one database transaction. Recovery under a higher active fence returns the original packet metadata and immutable subject; it verifies current lease ownership while retaining the original creation lease in the subject. Stored packet recovery also binds producer attempt and mission. A caller mutation during Storage I/O, divergent packet/parent metadata, stale lease, or producer collision fails closed.

No decision, adjudicator grant, revocation, override, admission change, or human-gold runtime exists in this slice. Synthetic test actors and review requirements are fixtures only and do not represent human authorization.

## Focused verification

- `corepack pnpm --filter @aiengineer/knowledge-contracts typecheck` — exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/adjudication.test.ts src/verification/semantic-observation.test.ts` — exit 0, 2 files, 6 tests.
- `corepack pnpm --filter @aiengineer/knowledge-contracts build` — exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-adjudication.test.ts` — exit 0, 1 file, 4 tests.
- `corepack pnpm --filter @aiengineer/knowledge-application typecheck` — exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-adjudication.test.ts` — exit 0, 1 file, 6 tests.
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck` — exit 0.
- `corepack pnpm --filter @aiengineer/knowledge-persistence build` — exit 0 with final adjudication export.
- `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-adjudication-activity.test.ts src/verification-adjudication-runtime.test.ts` — exit 0, 1 discovered file, 4 activity tests. The root-owned runtime config suite was run separately and reported 2/2.
- `corepack pnpm --filter @aiengineer/knowledge-worker typecheck` — exit 0.

## Frozen owned-source hashes before native proof

- `f8a8a841acb20d99df15e4dc9a2e2937708d6ca6f15fd68633d25490fa2cb1a7` `packages/contracts/src/verification/adjudication.ts`
- `b65b2d974755e0e50d9e6283ce9359f297abb108e2a6827fce2c0bb49b818f41` `packages/contracts/src/verification/adjudication.test.ts`
- `2698d364574120d6821c48657c8172166216a673edfeb926dc3f8a7d4ff0dac3` `packages/application/src/verification-adjudication.ts`
- `35bac3ef6e12c77cb1ed3f18bc134e6876e835452eebe64c6f385c57d1cbc6fb` `packages/application/src/verification-adjudication.test.ts`
- `27dcb8db6efc629b4ee43e0c10727881756dbe8df2c907dca9df2f33622729b0` `packages/persistence/src/verification-adjudication.ts`
- `2f4027febc06d14acfd440e9419c552c28c715bc211aac852df555f375927488` `packages/persistence/src/verification-adjudication.test.ts`
- `9f0d2534ff21e6c6d90c49f1ac13fd92b4862908e252f4aa4bef8d64737308da` `apps/worker/src/verification-adjudication-activity.ts`
- `c8330869650b996b2fc8ef317448fa2b28c391a08cc208f7c5c62de4819e722d` `apps/worker/src/verification-adjudication-activity.test.ts`

Native proof is authorized and prepared by root but had not started at this checkpoint. It must retain startup/failure journals and cover claims and report subjects, wrong-digest pre-enqueue denial, cancellation with no subject, and interruption after subject commit followed by a higher-fence recovery with one subject/packet and a receipt from the replacement fence. Real human decisions remain explicitly out of scope.

## Native request/packet proof

Root executed the isolated local proof in 8.3 seconds. The immutable receipt is `internal/verification-adjudication-worker-ad8630a5-5fce-4041-8218-42a581215198.json`, SHA-256 `ac0107dcb3226f2b3f603711c19e05651cfc4f4ef3495fbcd9644b176a1a4894`; its startup journal is `internal/verification-adjudication-worker-startup-ad8630a5-5fce-4041-8218-42a581215198.json`.

The proof created eight successful native pending subjects and packet artifacts: claims and report requests through HTTP, typed client, CLI, and MCP. Each request used the retained signed source manifest, canonical server-owned inspection, exact pre-enqueue grant, native operation/step lease, packet registration, subject row, receipt, and terminal event. All results kept `humanDecisionRecorded:false` and `admissionChanged:false`; claims retained original outcome `review`, reports retained original outcome `fail`. Parser and provider dispatch counters were both zero.

Negative and recovery controls passed: a wrong manifest digest and an authority-injected request were denied; a cancelled operation produced no receipt; and an injected `completeStep` interruption after packet/subject commit was reclaimed with a higher fence, yielding one immutable subject and packet plus a receipt from the replacement fence. This is an injected post-commit interruption, not an operating-system process-kill proof. The proof used local development PostgreSQL and Storage only. Public terminal reads, actual human authorization/decisions, adjudicator grants/revocations, overrides, and remote deployment remain outside this slice.

Root then began canonical generator and full workspace verification. Product source is frozen pending those results and the independent SQL/Storage row audit.


EV-117 accepts eight native local adjudication request operations across claims/report run targets and HTTP/client/CLI/MCP. Immutable pending packets and subjects bind signed source artifacts, exact request/context/ownership and receipts. Root independent read-only r3 audit verifies complete handles, parent Storage digests, signed references, packet lineage and subject mappings; r1/r2 overclaims are superseded. One injected post-commit interruption recovers the original subject with a higher receipt fence; cancelled operation has no subject/packet/receipt, denied digest has no operation. Full KS typecheck/test/build passes72 tasks66cached after correcting the MCP catalog test. Eleven execution sources frozen. Aggregate internal/verification-native-adjudication-EV117-20260907.json SHA256 7a2bcd498ca8bac14f4d1f23e23d08d3ad2c7b8836fe6ce15e0c6a99d09015b6. No human decision, override, admission change, remote mutation or whole acceptance-row promotion. Terminal readers and Mission Control adjudication remain in progress.

2026-09-07 root adjudication terminal-read progress: actual retained native8-subject service/repository proof passed, with6 hostile controls (future subject fence, reason drift, ownership drift, metadata drift, event fence drift, noncooperative replay deadline). PostgreSQL default_transaction_read_only=on is verified each count snapshot; operation/artifact/subject counts unchanged. Receipt internal/verification-adjudication-native-reads-372a7139-b497-4d19-b0e5-48ef304686d8.json SHA256 89190cca84e74676886a66f849e92b0a6f4035bff33a3d6ce0a78fe164233fd3. Proof tsc passed. Root MCP read tool added with exact tenant/authority rejection test1passed and MCP typecheck passed after fresh client build. This is not yet a public transport or full-workspace checkpoint; API composition shared-factory refactor is active with custody agent.

2026-09-07 root MC adjudication integration: installed immutable knowledge contracts/client verification-adjudication-20260907 snapshots; independent pack parity173 contracts+8client files (internal/verification-mission-adjudication-sdk-parity-20260907.json SHA b1d6e6b9ef35c300ecf771038c18e13e05b28ed8ab5a04714ab2fa87de138008). MC dispatch now validates pending adjudication receipt against authenticated typed read including tenant, operation, request, subject, packet, source manifest, target/reason and fence.5 hostile typed-read variants plus human-decision tamper are rejected; focused35tests pass. Root fullMC typecheck/test/build passes33tasks15cached in1m21.222s; worker52tests. Log internal/verification-adjudication-full-mission-20260907.log. Dashboard run-target request template and shape tests3pass; browser/nativeTemporal adjudication still unproved. Updated adjudicate-verification skill to actual request/get commands, keeping pending status separate from human decision. No whole acceptance-row promotion. KS reader checkpoint EV118 recorded separately.
