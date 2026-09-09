# SW-06 Mission Control audit inspection dispatch progress

Started 2026-09-07. Scope: Mission Control source-only audit inspection dispatch, configured grant vocabulary, strict dashboard launch shape/selector, and focused unit coverage. The coordinator owns immutable KS SDK packing, MC package references, lockfile, and installation.

## Intended boundary

- Accept only strict `InspectAuditBundleRequest` references: tenant-scoped audit artifact ID and SHA-256 digest. Only claims/report manifest families are supported.
- Dispatch through the typed `inspectAuditBundle` client method as `verification_audit_bundle`, expect `inspect_audit_bundle_and_register.succeeded`, and validate the exact terminal request digest, operation ID, tenant, submitted audit reference, and result reference.
- A verified terminal maps to `completed_without_admission`, irrespective of preserved claims/report policy outcome. No raw Storage coordinate, full internal manifest, or policy-admission claim enters dashboard/browser output.
- Dashboard/API principal operation lists require an explicit audit launch grant. Unsupported API/SDK gaps are shown rather than emulated.

## Current dependency gate

The currently installed MC vendored SDK predates audit inspection types and `KnowledgeClient.inspectAuditBundle`/`getAuditInspection`. Source edits that import those types are held until the coordinator releases a new immutable SDK tarball. No package, vendor, lockfile, DB, provider, parser, or infrastructure action has been taken by this owner.

## Implementation and focused worker validation — 2026-09-07

The coordinator released immutable audit SDK tarballs and completed the package pin/install. This owner implemented the typed audit dispatch/reconciliation path in `ai-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts`, the strict API/dashboard launch vocabulary and selector under the Mission Control application, and worker adversarial receipt coverage in `ai-engineer-mission-control/apps/worker/src/verification-dispatch.test.ts`.

Worker audit reconciliation now uses the public sanitized `getAuditInspection` read after a terminal receipt is structurally accepted. It requires the exact operation ID, tenant, request digest, submitted audit artifact ID/digest, a single submitted audit parent, and matching result reference/output. A valid preserved `review`, `fail`, or `pass` policy outcome remains `completed_without_admission`; terminal or typed-read custody mismatch is `reconciliation_unresolved` and never resubmits.

Validation completed by this owner:

- `corepack pnpm --filter @aiengineer/mission-kernel build` — exit 0.
- `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` — exit 0; 1 file, 33 tests passed. The added cases cover review/fail/pass plus wrong tenant, request digest, audit digest, result reference, and typed output.
- `corepack pnpm --filter @aiengineer/mission-worker test` — exit 0; 5 files, 45 tests passed.

Limits: these are isolated unit tests only; no provider, parser, database, Storage, or native KS operation was called. Coordinator owns the ensuing full Mission Control verification and browser/API execution.

## Final independent review — 2026-09-07

Read-only review completed after the coordinator froze Mission Control source. No actionable finding was identified.

### Reviewed bindings

- `verification-dispatch.ts` uses `InspectAuditBundleRequestSchema`, submits only through `inspectAuditBundle`, requires `verification_audit_bundle` and `inspect_audit_bundle_and_register.succeeded`, then parses the strict terminal result. It binds terminal operation ID and request digest, result-handle tenant, submitted audit artifact ID/digest, exactly one submitted audit parent, and rejects result/self identity collision.
- It obtains the separate authenticated, schema-validated `getAuditInspection` resource and requires operation ID, tenant, request digest, result artifact ID/digest, and canonical output equality with the receipt before returning `completed_without_admission`. The preserved claims/report policy outcome (`pass`, `review`, or `fail`) does not imply admission.
- The compact `output.auditArtifact` is correctly treated as the public `VerificationArtifactReference` (no tenant field). Tenant custody is instead bound by the terminal result handle and typed read resource; no nonexistent audit-artifact tenant check was assumed.
- API configuration permits all eleven explicit operations, rejects duplicate operation grants, and authorization still checks tenant, mission, action, and requested operation before Temporal launch.
- Dashboard adds audit selection with an exact handle-only request template. Its server-side shape gate rejects unknown fields and scope drift; the worker remains the authoritative typed dispatch boundary.

### Source SHA-256

- `ai-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts` — `59c45b4d5f0d142576d86c3bf3363b53a93bb178b94519a80aa619927e393388`
- `ai-engineer-mission-control/apps/worker/src/verification-dispatch.test.ts` — `7575a583c74e9ff2b42ae4dfe125da06d4d00692fc3f9f52c6c2a95c785eba76`
- `ai-engineer-mission-control/apps/api/src/runtime.ts` — `08c61e7aaaf09d38e00f4ab30891ce296df81a690269dfeb9da9ad883d12a32e`
- `ai-engineer-mission-control/apps/api/src/runtime.test.ts` — `7143d72d63b5bff9a921a3912ac90cdc0b45ecee72e7e0dbbbbd974466d2de3d`
- `ai-engineer-mission-control/apps/dashboard/src/server/launch-shape.ts` — `98444348087aded1ea68873f9ed19c7c7dffed529325ea4ac6a3e3e2d69c1913`
- `ai-engineer-mission-control/apps/dashboard/src/server/launch-shape.test.ts` — `d06585a55dec07c5e8423b44d9ae769cff25adc1b83ecc0d80093d5c848d25cc`
- `ai-engineer-mission-control/apps/dashboard/src/features/executions/execution-launcher.tsx` — `3fdeb96cc9a5e635ad21188dc9368038de50e1474c35ffd4e30d69c5eb58b324`

### Reviewed evidence

- `internal/verification-mission-audit-full-20260907.log` SHA-256 `a018c7330855460b3db43766a47b80c93fc1d7fc2dceb99009a2f12efbda9356`: 33/33 Turbo tasks passed, including dashboard build/typecheck/tests, worker 45 tests, and kernel build/typecheck.
- `internal/verification-mission-audit-lint-20260907.log` SHA-256 `0c7136f5ad5bac7020c1427488a061c28662272d008a46a6efe243c09af38021`: 4/4 lint tasks passed; dashboard import-boundary check passed.
- `internal/verification-mission-audit-browser-20260907.log` SHA-256 `36f58cddb09f3b3697b56504ef302da80ec87e7e33a78364176299ac9c6d0a28`: 4/4 Playwright tests passed, including audit operation selection and exact audit request envelope.
- `internal/verification-mission-audit-api-focused-20260907.log` SHA-256 `c685c6674b93c080d36c4bd1ae1d72a54fd20df0544a286625aa209481329e34`: 6/6 focused API tests passed.
- `internal/verification-mission-audit-sdk-parity-20260907.json` SHA-256 `c3389494ed5ffa57fd125cb51b8a48cfcde18aa3bf95a69c7f57c36f78a6ad5a`: immutable audit contracts/client archives and exact exported-file parity recorded.

### Limitations

This review is source and recorded-check evidence only. It does not claim a live KS/native audit invocation, new admission behavior, or browser authorization with a real configured production grant. The integration truthfully reports `completed_without_admission` for validated audit inspection results.



## Native Temporal audit proof helper prepared — 2026-09-07

Added source-only i-engineer-mission-control/scripts/prove-verification-audit-temporal.ts (SHA-256 $helperHash) for a later authorized retained-fixture proof. It accepts InspectAuditBundleRequest and an exact OperationContext, requires tenant/mission/work-item routing, starts only the real erificationWorkflow/activity with typed installed KS SDK configuration, and requires completed_without_admission plus execution state succeeded.

The helper accepts only loopback KS URLs and loopback Temporal addresses (127.0.0.1/localhost, default 127.0.0.1:7233), hard-codes namespace erification-local, and bounds workflow result waiting and Temporal execution at two minutes. It writes immutable startup, failure, history, and success receipts; failure records have only identifiers/digests/error class. It rejects credential and raw-receipt markers from exported workflow history, replays the exact history through the worker, and closes worker/native/client connections in inally paths.

It was not executed: no Temporal server, KS server, database, Storage, provider, fixture, credentials, or network call was started or used. No package/source build was run. Root review is required before a later native proof.

## Helper remediation and focused validation — 2026-09-07

The initial helper remains unaccepted until this remediation review. Corrected source: i-engineer-mission-control/scripts/prove-verification-audit-temporal.ts SHA-256 $helper; focused test: i-engineer-mission-control/apps/worker/src/prove-verification-audit-temporal.test.ts SHA-256 $test.

Corrections: default 127.0.0.1:7233 now accepts Node URL's empty temporal pathname; client connections use the SDK connectTimeout and abort-scoped RPC calls; a native connect timeout closes late connections; workflow start/result/history fetch, replay, cancel, and connection cleanup are bounded. If a started workflow fails/times out, the helper attempts bounded cancellation before writing its immutable failure journal. Worker shutdown is synchronous per installed SDK types and is guarded without .catch.

History validation now scans the original serialization and every decodable Temporal payload data representation (base64 string, Uint8Array, Buffer JSON, or numeric-byte object). JSON syntax errors alone are treated as non-JSON payloads; nested custody assertion failures propagate. It requires at least one exact allowlisted compact completed_without_admission outcome containing only disposition/state/operationId/receiptId/idempotencyKey and rejects secrets or raw-receipt markers in decoded content.

Validation without a Temporal/KS server:

- corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/prove-verification-audit-temporal.test.ts — exit 0; 3/3 tests. Covers default loopback address, strict outcome extra-field rejection, and nested base64 credential rejection.
- Temporary no-runtime compiler configuration targeting only the helper with the worker's installed contracts declaration — corepack pnpm exec tsc -p tsconfig.audit-temporal-static.json — exit 0; temporary config removed immediately after the check.

No native proof, server, fixture, database, Storage, provider, or credentialed endpoint was started or called.

## Completion-claim hardening — 2026-09-07

Final focused correction: every decoded object that claims disposition: "completed_without_admission" must satisfy the exact compact outcome allowlist. A valid compact result can no longer mask a second expanded/forged completion payload. Current helper SHA-256 $helper; test SHA-256 $test.

corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/prove-verification-audit-temporal.test.ts exited 0 (3/3). Coverage includes a mixed valid-plus-expanded completion history, which is rejected as COMPACT_AUDIT_OUTCOME_INVALID; no native proof was run.

## Read-only installed SDK lifecycle review — 2026-09-07

Reviewed the frozen helper against installed `@temporalio/client` and `@temporalio/worker` declarations plus the actual `verificationWorkflow` and activity wrapper. No new concrete helper/runtime blocker was found.

- `Connection.connect` supports `connectTimeout`; the helper uses it. Client `withAbortSignal` wraps workflow start, result, history fetch, and cancellation. Native connection has no documented connect-timeout option, so the helper’s late-close guard remains necessary.
- `Worker.runUntil` stops the worker around the bounded inner proof promise and has an SDK failure-completion policy; the helper also bounds all workflow-facing operations. Installed `Worker.shutdown()` returns `void`, matching the guarded synchronous cleanup.
- The actual activity returns the compact `VerificationDispatchResult`; for an audit success it carries `completed_without_admission`, `succeeded`, operation ID, receipt ID, and idempotency key. The helper’s decoded-history allowlist matches that compact receipt-bearing branch and excludes full receipts.
- The workflow contains no additional verification logic: it proxies the activity with wait-for-cancellation semantics. The helper cancellation path therefore remains the right fail-safe when a started workflow times out or fails.

This review made no source edits and ran no native proof. It does not replace the pending authorized KS retained-fixture execution by Sol/root.

## Native strict terminal-envelope repair — 2026-09-07

A real MC→KS audit workflow returned econciliation_unresolved despite KS operation 98d9d63a-7dca-509a-a5ca-5693b9360312 succeeding with inspect_audit_bundle_and_register.succeeded. The retained native receipt adds ventId and encingToken around the strict operation result. Mission Control had passed the whole body to strict public schemas.

Repaired i-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts SHA-256 $kernel with one shared native terminal unwrap. It requires a record, UUID ventId, and positive safe-integer encingToken, strips exactly those two fields, and then passes the remainder to unchanged strict result schemas. Claims, report, structured extraction, parseArtifact, and audit inspection strict terminal branches use it. Benchmark and generic metric handling remain unchanged.

Updated native-envelope fixtures in pps/worker/src/verification-dispatch.test.ts SHA-256 $worker and pps/worker/src/verification-claims-dispatch.test.ts SHA-256 $claims. Valid audit/parse/extraction/claims/report terminal fixtures carry the native envelope. Focused controls reject missing event/fence, malformed UUID, nonpositive fence, and arbitrary extra envelope/domain field as econciliation_unresolved with one submission.

Validation:

- corepack pnpm --filter @aiengineer/mission-kernel build — exit 0.
- corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts src/verification-claims-dispatch.test.ts — exit 0; 2 files, 41 tests passed.

No KS source, provider, database, or second native proof was touched. Sol/root review is required before a retry.

### Cross-operation envelope controls added

Expanded focused controls across every strict terminal parser: valid audit, parseArtifact, structured-extraction, claims, and report fixtures now include the native envelope; parse/extraction explicitly reject a missing envelope; audit and claims/report reject missing, malformed UUID, nonpositive fence, and extra fields. Rebuilt kernel exit 0 and reran focused worker suites exit 0: 2 files, 43 tests passed. Current hashes: kernel $kernel; dispatch test $worker; claims/report test $claims.

## Worker type-resolution remediation — 2026-09-07

Preserved the accepted pre-fix helper bytes at internal/verification-MC-audit-native-source-before-type-fix.ts, SHA-256 $archive (the prior accepted helper hash). The only helper source change is a type-only import from the worker-declared installed contracts entrypoint: ../apps/worker/node_modules/@aiengineer/knowledge-contracts/dist/index.js. Runtime imports, dispatch behavior, fixtures, and native-proof logic are unchanged. Current helper SHA-256 $current.

Validation after the type-only correction:

- corepack pnpm --filter @aiengineer/mission-worker typecheck — exit 0.
- corepack pnpm --filter @aiengineer/mission-worker test — exit 0; 6 files, 51 tests passed.

No native provider/fixture/Temporal/KS rerun occurred; this correction addresses only worker compilation resolution.

## Dashboard adjudication browser mock coverage — 2026-09-07

Updated `ai-engineer-mission-control/apps/dashboard/e2e/landing.spec.ts` while Mission Control product source remained frozen during Root's full 33-task check. The selector test now asserts the exact `requestAdjudication` template: verification contract version, run target placeholder, policy-review reason, and compact evidence-packet handle.

A separate browser test installs only existing-style mocked dashboard CSRF and launch endpoints, posts two malformed adjudication requests (invalid evidence digest and invalid run-target UUID), and asserts the UI sends each body and presents `DASHBOARD_LAUNCH_SHAPE_INVALID`. This is explicitly browser/mock boundary evidence only; it is not a native launch, Temporal, KS, admission, or human-decision proof.

Pending command at this entry: the Root full Mission Control check was running; Playwright execution is intentionally serialized after its release.

Validation after Root released the full-check gate:

- `corepack pnpm --filter @aiengineer/mission-dashboard exec playwright test e2e/landing.spec.ts` — exit 0; 3/3 passed in 5.7 s. The test runs a local dashboard browser server and mocked dashboard launch/CSRF endpoints only.
- Final e2e source SHA-256: `eaa16c1f63bb892c5c9e813c27a20aab0ea92070adee6d955f515b8093c91831`.


EV-119 accepts two native local Mission Control adjudication workflows through actual Temporal activities, KS HTTP and native worker. Independent read-only SQL/Storage audit verifies packet/subject/request/fence/actor and external execution custody; fresh CLI histories bind exact inputs/results and independently replay2/2. Both outcomes remain completed_without_admission, preserving claims review/report fail. MC SDK package parity173contract+8client files; full MC checks33tasks15cached, worker52tests. Dashboard source/templates and mocked browser3/3 accepted only as UI evidence; actual dashboard launch remains unproved. Root-owned Temporal PID44960 stopped with SQLite/logs retained. 23 source files frozen. Aggregate internal/verification-native-mission-adjudication-EV119-20260907.json SHA256 fb973b303559271e5ec131ec032db537a951f18aa037d73a41638bb468c573db. Human decision authority and wider module requirements remain active; no whole matrix row promoted.

## Pending adjudication dashboard detail — 2026-09-07

Added a read-only dashboard detail route at /verification/adjudications?operationId=<UUID>. It uses the trusted Knowledge Services dashboard proxy GET /v1/verification/adjudications/:operationId, validates the browser query as a UUID before requesting, and renders the strictly projected pending status, original policy outcome, target/reason, reviewer requirements, source manifest/bundle/result/policy references, and unchanged admission. It includes no human-decision control.

The knowledge allowlist now accepts only the exact UUID detail path. Its source-specific DTO retains compact artifact references and typed terminal fields while dropping packet bytes, requester notes, raw receipts, Storage coordinates, tenant-scoped handles, and unknown upstream values. Operation inspection links erification_adjudication entries to the detail route.

Focused validation:

- corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/dto.test.ts — exit 0; 4/4 passed.
- corepack pnpm --filter @aiengineer/mission-dashboard typecheck — exit 0.

No full build, native request/read, provider, database, or human-decision workflow was run.

### Source SHA-256
- `ai-engineer-mission-control\apps\dashboard\src\server\allowed-paths.ts` — `79b0ee85771c1fb881cad243381910a7fe10d07a32705ea706d92f2a05899d67`
- `ai-engineer-mission-control\apps\dashboard\src\server\dto.ts` — `3354ea325987a4f8f6c5115aad0f7da0bb50741ae52908a5325812b0f31957a1`
- `ai-engineer-mission-control\apps\dashboard\src\features\adjudications\adjudication-detail.tsx` — `19f6d0c896a2524994adb3d36edd657d1e700a9b76e5b33da17953cdf9473010`
- `ai-engineer-mission-control\apps\dashboard\src\features\runs\resource-inspector.tsx` — `398282afb3855509013c98e243b28eccd51ec4faf3d9cb94a5833ff6f3e37253`
- `ai-engineer-mission-control\apps\dashboard\app\(control-plane)\verification\adjudications\page.tsx` — `dd65c96b1f2e0d6ba64d8eb739adc2a59a266a73e53049c2821f14ab9848396c`
- `ai-engineer-mission-control\apps\dashboard\src\server\dto.test.ts` — `954d74c2de285aeeea578010b52cbba6ac216ec4ce3a7119242ada881f20957e`

### Detail hardening correction

The projector now preserves contract-valid `VerificationId` assertion/evidence target IDs with the bounded `id()` projection rather than incorrectly requiring UUIDs. It exposes optional reviewer-requirement `expiresAt`, and both server DTO and browser query validation accept UUID versions 1 through 8, including UUIDv7.

A terminal response that says anything other than `pending_human_adjudication`, or reports `humanDecisionRecorded` or `admissionChanged` as true, is rejected by the adjudication DTO as `ADJUDICATION_INTEGRITY_INVALID`. The UI consumes an unknown response type and renders that integrity error instead of rendering a hard-coded pending/unchanged state.

- `corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/dto.test.ts` — exit 0; 5/5 passed. Includes assertion `claim-1`, evidence `evidence-1`, expiry, UUIDv7, and terminal-state mutation controls.
- `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` — exit 0.

No broad build or native service call was run.

### Renderer shape guard

Extracted `adjudication-detail-guard.ts` so the browser validates every compact terminal field it dereferences: operation/subject UUIDs, SHA-256 compact artifact references, one exact target variant and its identifier form, reason/outcome enums, bounded distinct reviewer roles/quorum/expiry, source run and all required references, optional report gate, and the false human-decision/admission flags. Partial, nested-missing, malformed reference, or invalid reviewer resources now produce `ADJUDICATION_INTEGRITY_INVALID` in the UI without rendering nested fields.

- `corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/features/adjudications/adjudication-detail-guard.test.ts src/server/dto.test.ts` — exit 0; 7/7 passed. Guard controls cover missing packet, missing nested target digest, missing nested manifest digest, and invalid review requirements.
- `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` — exit 0.

No broad build or native service call was run.

### Browser detail-route coverage

Added Playwright coverage for the adjudication detail route using browser-level mocked Knowledge dashboard API responses. A valid compact pending subject with non-UUID claim-1 assertion target and reviewer expiry renders the pending status, requirement, compact artifact reference, and unchanged admission. Missing nested source and humanDecisionRecorded: true responses render ADJUDICATION_INTEGRITY_INVALID and do not render the pending detail.

- corepack pnpm --filter @aiengineer/mission-dashboard build — exit 0; Next 16 production build passed.
- corepack pnpm --filter @aiengineer/mission-dashboard exec playwright test e2e/landing.spec.ts — exit 0; 5/5 passed in 7.0 s.
- pps/dashboard/e2e/landing.spec.ts SHA-256: $hash.

The browser uses mocked dashboard API routes. These tests do not claim a native KS read, adjudication launch, admission change, provider call, or human decision proof.
