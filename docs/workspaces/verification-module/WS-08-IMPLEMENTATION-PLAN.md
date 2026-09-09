# WS-08 durable service composition plan

**Owner:** verification-benchmarks-agent  
**State:** active — bounded vertical slice  
**Evidence reservation:** EV-038 (owner); EV-039 is reserved for coordinator review.

## First review boundary

The first review boundary implements three related operations end to end through the existing durable operation system:

1. Register an already-uploaded source capture from a tenant-owned immutable artifact and produce an admitted native projection plus its capture-specific transformation envelope.
2. Verify a registered extraction output by hydrating the registered capture, native projection and trusted transformation envelope through `VerificationAdmissionService.hydrateAdmittedProjection`, then running the existing deterministic extraction verifier.
3. Replay the recorded verification without network access by hydrating the same registered inputs and recomputing the result.

HTTP, TypeScript client, CLI, MCP and worker must call one application service. Public payloads use the accepted strict request contracts. Tenant, actor, capability, idempotency, trusted artifact access, transformation grants and runtime identity come from authenticated server-side composition and are never copied from caller input.

## Durable invariants

- Reuse the canonical operation, step, lease, receipt and event tables. Do not create a second job store.
- Bind idempotency to operation kind, strict request bytes, expected versions and authenticated context. A changed request under the same key fails as drift.
- Workers claim fenced steps and re-check cancellation before hydration, before deterministic work and before output registration.
- Register every immutable output and its provenance before the terminal success transition. A registration or receipt failure cannot yield success.
- Replay hydrates registered bytes and trusted lineage; it does not trust an operation summary or caller-supplied finding.
- Native projections remain parentless CAS objects. Their source lineage is satisfied only by the separately registered, capture-specific transformation envelope that admission validates. The historical direct-parent audit path remains unchanged.
- Unsupported capture modes, projection kinds and incomplete operations stay outside production-admitted route and worker maps.

## Review stages

1. **Application and persistence core:** strict dispatch, trusted server configuration, three executors, durable worker fencing/cancellation, artifact registration-before-success and offline replay.
2. **Cross-surface parity:** HTTP, client, CLI, MCP and worker exercise one real local Postgres/private Storage fixture and produce equivalent operation/result semantics.
3. **Remaining inventory:** add the other mutation and read routes only after each has a complete executor, capability admission and focused proof. Human adjudication/promotion remains unavailable until authenticated reviewer ingestion exists.

## Proof plan

Focused pure tests cover strict-request rejection, caller trust-field rejection, idempotent replay, request drift, stale lease fencing, cancellation at each boundary, native envelope lineage and no-network replay. The local proof uses the existing local database and private Storage incrementally, records unique receipts, preserves prior rows, and does not reset or contact remote services.


## Coordinator correction — durable ownership (2026-09-05)

Code review found that the canonical operation service omitted verification mission/work-item/attempt columns and did not include authenticated context in the request digest. Context existed only in step input. The coordinator corrected the verification operation path to persist those columns and seal authenticated context into the repository's existing idempotency digest. Existing non-verification request serialization is unchanged.

`operation-service.test.ts` now covers ownership propagation and changed actor/attempt/mission/capability digest binding (4 focused tests pass; persistence typecheck passes). The new `scripts/prove-verification-operation-ownership.ts`, invoked with `node internal/verification-run-local-proof.mjs operation-ownership` from the parent workspace, executes against guarded local Postgres using a fresh synthetic tenant. Its eight checks pass: ownership columns, sealed context, exact retry, four ownership drift rejections, and one surviving operation. Receipt: `internal/verification-operation-ownership-a9ad5487-afba-49c4-9e9d-b69bdae4a04b.json`. It performs no provider dispatch, worker execution or Storage access and does not claim those boundaries. Dynamic authenticated ownership resolution and full transport parity remain pending.

## Coordinator implementation — authenticated mission ownership (2026-09-05)

`apps/api/src/verification-ownership.ts` now parses bounded strict server-side mission grants from `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`. Each grant binds tenant, authenticated actor, mission, agent deployment and capability version, with optional exact external execution binding. The resolver requires attempt/work-item/mission routing IDs and joins all three tenant-qualified canonical records before creating operation context. Caller-provided deployment identity and grants are not accepted. Duplicate or extended grants fail configuration admission. Production refuses legacy single-attempt configuration without ownership grants; the former static path remains a local laboratory compatibility path only.

Six focused API ownership/route tests pass, API typecheck passes, and the persistence build passes. The extended real local Postgres proof includes authenticated Fastify HTTP admission: 202 queue, exact retry, 403 unowned attempt and 409 payload drift. Receipt `internal/verification-operation-ownership-bd3f3fac-aef7-4a6d-8296-1df6c4426977.json`, SHA-256 `eaf52ed5ddc6644de1e246d1a4fae48332e2b115d8bddc1febe2f44efac3e009`, has 20 passing checks. Earlier 8- and 16-check receipts are preserved. The proof deliberately leaves fresh synthetic operations queued and does not start a worker or call providers. Full artifact hydration/execution and service-client-CLI-MCP parity remain pending.

## Coordinator real worker proof — 2026-09-05

`node internal/verification-run-local-proof.mjs service-worker` now executes the three-operation application slice through the canonical activity registry and fenced durable worker, with real local Postgres, private Supabase Storage and pinned sandboxed parser image `sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37`. Capture registration succeeds with a parentless native projection and transformation envelope; deterministic field verification succeeds; the recorded replay succeeds and matches. The worker loads the persisted operation and claim, writes durable receipts and terminal states, and closes its database pool. No provider dispatch occurs.

Receipt `internal/verification-service-worker-da64bcfb-78d1-4424-8be5-4b2f73c13ee0.json`, SHA-256 `f45e275062d336b2b4566b7e2640d4343ad34506bf7e91bac3519cdcd75fee78`, identifies all three operation IDs. Earlier failed fixture runs are retained: full-handle catalog input was rejected by strict parsing; invented fixture artifact-type names were rejected by the canonical taxonomy; an incorrect DOM path yielded a persisted completed quality rejection. The final fixture uses canonical verification-bundle/evaluation-case-input types and the actual HTML DOM path `1/0`.

The worker's strict operation-request schema was extended to accept sealed authenticated context and require its digest to equal the step context for all three admitted verification kinds. Worker typecheck and 17 focused registry/handler tests pass. This is a synthetic application-to-worker integration proof, not yet API/client/CLI/MCP transport parity, frozen benchmark execution, cancellation/restart coverage or a no-network-enforced replay test. EV-039 remains pending those boundaries.

## Coordinator durable terminal-state extension — 2026-09-05

The real local worker proof now adds an explicitly mutated candidate, which completes execution with `valid:false`. A new database connection and worker instance cannot claim that completed operation, and its receipt count remains unchanged. A queued verification cancelled through the canonical operation service cannot be claimed and has no success receipt. These checks use persisted Postgres state, not the in-memory ledger. They do not simulate process death during an active lease and do not establish mid-parser or mid-Storage cancellation coverage.

All nine checks pass in receipt `internal/verification-service-worker-fc2a20c9-85b5-4039-b7e2-8622c89991da.json`, SHA-256 `5c7afc900056d6464d867fcd6ecab5ac81133d29a15cde7cfe52b56ef3e473d3`. The receipt now includes implementation/proof source hashes. All created records and earlier receipts are retained; no providers were called. An adversarial registry test independently validates the sealed-context check when both request and step have otherwise valid digests; all 16 registry tests pass.

## Coordinator public transport execution — 2026-09-05

The same registered extraction profile, candidate and capture now execute through the public TypeScript client over a loopback HTTP API, the CLI command dispatcher using that client, and an actual MCP JSON-RPC `tools/call` HTTP request. Each accepted operation runs through the canonical durable worker and its complete deterministic result equals the direct application result. Public client status reads `succeeded`; an exact CLI retry returns the same operation. API and MCP listeners are closed after the proof.

MCP previously accepted only tenant/correlation/idempotency context, so it could not reach database-backed mission ownership admission. Its strict context now includes the canonical routing-hint schema; these fields still pass through authenticated API ownership checks and do not grant authority. MCP typecheck and 13 tests pass (one existing skipped test).

Receipt `internal/verification-service-worker-e7916d59-d559-462e-8403-e9d02eed68c0.json`, SHA-256 `ba6a86ba6fcdb0b9f4dc19506c7ecc6a2c563e3d18c05c9f93ebb9b8cb0d8248`, contains 14 passing checks and source hashes. Earlier direct-worker and partial transport receipts remain preserved. This proves the synthetic extraction path's result parity, not the entire ten-mutation/six-read inventory. The CLI dispatcher is exercised in process; executable spawning, quality/infrastructure exit codes, actual process-loss recovery, frozen benchmark transport execution and service deployment remain pending.

## Coordinator CLI executable completion semantics — 2026-09-05

The CLI accepts `--wait` for verification mutations and `--timeout-ms` (100–300000, default 60000). Without `--wait`, it returns the queued receipt as before. Waiting reads the authorized operation and matching durable success receipt; it returns a compact summary and exit 0 for quality pass or exit 1 for completed quality rejection. Request, configuration, failed/cancelled operation, missing/invalid success receipt and timeout errors return exit 2. HTTP calls have an abort timeout. Waiting does not fabricate completion from a 202 receipt.

The actual built executable was spawned without a shell against the loopback API. It returned 0 for a completed valid result, 1 for the persisted mutated candidate, and 2 for invalid authentication. All 17 service proof checks pass in `internal/verification-service-worker-c5a62241-2107-406a-8df6-c94a55f85a6e.json`, SHA-256 `95eeff84a78b8cb35044474d92a30bc4a3973619b3cb253457906e76316b4276`. CLI build/typecheck and ten existing dispatcher tests pass. This executable proof uses previously completed operations; waiting while an operation transitions from queued/running and a real network infrastructure failure remain additional cases. Other mutation/read inventory, frozen benchmark execution, active process-loss recovery and deployment remain incomplete.

## Coordinator observed CLI wait and command deadline — 2026-09-05

The CLI now uses one abort signal/deadline for submission and all subsequent reads, rather than restarting the HTTP timeout per request. The real executable proof observes its HTTP GET returning `queued` before the worker is allowed to execute; the child subsequently exits 0 on durable success. A separate queued operation is deliberately left without a worker: the CLI exits 2 at timeout, the operation remains queued, and the proof then cancels it explicitly. Timeout does not imply cancellation or successful verification.

Final receipt `internal/verification-service-worker-35d0927c-06a6-4851-8071-53cacb4dae6a.json` contains 19 passing checks and expanded source hashes including CLI entrypoint/completion code. Its predecessor `2715ad1f-b1c7-4dac-b833-1c92f09b3b78` did not explicitly observe the child's queued GET and is weaker evidence for the transition; both are retained. Real active lease/process-loss recovery and remaining public operation inventory are still outstanding.

## Coordinator real process-loss recovery — 2026-09-05

The service proof spawns a separate Node process through `scripts/verification-abandoned-lease-fixture.ts`. It acquires a real one-second canonical lease and sends the claim via IPC. The coordinator proof verifies the operation is running, kills the process without graceful lease release, waits for the recorded lease expiry, and executes the registered verification handler through a replacement worker. The recovered operation completes its deterministic quality rejection; the dead process's lease fails heartbeat fencing; exactly one success receipt exists. No provider was dispatched.

All 23 checks pass in `internal/verification-service-worker-7a4a6a8e-0a66-4959-bcb9-f416c7f0afa5.json`. This is actual process death after leasing and before the verification handler starts. Death during artifact registration/provider response or cancellation during active Storage I/O is not proved by this test. The child exit was observed and both API/MCP listeners and database pools were closed. Full operation inventory and deployment remain pending.

## Coordinator workspace verification and metric assignment — 2026-09-05

The default `pnpm verify` run reached 42/43 test-graph tasks before the existing offline benchmark test exceeded its 15-second test timeout under concurrency. The retained log is `internal/verification-ws08-workspace-verify-e7110387-77db-4393-a0f2-1a63afd67ddf.log`; this run is a failure, not a pass. The benchmark's nine tests then passed in isolation, with the expensive replay completing in about eight seconds. Without changing assertions or timeout settings, `corepack pnpm exec turbo run typecheck test build --concurrency=2` passed all 72 tasks (66 cached), log `internal/verification-ws08-bounded-verify-d71b46ce-e7e3-4f58-9621-0021e416a381.log`.

`WS-08-SERVICE-RUNBOOK.md` and `.env.example` now document mission ownership grants, worker artifact catalogs, the admitted three-operation boundary, strict routing hints, CLI completion/timeout behavior and local proof commands. A bounded Terra agent is implementing only the new metric application module/tests and its handoff; the coordinator retains existing-file and surface integration ownership. Metrics are not production-admitted until that code is independently reviewed and proved.

## Coordinator result custody and metric engine bridge — 2026-09-05

Service result registration now includes the authenticated producer attempt and mission in canonical artifact ownership columns. The real worker/transport/recovery proof adds a direct Postgres ownership assertion and passes 24 checks: `internal/verification-service-worker-381c6959-ce1e-4c53-bcdd-19f98e4ba312.json`.

The deterministic engine now supports a trusted code-only `isProjectionLineageAdmitted` port for capture-specific native transformation-envelope admission, while retaining the historical direct-parent path and byte/digest/size checks. It cannot be supplied as serialized public request data. The metric application layer must construct its closure only from successful trusted admission receipts matching the complete capture/source/projection binding. Seventeen deterministic tests and typecheck pass; historical frozen prototype digest remains unchanged. Native handles retain empty parent arrays.

Metric code remains in review. Coordinator review identified the real registry's lack of a later canonical projection field and legitimate duplicate CAS artifacts across captures; the owner is correcting both without fabricating parent relationships or rewriting capture registration. An intermediate application declaration build failed on the owner's in-progress test imports/digest types; its successful JS emission allowed the separate custody proof, but the failed build is not claimed as passing. Final build and metric integration evidence remain required.

## Coordinator metric integration wiring — 2026-09-05

The reviewed metric component is exported. Contract vocabulary and durable step planning now include `verification_metric` / `verify_metric_and_register`; authenticated ownership digest binding and worker context validation include it. This does not add it to the default production-admitted worker set. `VerificationOperationApplicationService.submitVerifyMetricObservation` validates the strict request and submits through the existing operation port.

`verification-metric-activity.ts` invokes the trusted metric service, checks active operation state, registers a restricted deterministic result with producer/mission ownership and input lineage, then returns output for fenced completion. Mechanical status is translated to the CLI-compatible `result.valid`; `mechanical_only` remains explicit and is not policy promotion. `/v1/verification/metrics:verify`, the TypeScript client method and `knowledge verify metric` are wired; configured operation admission still controls availability. Contract/application/client/persistence builds and API/client/CLI/worker typechecks passed at their recorded boundaries.

The Terra owner is constructing a new real local Postgres/private Storage/native-parser metric proof. Its inspection exposed concurrent use of a single-ticket artifact resolver in the metric service. The coordinator required sequential service hydration, not a proof-only adapter, before accepting the result. Runtime principal composition, complete real proof, MCP wiring and production metric configuration remain pending.

## Metric real-storage proof and runtime review — 2026-09-05

The guarded metric proof passes nine checks against local Postgres, private Storage and the pinned native parser. Receipt `internal/verification-metric-service-a0180dc9-9809-44b2-955b-ae224b27f624.json`, SHA-256 `13af562c5b3e55abe861bb4a7723c8cdbecea6150d83e4f23bcbe0946503ca74`, records three durable completions, artifact ownership, native parentless projection lineage, changed-value and same-deployment quality rejection, and missing/wrong-envelope fail-closed behavior. Provider dispatches and remote writes are zero. Coordinator source review found the SQL principal port still bound fixture-selected attempts; this evidence is accepted only for that explicitly composed boundary. A production adapter deriving the producer from registered artifact ownership and the verifier from authenticated context is now assigned to the same Terra owner, with a new real proof required.

The coordinator wired `knowledge_verify_metric` through MCP's strict API client, added a no-synthesized-findings transport test, and classified malformed worker inputs as nonretryable. MCP tests pass 14 with one existing skip; metric worker tests pass two. API metric admission is opt-in and requires dynamic ownership grants; API bootstrap tests pass five. Worker metric startup configuration is being composed with immutable profile grants and the production principal adapter; its build and runtime proof are pending. Whole WS-08 acceptance remains withheld.

## Configured metric runtime accepted locally — 2026-09-05

The coordinator reviewed the new `PostgresVerificationMetricRuntimePrincipals` adapter: tenant-qualified joins derive the producer from the registered observations artifact and the verifier from authenticated context; available/admitted artifact identity, digest, mission and work-item ownership are checked. Eight focused tests pass. The revised proof uses this adapter and the actual API/worker startup factories. Receipt `internal/verification-metric-service-5859429d-8a2d-4cbd-bc29-a3cdb969b787.json` (SHA-256 `0242b74e2c86f2175ee8155110353bc135a19b6526a0d230eb02e75edc383790`) passes thirteen checks, including configured HTTP/worker completion, exact idempotent retry, CLI dispatcher completion and actual MCP HTTP completion. Coordinator independently matched all eleven recorded source hashes. The CLI check here is the dispatcher/completion helper, not a spawned metric CLI executable. No provider calls or remote writes occurred.

The first complete bounded-concurrency workspace check failed OpenAPI route parity because the new metric route was not yet generated into the public contract; retained failure log: `internal/verification-ws08-metric-verify-c9a9efc8-65ed-4f57-ac11-167bf606210e.log`. The coordinator added the strict request schema and metric endpoint to the contract generator and is rerunning the complete check. The local proof wrapper now anchors paths to its own location, correcting nested-directory invocation without changing database targets. No infrastructure reset was necessary.

After that correction, `corepack pnpm exec turbo run typecheck test build --concurrency=2` passed all 72 tasks with zero cached tasks. Successful log: `internal/verification-ws08-metric-verify-fb2ad1f5-a753-48e8-8f1e-a10c659a48b3.log`. The public client and contracts were then packed into Mission Control's vendor directory for cross-repository integration; no package was published. Whole WS-08 and overall module acceptance remain incomplete.
