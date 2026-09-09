# SW-02 Mission Control Temporal audit proof progress

## 2026-09-07 authorized native proof plan

This bounded proof will invoke the reviewed Mission Control `proveVerificationAuditTemporal` helper against a real loopback Knowledge Services HTTP server and the root-owned local Temporal server at `127.0.0.1:7233`, namespace `verification-local`. It will inspect both retained signed claims and report manifests from `verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`.

The Knowledge Services harness owns only proof infrastructure: isolated canonical missions, work items, and attempts; exact server ownership grants with `externalExecution.runtime = mission_control` and the exact Temporal workflow ID; an API that admits only the two retained tenant-bound signed manifests; and a native worker that calls `runOperationOnce` only for the two deterministically predicted isolated audit operation IDs. The worker reuses the canonical audit inspection handler, signed replay, registered projection hydration, fenced result registration, and authenticated terminal read. It does not implement an inspection or replay algorithm.

Before its first SQL mutation the harness will write an immutable startup journal containing the proof namespace, tenant, source manifest references, planned mission/work/attempt/workflow/operation IDs, and intended local mutation scope. A caught failure will write an immutable failure journal with phase, IDs, and a sanitized error class/code. Success will retain the Mission Control helper's real Temporal history and replay receipts plus a canonical Knowledge Services receipt. No token, Storage secret, raw bundle, full result body, or artifact object path belongs in any proof receipt.

The argv convention is source worker proof path, Temporal address, then a unique immutable output path. The proof creates new local PostgreSQL/Storage records for the two isolated audit operations only. It makes zero parser and provider calls. Cancellation, denial, OS-process crash, remote deployment, and provider/parser execution are outside this proof; cancellation/fencing and wrong-digest denial remain covered by the accepted EV111 native public audit proof.

No package build, native mutation, or Temporal workflow has been run at this checkpoint.

## First native attempt and discovered integration defect

`corepack pnpm exec tsc -p scripts/tsconfig.verification-audit-mission-control.json` exited `0`. The first native command then ran against `127.0.0.1:7233` and exited `1` after the real claims Temporal workflow returned `reconciliation_unresolved`.

Retained journals:

- startup `../internal/verification-audit-mission-control-startup-eee83d52-358e-4b80-86d7-4199a7f5510a.json`
- KS failure `../internal/verification-audit-mission-control-failure-eee83d52-358e-4b80-86d7-4199a7f5510a.json`
- MC helper startup/failure `../internal/verification-audit-temporal-a011a918-507d-45d9-8f97-112593f44608.{startup,failure}.json`

The attempt created the planned isolated claims audit operation `98d9d63a-7dca-509a-a5ca-5693b9360312`. Read-only diagnosis confirms it actually succeeded under `ownershipMode=mission_control`, retained exact external run `audit-claims-b0a5aab8-fcb3-4cfe-81b5-16ad8ccb7836`, and has one `inspect_audit_bundle_and_register.succeeded` receipt `c84c6da8-c91b-5990-ae0a-7207d0c29b7c`. The report operation was not submitted. The result preserved signed claims policy outcome `review`; no parser/provider was called.

The failure exposed a production integration mismatch rather than an audit failure. Canonical native receipt bodies add the exact terminal `eventId` and `fencingToken` used by persistence to authenticate the success event. Mission Control passed that complete body directly to the strict `VerificationAuditInspectionOperationResultSchema`, which intentionally rejects the two envelope fields, so a valid native terminal could only reconcile as unresolved. The requested fix is a shared strict Mission Control terminal-body unwrap: require an exact result plus UUID `eventId` and positive safe-integer `fencingToken`, strip only those two fields, then run the unchanged strict operation-result schema. Malformed, missing, or additional envelope fields must remain rejected. A second isolated native run is held until the Mission Control owner implements and validates that fix.

## Mission Control envelope repair and successful native run

The Mission Control owner implemented the shared strict native terminal-body unwrap in `packages/mission-kernel/src/verification-dispatch.ts`. It requires a UUID `eventId` and a positive safe-integer `fencingToken`, removes exactly those two custody fields, and passes every remaining field through the unchanged strict operation-result schemas. Missing, malformed, or additional envelope fields remain unresolved. The owner reported a successful mission-kernel build and 43/43 focused worker dispatch and claims tests. The source SHA-256 recorded by the native proof for the kernel repair is `e986ddf6a100c90e8c08924fed1c39b33ca49089d6c8585cc8eb5a603e5ce604`.

The proof-only Knowledge Services compilation was repeated after the repair:

`corepack pnpm exec tsc -p scripts/tsconfig.verification-audit-mission-control.json`

It exited `0` with no diagnostics.

The second native command used a new immutable output and fresh isolated fixtures:

`corepack pnpm exec tsx scripts/prove-verification-audit-mission-control.ts ..\internal\verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json 127.0.0.1:7233 ..\internal\verification-audit-mission-control-20260907-r2.json`

It exited `0`. The success receipt is `../internal/verification-audit-mission-control-20260907-r2.json`, SHA-256 `b385f085f4fa749f39dbb26aa296083042251c470d7c4fe3a3cf0f1f0e3df6e9`. Its immutable pre-mutation journal is `../internal/verification-audit-mission-control-startup-9a200fbd-3438-471b-8113-9370b1155d5a.json`.

The proof completed both real workflows against Temporal namespace `verification-local`:

- claims workflow `audit-claims-8775f563-4a47-4378-b5c3-d5a3bd82ed2a`, exact KS operation `9f97f4df-70f6-5c5c-af4a-cbae9733554c`, receipt `bb401e3f-c933-5348-acd8-e66a51d37d8f`, signed policy outcome `review`;
- report workflow `audit-report-55189053-4a46-49eb-b470-ced604221c4b`, exact KS operation `46ad9c7c-4655-574c-a9dc-10a77197d805`, receipt `8978cb8f-dc59-528f-aafe-f70127e185fe`, signed policy outcome `fail`.

Mission Control retained and replayed each actual 11-event history. The claims MC receipt is `../internal/verification-audit-temporal-43d933a9-4e42-4179-9865-c960c13b2e26.json`, SHA-256 `9fcf8501bf904ef504157b4daa614d38beb048c980932aca7441e04893d5cba6`; its history SHA-256 is `9ab27fca3b64adf67c2e8790628696ea1e8b07d30847d5f107d5dd0f418032f7`. The report MC receipt is `../internal/verification-audit-temporal-d1ea3d73-ffe2-40e1-ac11-64846d678bd8.json`, SHA-256 `ee996aea137ff4afc6cc9a393cd88039966edb2cade5e20519e517cb87fd8368`; its history SHA-256 is `7dd2856ae81963443bf34adfc4a5b560a2b4eded0f84841c9c718f9c62e1c16a`.

Post-run local verification confirmed all 11 source hashes recorded by the success receipt still match the source tree, both MC receipt hashes and both history hashes match, the success receipt contains none of `SECRET_KEY`, `serviceRoleKey`, bearer credentials, `objectKey`, raw bundle, private key, or proof token material, and both parser and provider dispatch counts are zero. The worker pump inspected only the two deterministically predicted operation IDs. An independent read-only SQL/Storage audit of this receipt has been requested and is pending.

The independent reviewer then executed, from the Knowledge Services workspace:

`node ../internal/verification-mission-audit-independent-audit.mjs ../internal/verification-audit-mission-control-20260907-r2.json ../internal/verification-mission-audit-independent-20260907-r4.json`

It exited `0`. The superseding independent receipt is `../internal/verification-mission-audit-independent-20260907-r4.json`, SHA-256 `ba4d5f20dc555830b1683b01772273d611a00bd339305455416fe8dd25720604`. The reviewer rejected its earlier incomplete r2 audit and used r4 to query and validate both operations' native kind/status, mission/work/attempt and actor identity, Mission Control ownership mode and exact external run, durable audit request and step hashes, receipt ID/input/output hashes, exact result parent and source audit digest, successful event transition and fence, result artifact bytes, and signed source manifest validity. It independently matched each MC receipt/history file hash and the replay-passed metadata. It found no blocker for this exact two-operation SQL/Storage custody scope.

The producer proof reports zero parser/provider dispatches, but the independent r4 auditor did not independently query a parser/provider dispatch log; its zero fields repeat the producer receipt. Therefore the zero-dispatch statement is producer-harness evidence, supported by the proof composition that supplies a parser which throws on invocation, rather than an independently queried native count. Likewise, r4 matches the retained MC receipt/history hashes and the MC receipt's `replayPassed` assertion; the actual Temporal history replay was performed by the Mission Control producer helper, not repeated by the SQL/Storage auditor.

This proof establishes the local Mission Control HTTP/Temporal/Knowledge Services custody path for the two retained signed run families. It does not establish remote deployment, provider or parser execution, cancellation, or an operating-system process crash. Those claims remain excluded; the prior accepted EV111 proof covers cancellation and fenced recovery at the Knowledge Services audit boundary.

Coordinator acceptance EV-114: root strengthened the SQL auditor with actual SHOW transaction_read_only and exact PostgresAuditInspectionReadRepository output matching, executed r5 successfully, and separately fetched both histories freshly through Temporal CLI and independently replayed both using Worker.runReplayHistory. See internal/verification-mission-audit-history-review-20260907.json and internal/verification-native-mission-audit-EV114-20260907.json. Full MC typecheck/test/build passes33 tasks27cached;51 worker tests. Eleven native execution sources frozen. Helper native-source hash retained separately from erased type-only import correction. Owned local Temporal PID44868 stopped after verification; listener closed, SQLite/logs retained. Native provider/parser count qualification above remains unchanged.
