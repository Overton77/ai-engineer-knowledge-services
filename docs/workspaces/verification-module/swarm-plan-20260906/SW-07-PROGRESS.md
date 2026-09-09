# SW-07 progress ledger

Owner: dashboard stream. Scope: `ai-engineer-mission-control/apps/dashboard/**`, plus the Mission Control package/workspace integration required for dashboard verification.

## API inventory and limitations

- 2026-09-06: MC currently has `GET /v1/verification/readiness`, `POST /v1/verification/executions`, `GET /v1/verification/executions/:workflowId`, and `POST /v1/verification/executions/:workflowId:cancel`. Dispatch support at inspection was capture, extraction verification, metric verification, and replay only. No MC execution-list, topology, or event read projection exists.
- KS reads available to the dashboard include verification operation/events, run/manifest/cases/case/evidence, extraction, and benchmark handle projections. `verifyReport`, adjudication, CPH receipt-list, and a dashboard-safe benchmark-list API were unavailable at inspection.
- The dashboard consequently renders a single, known durable execution as a topology adapter and tails its KS operation cursor. Unsupported pages name the missing API rather than simulating a result.

## Versions

- Next 16.3.4, React 19.2.8, TanStack Query 5.102.8, Tailwind CSS 4.3.3, Playwright 1.58.2, Zod 4.5.4.
- `@typescript-eslint` was not retained: its current release rejects this workspace's TypeScript 7.0.2. Import-boundary enforcement is the dashboard's Node lint script and ESLint retains a config for supported files.

## Commands and evidence

| Time | Command | Exit | Evidence / limitation |
| --- | --- | --- | --- |
| 2026-09-06 | `corepack pnpm install --lockfile-only` | 0 | Lockfile resolved dashboard dependencies. |
| 2026-09-06 | `corepack pnpm install` | 0 | Installed workspace dependencies. |
| 2026-09-06 | `pnpm --filter @aiengineer/mission-dashboard typecheck` | 0 | Dashboard TypeScript boundary and routes compile. |
| 2026-09-06 | `pnpm --filter @aiengineer/mission-dashboard test` | 0 | 3 focused tests passed: MC/KS route allowlist and event-family normalization. |
| 2026-09-06 | `pnpm --filter @aiengineer/mission-dashboard lint` | 0 | `check-import-boundaries.mjs` passed; no direct DB, Supabase, KS app/persistence, or `agents_dashboard` imports. |
| 2026-09-06 | `pnpm --filter @aiengineer/mission-dashboard build` | 1 | First build exposed a server-only proxy extension-resolution issue; fixed and rerun. |
| 2026-09-06 | `pnpm --filter @aiengineer/mission-dashboard build` | 0 | Next production build completed; all dashboard routes compiled. |
| 2026-09-06 | `pnpm --filter @aiengineer/mission-dashboard e2e` | 0 | Playwright drove installed Chrome through landing → Live view (1 passed). |
| 2026-09-06 | `rg 'KNOWLEDGE_API_TOKEN|MISSION_CONTROL_API_TOKEN|DASHBOARD_TENANT_ID' apps/dashboard/.next/static` | 0 | No server credential/config identifiers found in generated client bundle. |

## Owned files

- `ai-engineer-mission-control/apps/dashboard/**`
- `ai-engineer-mission-control/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`

No DB was accessed or mutated. No shared services were started. No acceptance row is claimed from this implementation slice.

## Independent-review remediation (2026-09-06)

- Replaced static environment-derived browser authority with an expiring, HMAC-SHA256 signed `mc_dashboard_session` cookie. Upstream service URLs/tokens remain server-only configuration. The issuer must set the cookie `Secure; HttpOnly; SameSite=Strict`; absence, invalid signature, expired session, and malformed claims fail closed with 401.
- Added exact Origin plus signed-session CSRF-token validation to every mutation. The browser obtains the CSRF token only after an authenticated same-origin `GET /api/dashboard/csrf` and sends it in `x-dashboard-csrf`.
- Added server-side compact DTO projection with an allowlist and recursive sensitive-field removal. Browser views no longer perform the security filtering.
- Added proxy auth regression coverage for uncredentialed/forged/cross-origin requests, operator mutation forwarding, tenant injection, and nested secret/manifest/object-key stripping. Added a Vitest config that excludes Playwright E2E specs.

Pending integration limitation: `server-only` was added to the dashboard manifest after the dashboard lockfile was settled. The coordinator is refreshing MC vendored dependencies/lock and must include that package before a clean install proof. Focused local `typecheck` and Vitest (6 tests) pass against the current workspace installation.

The coordinator refreshed the MC lock and installed `server-only` on 2026-09-06. Rechecks after that refresh: dashboard typecheck 0; import-boundary lint 0; Vitest 7/7; production Next build 0; and serial Playwright Chrome run 1/1. An attempted parallel build and E2E run raced over `.next` and made that E2E instance fail to start; the subsequent serial E2E run passed.

## MC dispatch expansion (2026-09-06)

- Extended the dashboard's pre-Temporal launch shape gate and operation selector to the MC-supported `runBenchmark`, `compareBenchmarkRuns`, and `extractStructuredData` operations. The browser supplies only frozen-handle request data; the dashboard validates the strict envelope shape, session tenant/mission binding, digest format, and history-safe values, while Mission Control remains the owner of per-operation request schemas.
- Added `completed_without_admission` to the compact execution disposition union so successful benchmark/extraction engineering work is not displayed as policy admission. `quality_rejected` remains distinct.
- Checks after expansion: dashboard typecheck 0, boundary lint 0, Vitest 11/11, Chrome Playwright 2/2. The additional browser test independently verifies generated SW-04 human-review v2 download behavior without importing or persisting a label.

## Authentication and bounded proxy remediation (2026-09-06)

- Implemented bounded operator login and logout. The server accepts only a high-entropy access token, hashes it, matches its configured SHA-256 digest, and derives fixed subject/tenant/mission/role from configuration. It issues an expiring signed HttpOnly Strict cookie and never accepts caller-selected role or scope. Environment examples contain only placeholders; the authentication runbook records digest-only provisioning.
- Added proxy request/response byte ceilings, a five-second upstream timeout, and `redirect: "error"`. DTO projection now has a strict key allowlist plus depth, array, and string bounds. It intentionally remains a compact common projection pending source-specific read DTOs for every KS result kind; unsupported or omitted fields are not presented as data.
- New negative coverage includes unknown token, foreign-origin login, caller-selected scope/role payload, cookie attributes, logout CSRF, forged session, unauthenticated mutation, cross-origin mutation, viewer denial, and session-A/context-B launch denial. Final serial validation after the scope assertion: typecheck 0, Vitest 13/13, lint 0, production Next build 0, and Chrome Playwright 2/2. The generated client bundle still contains no server credential/config identifiers.

## Source-specific read DTO and R3 remediation (2026-09-06)

- Replaced the generic recursive projection with route-specific compact DTO mappings for the currently allowlisted MC execution/readiness routes and KS operation, generic operation-event, run/run-manifest/run-cases, case, evidence, structured-extraction, benchmark/benchmark-manifest, benchmark-comparison, and provider-reconciliation reads. These mappings retain identifiers, registered artifact references (never locators), state/disposition, bounded cost/count/statistical fields, taxonomy codes, timestamps, and reproducibility metadata. They omit tenant/context/actor data, storage locators, raw manifests, request/provider bodies, configuration, free-text `reason`/`label`/error messages, and unknown fields.
- Corrected the Live-event request to the actual supported KS route, `GET /v1/operations/:id/events`; the previous dashboard-only `/v1/verification/operations/:id/events` path was not an upstream route. Added the real benchmark-comparison and extraction reconciliation reads to the closed allowlist, with DTO mappings.
- A signed cookie now carries a server-derived grant identifier. Every session read recomputes it from the current configured digest grant and requires the subject, tenant, mission, and role to match; removed or changed grants invalidate already-issued cookies. This bounds revocation latency to the next dashboard request rather than the one-hour cookie expiry.
- Added focused DTO shape/adversarial tests and grant-change regression coverage for both the proxy and logout route. Final commands for this slice: dashboard Vitest 19/19, typecheck 0, import-boundary lint 0, production Next build 0, Chrome Playwright 2/2.

Remaining scope: the upstream API still has no dashboard-safe execution/benchmark catalog, signed short-lived artifact-content access, complete result/findings projections, or human-review/adjudication queue. The dashboard therefore exposes known-handle metadata and does not claim the specification's complete evidence-chain or Dashboard v1 acceptance criteria.

## Independent security review R3 (2026-09-06)

- Review record: `SW-07-SECURITY-REVIEW-R3.md`. Focused dashboard Vitest passed 13/13; typecheck and lint passed.
- Confirmed the R2 issuer, scope binding, CSRF/logout, proxy timeout/redirect/size, and strict launch-gate remediations.
- Remaining review findings: existing signed sessions remain valid through their one-hour expiry after a configured grant is removed or role/scope changes; generic DTO projection still allows sensitive text under permitted scalar keys. No implementation change was made by this review.

## Semantic provider reconciliation native read (2026-09-07)

Added `PostgresSemanticProviderReconciliationReadRepository` in persistence with an exported `SemanticProviderReconciliationReadError`. It is a read-only claims/report counterpart to extraction reconciliation reads: validates UUID inputs, loads exactly one terminal native reconciliation row joined to its operation and provider attempt, requires the expected host operation kind and settled amount/timestamp, hydrates the registered artifact through the trusted resolver, and calls `SemanticProviderReconciliationAdmission.verifyEvidenceAt` using the durable `appliedAt`. It compares the verified receipt and a second native snapshot canonically to detect receipt or ledger drift. It returns only compact accounting/resource metadata and never obtains a mutation permit.

Focused validation:

- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-semantic-reconciliation-read.test.ts` — exit 0; 2/2 passed. Covers exact artifact + applied-time admission verification, repeated ledger snapshot, settled amount drift, and artifact identity drift before admission.
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck` — exit 0.

No database, provider, paid service, runtime, API, or migration action was invoked.

### Null-cost drift regression

The settled-ledger predicate explicitly rejects `actual_cost_micros` when it is `null` or `undefined` before numeric comparison, preventing JavaScript `Number(null) === 0` from accepting a missing native cost for a valid zero-cost receipt. Added the corresponding zero-cost/null-ledger focused regression.

- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-semantic-reconciliation-read.test.ts` — exit 0; 3/3 passed.
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck` — exit 0.

No database/native proof, provider, runtime, or API action was run.

## Semantic reconciliation API boundary tests (2026-09-07)

Added focused tests only for the claims/report semantic reconciliation runtime and API routes. Runtime coverage verifies that absent grants disable the capability, incomplete configured trust fails closed, and wrong actor, operation, or provider attempt are denied before any ownership-query/hydration path. A report-host request with a claims grant executes only the report operation-kind ownership query and is denied.

Route coverage verifies the claims and reports URL families pass their fixed host value and authenticated actor into the injected semantic service, the returned result is parsed as the strict compact reconciliation resource, a POST body with caller-supplied `context` is rejected before the service, and unavailable semantic configuration returns its capability error without changing the existing extraction reconciliation endpoint behavior.

- `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-semantic-reconciliation-runtime.test.ts src/verification-semantic-reconciliation-route.test.ts` — exit 0; 4/4 passed.
- `corepack pnpm --filter @aiengineer/knowledge-api typecheck` — exit 0.

No runtime/API production code, database, provider, native proof, or paid call was changed or invoked.

## Benchmark replay timeout diagnosis (2026-09-07)

Inspected `packages/application/src/verification-benchmark-response-replay.test.ts`: it performs three captured-response profile replays plus expected envelope/error controls and forbids global fetch. The requested `.turbo/turbo-test.log` was not present; no matching failure record was available under `.turbo` logs. The focused command completed successfully with the test body at 107 ms, far below Vitest's default 5 s timeout:

- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-benchmark-response-replay.test.ts` — exit 0; 1/1 passed; total 1.19 s, test 107 ms.

No timeout override was added. The evidence does not support treating the reported 5.177 s full-run event as legitimate replay workload; a test-local timeout increase would mask possible full-suite contention or another transient failure. No production or test source changed.

## Semantic mission fixture factory (2026-09-07)

Added standalone exported createVerificationSemanticMissionFixture in scripts/verification-semantic-mission-fixture.ts. The module has no top-level runtime. Its input takes caller-owned existing database/repository/admission, tenant/mission/attempt/deployment IDs, kind, policy version, and a supplied frozen gl-comparison capture/projection record. It verifies the registered capture and admitted projection against that frozen record, replays the exact retained selector/title, registers only claims/report fixture artifacts under the supplied existing producer attempt and mission, records the assertion, and returns the strict request, assertions artifact, and projection grant.

It deliberately does not create a mission, work item, attempt, operation, parser invocation, provider call, database connection, or storage client. For the report fixture, equiredQualifiers is [], unlike the old proof's intentional failure fixture, yielding mechanically eligible pass inputs.

- corepack pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target es2022 --skipLibCheck scripts/verification-semantic-mission-fixture.ts — exit 0.
- corepack pnpm exec tsx -e "import('./scripts/verification-semantic-mission-fixture.ts')..." — exit 0; verified exported factory with no top-level runtime.
- Source SHA-256: $hash.

No DB, Storage, provider, parser, paid service, or native operation was invoked.

## Semantic Mission Control isolated wrapper (2026-09-07)

Added internal/verification-semantic-mission-isolated.mjs in the root workspace. It is a preparation-and-run wrapper only; it has not been executed. At runtime it verifies the documented loopback source database, generates a cryptographically unique verification_semantic_mission_<uuid> database name, checks that the name is absent, and writes an ownership journal before creating that disposable database.

It restores a full schema-only dump (including local ACL statements) into a 	emplate0 database, then dumps/restores data only for the explicit application-schema allowlist: public, orchestration, knowledge_service, vidence, valuation, corpus, etrieval, observability, knowledge, staging, 	axonomy, anking, content, curriculum, esearch, provenance, and supabase_migrations. It does not dump data from auth, storage, vault, or any unlisted schema. The disposable restore runs in one psql session with SET LOCAL session_replication_role = replica and uses pg_dump --data-only --disable-triggers.

The wrapper starts the pending KS scripts/prove-verification-semantic-mission-control.ts through the KS-installed 	sx CLI only after the clone succeeds, passing the unique database solely as VERIFICATION_PROOF_DATABASE plus a target POSTGRES_URL. It does not load dotenv files. Its child environment is an explicit system-variable allowlist; AI_GATEWAY_API_KEY is passed through only if already supplied to the wrapper process, and is never read, emitted, or journaled. Cleanup is limited to the database recorded as created by this wrapper and its own unique dump directory; the journal and terminal receipt remain for review.

- 
ode --check internal/verification-semantic-mission-isolated.mjs — exit 0 (static syntax only).
- Source SHA-256: $hash.

No database, storage, provider, gateway, child proof, Docker, or package command was run. Runtime behavior remains unaccepted pending root inspection and an authorized isolated execution.

### Isolation wrapper review amendment

Root review required the same local Postgres compatibility filters already proven in verification-semantic-isolated-storage.mjs. The wrapper now removes only 	ransaction_timeout, log_min_messages, extension/catalog/vault object ACL statements, and default-privilege statements from both dumps before restore. This is the existing compatibility exception; ordinary application-schema ACL statements remain in the schema clone.

It now invokes pg tools with --dbname postgres and PGPASSWORD only in the process environment, never embeds source credentials in argv. The 	sx resolver is rooted at apps/worker/package.json. It records only a truncated sanitized PostgreSQL diagnostic and JSON child receipt paths, never raw child output. Cleanup is now guarded by an actual created-database flag and uses filesystem access after removal; it cannot remove a database or work directory unless this invocation created it. The work directory's real parent is verified as the root internal directory.

- 
ode --check internal/verification-semantic-mission-isolated.mjs — exit 0 (static syntax only).
- Revised source SHA-256: $hash.

No execution, database, Docker, child proof, provider, or package action was performed.

## Read-only semantic Mission Control proof review (2026-09-07)

Reviewed scripts/prove-verification-semantic-mission-control.ts without executing it. The script fail-closes unless VERIFICATION_PROOF_DATABASE has the expected unique disposable-database form and an inherited gateway key is present; it reconstructs the target from the verified loopback config, limits Temporal to loopback, binds the API server to loopback, creates exactly two plans (claims and report), and configures each semantic worker operation with a 60-second deadline and a 100,000-micro ceiling/reservation. Its parser dependency is a throwing stub, so parser execution fails the proof. The MC helper asserts a compact terminal result, bounded workflow, local Temporal history replay, and absence of its API token/raw receipt fields in history.

I deliberately did not duplicate corrections claims_report is making for projection catalog resolution, resource-reader wiring, pre-mutation startup journaling, and native accounting assertions.

**Remaining actionable limitation sent to root:** the proof is database-isolated, but not Storage-isolated. It uses the shared local Supabase API and ai-engineer-cloud-bucket for newly registered fixture, policy, profile, and Gateway/provider-evidence artifacts. The clone wrapper removes only its database and dump directory, leaving those new Storage objects. Before execution, the proof should either record and delete exactly its created object keys or describe the shared local Storage writes as retained evidence rather than claim complete isolation/cleanup.

- Reviewed source SHA-256: $proofHash.
- No DB, Storage, Temporal, provider, gateway, package, or runtime command was invoked.

## Independent first semantic Mission Control receipt audit (2026-09-07)

Read-only JSON/source audit of the immutable first successful run only:

- Mission receipt: internal/verification-semantic-mission-control-70ad50cd-24c5-416e-894b-6e319ae76326.json, SHA-256 3c09dcae84997cff09d940bbb372014031403500bdb735a612f64038a965cac1.
- Isolation receipt: internal/verification-semantic-mission-isolated-aa046fe2-51b1-48b5-a01d-763babe98b65.json, SHA-256 6a62a7a4a7faece5a30af1fee502fa4e72043e5b7398f0076859cf1956a5d513.
- Isolation journal: internal/verification-semantic-mission-isolated-aa046fe2-51b1-48b5-a01d-763babe98b65.jsonl, SHA-256 8fe1c9479846dedc4d9db2e2ee84a345fde69727dc88876c017de0e45b061893.

Both mission receipt operations cross-bind exactly to their respective MC helper receipts: operation ID, workflow ID, request digest, and receipt ID matched. Recomputed history SHA-256 matched both stored helper values; each has 11 events and records compact outcome, history-safety, and replay flags as true.

The retained native-accounting journal records exactly one provider attempt, one response capture, and one semantic observation per operation. Each capture/observation points to that operation and provider attempt; request/semantic-request digests, profile IDs, and dispatch fencing tokens match across all three rows. Claims settled at 314 micros and report settled at 312 micros. Each corresponding budget records a 100,000-micro ceiling, zero remaining reservation, and settled cost equal to its attempt.

The isolation journal confirms the owned disposable database was absent before creation, child exit code was zero, and the owned database and dump directory were absent after cleanup. No database/provider call was made during this audit.

Material limits: this first-run evidence did **not** save an independent artifact-by-artifact Storage/registered-metadata closure, so it does not independently prove every produced artifact byte/parent/type. It also predates the successor run's signed typed terminal HTTP reads; those reads were not assessed here. The successor mutable runner/source was intentionally not used as evidence.

## Successor semantic Mission Control Storage/signature audit (2026-09-07)

Built and executed a bounded read-only auditor: internal/audit-verification-semantic-mission-successor.mjs. It uses built KS runtime/verification distributions, the verified loopback Storage config, and only SupabaseArtifactStore.get; it does not connect to PostgreSQL, Temporal, a provider, or a Gateway.

The successor proof SHA-256 is 1a25dcf0425ec610ad5ab3d2633f21bbd5a99fe232ff32451fb92bbfd4748714. All 30 retained artifact/metadata rows had matching tenant and artifact IDs, 64-hex digest, canonical tenant/digest object path, available ledger Storage state, positive bounded byte size, and unique parent lists.

For both typed terminal resources, the audit checked operation/request/workflow/result bindings, Mission Control ownership and succeeded status, deterministic semantic eligibility, and the sealed run's review outcome. It hydrated the two registered verification_run_manifest objects directly from local Storage, checked byte length and SHA-256 against the retained rows, required canonical JSON bytes, then called inspectAuditBundle with createEd25519Verifier({ [bundle.seal.keyId]: proof.publicKeyPem }). Both signatures verified, run IDs and canonical manifest digests matched typed terminal resources, and all retained output-artifact references matched their saved row digests. The retained row parent/output counts are claims 18/3 (13 retained parents) and report 20/4 (15 retained parents); remaining parents are frozen source identities outside the run-local retained list.

Isolation cleanup records show the disposable database and dump directory absent after run. The immutable independent receipt is internal/verification-semantic-mission-successor-independent-audit-61df9226-c6a4-4dad-b16a-3474f82e90cc-r2.json, SHA-256 83031a3028751c0c0378d9a1c29bb7c34f28bf9d1b201a0c9c41fd994617220c.

Scope limitation: this audit hydrates only the two manifests; it does not hydrate every non-manifest referenced artifact byte. It treats the successor proof's saved direct/HTTP typed-terminal equality assertion as evidence, while independently checking each saved compact terminal against its signed manifest.

- 
ode --check internal/audit-verification-semantic-mission-successor.mjs — exit 0.
- 
ode internal/audit-verification-semantic-mission-successor.mjs — exit 0; 2 signed manifests and 30 retained rows passed.

## Mission Control dashboard native-lifecycle wiring map (2026-09-07)

Read-only mapping of current ai-engineer-mission-control dashboard/API wiring; no service, browser, Temporal, Knowledge Service, or provider was started.

### Browser and dashboard routes

1. POST /api/dashboard/session requires same-origin JSON { token }, where the raw token is at least 32 characters and hashes to an entry in DASHBOARD_OPERATOR_TOKEN_DIGESTS_JSON. The configured entry, not the browser, fixes subject, tenant UUID, mission UUID, and role. Success sets mc_dashboard_session (HttpOnly, Strict, one hour; Secure in production).
2. GET /api/dashboard/csrf returns the session-bound CSRF token. Every dashboard mutation uses this token and same Origin.
3. POST /api/mission-control/verification/executions is the launch proxy. It applies the dashboard shape/scope gate, then forwards only a server-side bearer token plus x-tenant-id and x-mission-id to MISSION_CONTROL_API_URL/v1/verification/executions.
4. GET /api/mission-control/verification/executions/{workflowId} and POST .../{workflowId}:cancel are the only execution read/cancel proxy routes. IDs must be verification- followed by 64 lowercase hex characters.
5. Live view polls the execution route every three seconds and, once it receives an operation ID, polls /api/knowledge/operations/{operationId}/events?after=0. Operation/evidence detail reads go through the separately allowlisted Knowledge proxy.

The native dashboard environment must provide DASHBOARD_SESSION_SECRET, DASHBOARD_OPERATOR_TOKEN_DIGESTS_JSON, KNOWLEDGE_API_URL, KNOWLEDGE_API_TOKEN, MISSION_CONTROL_API_URL, and MISSION_CONTROL_API_TOKEN. Browser-side code never receives those upstream tokens.

### Mission Control API and Temporal wiring

apps/api/src/runtime.ts activates the execution API only with MISSION_VERIFICATION_IDENTITIES_JSON, whose raw bearer token must equal the dashboard's server-side MISSION_CONTROL_API_TOKEN. Its grant must bind the same tenant/mission and include launch, ead, and/or cancel plus the selected operation. TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, and TEMPORAL_TASK_QUEUE must point to the same local MC worker. The MC worker requires KNOWLEDGE_API_URL, KNOWLEDGE_API_TOKEN, and VERIFICATION_DISPATCH_GRANTS_JSON that bind the same tenant/mission, server actor, and capability version. The Temporal port creates deterministic verification-<sha256> workflow IDs, stores tenant/mission/digest in workflow memo, and checks all three on reads/cancellation.

For EV120 claims/report native requests, the dashboard launcher can submit the exact retained context/request/requestDigest JSON manually. It cannot synthesize request digests or frozen-handle identities.

### Existing browser coverage and gaps

Current apps/dashboard/e2e/landing.spec.ts starts a built Next app and uses page.route mocks for CSRF, launch errors, and adjudication detail. It verifies UI envelope selection and mock error/detail rendering only. It does not establish a configured dashboard session, proxy to an MC API, launch a Temporal workflow, or poll a KS operation; it is not a native lifecycle harness.

**Functional product gap:** the dashboard offers equestAdjudication, and its prelaunch shape gate supports it, but apps/api/src/runtime.ts admits only 11 operations and omits equestAdjudication. Therefore MISSION_VERIFICATION_IDENTITIES_JSON cannot grant that action and an actual dashboard request-adjudication launch cannot be configured. This is distinct from the mocked browser coverage.

**Hardening/UI gap:** dashboard prelaunch applies strict request schemas for benchmark, comparison, extraction, parse, claims, report, audit, and adjudication. captureSource, verifyExtraction, verifyMetricObservation, and eplayVerificationRun remain selector options with only the generic forbidden-field/scope gate; MC still rejects malformed requests before Temporal. This does not block EV120 claims/report proof, but it is incomplete dashboard-side validation.

**Composer limitation:** only audit and adjudication have useful request templates. Other operations initially render {} and require an operator to paste the exact published frozen-handle request; that is workable for a harness but is not guided native-operation composition.

## Dashboard claims/report terminal reads (2026-09-07)

Added compact, host-specific claims/report terminal read support in Mission Control dashboard files only. The Knowledge proxy allowlist now admits read-only GET /api/knowledge/verification/claims/{operationId} and /reports/{operationId}. projectDashboardDto separately maps the public KS verifyClaims and verifyReport terminal resources, retaining only result/manifest artifact references, sealed-run policy outcome, deterministic counts/status/review codes, claims artifact, and report-only citation/coverage metrics. It drops tenant, raw request/provider payloads, Storage coordinates, and unknown values. A family mismatch returns TERMINAL_RESULT_INTEGRITY_INVALID rather than being projected.

/verification/results?operationId=<uuid>&family=claims|reports renders the compact terminal summary after a full selected-family guard. The generic operation inspector links verification_claims and verification_report to that page. The guard rejects partial resources, invalid handles/digests, nonterminal output, and report fields on a claims result; it does not use a permissive cross-host union.

- corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/dto.test.ts src/server/proxy.test.ts src/features/claims-report/terminal-guard.test.ts — exit 0; 10/10 passed.
- corepack pnpm --filter @aiengineer/mission-dashboard typecheck — exit 0.

Source hashes:
apps/dashboard/src/server/allowed-paths.ts 6abfa77b6bf2408ca597e5e2c3d6d61fd117da94aa7c0da9f7e51075cb45a673
apps/dashboard/src/server/dto.ts 9618f1a65cb081c1671a94fac87ab387e43dcc156b30a9fe4f72a06c8725d4f4
apps/dashboard/src/features/runs/resource-inspector.tsx 33335aec2095984ef1244a0a5c870a2169c75d832ca83ec1536ccdb385b5cd82
apps/dashboard/src/features/claims-report/terminal-guard.ts 4cbf477202c859804a2be10ad6ce336929cfbe63fe2a05d323784b37813a24fd
apps/dashboard/src/features/claims-report/terminal-detail.tsx 481536e7419f178a3f20682e46b85e00c4ed59a19603b04a7428007ba3081aac
apps/dashboard/app/(control-plane)/verification/results/page.tsx 882637b39abdcd3759975ab8fab7fa1664d92b11f490dc9d2a4e4fb197def30c

No browser/server, Temporal, Knowledge Service, database, Storage, provider, or native run was started. Existing landing Playwright coverage remains mock-only; a native browser lifecycle remains root-owned.

### EV120 terminal-detail fixture review

Validated the claims/report DTO mapping and selected-family UI guard against internal/verification-semantic-mission-control-61df9226-c6a4-4dad-b16a-3474f82e90cc.json directly. The fixture-derived test projects both typed resources, preserves their eview policy outcome, passed deterministic summary status, and semanticEligibility: true; the report projection retains its public citation summary including zero citation correctness. Tenant and private/Storage/provider fields remain absent.

The result page now calls this a **Deterministic summary** rather than describing the whole semantic run as deterministic-only. Policy outcome remains a separately visible result. The initial product copy was shortened to the operator-relevant result/policy/evidence purpose. The report guard now requires every public report-wide metric before rendering, preventing a partial resource from reaching nested UI reads.

- corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/dto.test.ts src/server/proxy.test.ts src/features/claims-report/terminal-guard.test.ts — exit 0; 11/11 passed.
- corepack pnpm --filter @aiengineer/mission-dashboard typecheck — exit 0.

Updated source hashes:
apps/dashboard/src/server/dto.ts 9618f1a65cb081c1671a94fac87ab387e43dcc156b30a9fe4f72a06c8725d4f4
apps/dashboard/src/server/dto.test.ts 28cd688d13285270bb298ecd48c072c26686a83cd7fa6f88ac0b6ff5e7ed2a6b
apps/dashboard/src/features/claims-report/terminal-guard.ts a6015ee21f2a5c5e4531471ccee371945f384715121af28e3aefa55c783043f7
apps/dashboard/src/features/claims-report/terminal-guard.test.ts 1b960b0ec960ff282ead268352f7e5fea176e49061f4930ebf704cfa1541ad1c
apps/dashboard/src/features/claims-report/terminal-detail.tsx 3fb273bdf43e9a62f18f9898a73fdba9c2234296628a498ebc268232a70ff59c

No browser/server, Temporal, Knowledge Service, database, Storage, provider, or native workflow was started.

### EV120 fixture portability repair

Moved the EV120-derived claims/report typed-terminal test input into the dashboard repository at apps/dashboard/src/server/fixtures/ev120-typed-terminals.ts. It contains only the two compact public terminal resources used by the test; tenant identity and non-public receipt data are removed. Its provenance comment records the immutable source receipt verification-semantic-mission-control-61df9226-c6a4-4dad-b16a-3474f82e90cc.json and source SHA-256 1a25dcf0425ec610ad5ab3d2633f21bbd5a99fe232ff32451fb92bbfd4748714.

dto.test.ts now imports the local fixture, so the dashboard test does not rely on a sibling workspace internal/ receipt. Product code was unchanged.

- corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/dto.test.ts — exit 0; 7/7 passed.
- corepack pnpm --filter @aiengineer/mission-dashboard typecheck — exit 0.

Source hashes:
apps/dashboard/src/server/fixtures/ev120-typed-terminals.ts d3d7918dc9d0182538307b47f969d5f08edb2bed8061316da20a0c249d92cac4
apps/dashboard/src/server/dto.test.ts c1cd5f6c6a73a2d9ed37375d11b8943756e4541644e1c23f5e4e733c3993501c

No browser/server, Temporal, Knowledge Service, database, Storage, provider, or native workflow was started.


### Native dashboard sign-in read-only diagnosis

Reviewed the dashboard session route, server configuration, operator-login component, and the root-owned native dashboard helper without starting a process or changing source. Static configuration is internally consistent: the helper generates a bounded token and matching SHA-256 grant, supplies matching tenant/mission/operator role, passes all required dashboard upstream settings, and deliberately uses development mode so the HttpOnly strict-SameSite loopback cookie is not marked Secure.

The earlier Session established timeout was an older runner receipt that captured only a Playwright locator timeout, not the session HTTP status/body. It is insufficient to diagnose a dashboard authentication failure. The current helper correctly waits for the POST response and asserts its status before continuing; final diagnosis depends on that in-flight response. If it is 403, compare the captured Origin and Next request origin; if 401, inspect only the supplied grant/digest configuration; if 500, inspect the route/server error. No concrete product defect was established by read-only review.

No source, runtime, browser, Temporal, Knowledge Service, database, Storage, or provider action was performed.

### Local dashboard sign-in smoke attempt

A standalone synthetic loopback smoke harness was started with fresh generated operator/session values and dummy loopback upstream URLs only. Its Next child served the dashboard root at HTTP 200 on its reserved 127.0.0.1 port. The harness never reached page instrumentation or POST /api/dashboard/session: it stalled in Playwright Chrome channel launch before a page, response, failed-request callback, or screenshot could exist. The local timeout wrapper could not interrupt that synchronous launch setup. The owned Node/Next/Chrome tree was explicitly terminated and the temporary harness removed. No workflow, provider, database, Storage, Temporal, or external request was made.

This establishes a local Chrome-launch/harness blockage only; it supplies no session HTTP status and does not establish a dashboard authentication defect. The current native helper must capture the session response after its browser is available to distinguish an Origin, grant, or route failure.

### Correction: local Chrome-launch inference

Root independently verified direct Playwright Chrome-channel launch, newPage/about:blank, and close using the dashboard package in 1.34 seconds with a 10-second launch timeout. The prior standalone harness did not preserve enough diagnostic state to attribute its stall to Chrome launch. Its proposed launch-obstruction inference is withdrawn. The retained ledger evidence supports only that the temporary harness failed to reach a captured session response before its owned tree was terminated; it does not establish a browser or dashboard product defect.

### Claims/report terminal run and manifest navigation

Terminal details now expose two links derived exclusively from sealedRun.runId: Inspect run targets /verification/runs?id={runId}, and Inspect manifest targets /verification/runs/manifest?id={runId}. Both routes are existing dashboard pages backed by allowed Knowledge Service reads GET /verification/runs/{runId} and GET /verification/runs/{runId}/manifest. The navigation helper accepts only the sealed-run object; it cannot accept an artifact field as a run ID.

No evidence-detail link was added. The claims/report terminal resource has artifact references but no evidence-resource ID, and GET /verification/evidence/{id} requires that distinct ID. The terminal view states this unavailable boundary rather than treating an artifact ID as evidence identity. These links aid inspection only; they do not claim semantic eligibility or policy outcome authority beyond the terminal resource.

- corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/features/claims-report/terminal-navigation.test.ts src/features/claims-report/terminal-guard.test.ts src/server/dto.test.ts — exit 0; 11/11 passed.
- corepack pnpm --filter @aiengineer/mission-dashboard typecheck — exit 0.

Source hashes:
apps/dashboard/src/features/claims-report/terminal-navigation.ts 788d896dc829576dc6abe4a5fbcba9ac09bd70201f00a388ff8bb9dd78adc9ae
apps/dashboard/src/features/claims-report/terminal-navigation.test.ts 988b353ff97800ab8d6120952ca9c1e3e6d81225f0b60658be15996a1913639e
apps/dashboard/src/features/claims-report/terminal-detail.tsx 9b354b3db829a32c4bd1348b8565356d42afbfa51fb6d5d2ec29a8f763e3360f

No runtime, browser, Temporal, Knowledge Service, database, Storage, provider, or native proof was started.

### Native dashboard terminal navigation preparation

Extended the root-owned dashboard native proof POM without executing it. After rendering the selected claims/report terminal, the POM waits for the actual compact terminal GET response, extracts sealedRun.runId from that typed resource, follows Inspect run, and verifies both the GET /api/knowledge/verification/runs/{runId} response and rendered compact resource retain that run ID. It returns to the terminal, follows Inspect manifest, and applies the same identity checks to GET /api/knowledge/verification/runs/{runId}/manifest. The receipt now records sealedRunReadRendered and sealedManifestReadRendered on a later authorized proof run.

The proof never derives an evidence route from an artifact ID. It depends on the native runner enabling existing generic verification reads; evidence detail remains unavailable from these terminal resources because no evidence-resource ID is public.

- corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/features/claims-report/terminal-navigation.test.ts src/features/claims-report/terminal-guard.test.ts — exit 0; 4/4 passed.
- corepack pnpm --filter @aiengineer/mission-dashboard typecheck — exit 0.
- corepack pnpm exec tsc --noEmit --module nodenext --moduleResolution nodenext --target es2024 --skipLibCheck scripts/prove-verification-dashboard-native.ts — exit 0.

Source hash:
scripts/prove-verification-dashboard-native.ts bfc46397c4658ad7b89ddf35f7834eb550ef79e8bc8212a9687e7098f7e46662

No browser, server, Temporal, Knowledge Service, database, Storage, provider, or native proof was started.

### Independent dashboard navigation proof audit

Read-only audit of semantic receipt 0e4bc319-4a1c-4e68-8a7c-1cbf1dd06b27, isolation receipt ef7176db-2102-4420-b418-de471529d59f, and both dashboard browser receipts completed PASS_WITH_STATED_LIMITATIONS. Each terminal identity (operation ID, request digest, family, sealed run), dashboard result/receipt identity, current helper source hash, and saved history hash matched. Both saved histories have 11 events, a workflow-completed event, and no workflow-failed event. Provider custody records exactly one attempt, observation, and response capture for each of two unique operations.

The audit verifies stored replay claims and completed histories but does not rerun replay after service shutdown. It cannot independently verify a per-call monetary cost because the evidence receipt carries counts only. CAS-byte and server-cleanup custody are outside this saved receipt/source-hash audit and remain root-owned.

Evidence report: internal/verification-dashboard-navigation-independent-audit-0e4bc319-4a1c-4e68-8a7c-1cbf1dd06b27.md
Audit receipt SHA-256: f7a172b64ff5fe85d359bb41aa6ffa8c450735ad4e1c4ddd1414a85d5cac9996
Auditor source SHA-256: 56d41dfd38e26aacec16a8ec9b7305258ad402054d9d68465ca6b8f1c674097d

No paid call, runtime restart, browser, Temporal, Knowledge Service, database, Storage, or provider action was performed.

### Independent dashboard navigation accounting audit r2

Read-only r2 audit parsed the retained-native-provider-accounting JSONL row and launch journal b920cda0-ac6f-4143-bd5f-224003a0b506. It verifies two unique settled operation attempts at 321 and 327 micros, totaling 648 micros. Both associated budgets have reserved cost zero; no unknown/unpriced reservation remains. Each operation has one attempt (ordinal zero), one matching settled budget, observation, and response capture.

The launch journal records 1,951 prior known micros, six prior calls, and zero prior unpriced reservation. The cumulative evidence is therefore 2,599 known micros across eight calls with zero unpriced reservation. The r2 receipt deliberately omits lease, fence, and holder-token fields.

Accounting receipt: internal/verification-dashboard-navigation-independent-audit-0e4bc319-4a1c-4e68-8a7c-1cbf1dd06b27-r2-accounting.json
Accounting receipt SHA-256: d17ba6783f28e42df7a7c40ce92aefc3127b936158c6f194ba0aaeda099751a8
Auditor source SHA-256: 15e279f181410cb653ec1e10618e730b95e244c99e5d1fb838ae9589bb73ec47

No paid call, runtime restart, browser, Temporal, Knowledge Service, database, Storage, or provider action was performed.

### Offline benchmark report evidence navigation

Updated the renderer-only diagnostics offline demo report surface in packages/application/src/verification-benchmark.ts. Every catalog-owned citation displayed in report HTML now links locally to evidence-appendix.html at its exact case fragment anchor. The appendix labels the case, captured claim verdict, capture ID, fragment ID, projection and transformation IDs, selector, and selected-content digest. Resolved entries display only the genuine selector-resolved selectedText; any locator/digest mismatch, including the corrupted-locator fixture, renders an explicit unavailable state with no text. Each appendix entry links back to the local run-manifest section and its run-ledger JSON reference.

Existing report files remain; evidence-appendix.html and evidence-appendix.json are included before the generated verification-bundle and manifest, so their digests are explicit manifest entries. The renderer escapes all report text before replacing only catalog-owned citation labels with fixed local hrefs. No external asset, network reference, page copy, semantic authority, or provider call was added.

- corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-benchmark.test.ts — exit 0; 10/10 passed.
- corepack pnpm --filter @aiengineer/knowledge-application typecheck — exit 0.

Source hashes:
packages/application/src/verification-benchmark.ts 9a41e7806c11313d994cd9917ffb89cf1cae92da3a19d1530e66498d33ee324b
packages/application/src/verification-benchmark.test.ts 47306c59fbd481f10fdbd687993d5cde5938060708cea97ceb88b646e872195e

No browser, provider, database, Storage, or runtime proof was started.

### Offline benchmark report evidence navigation: local-browser validation

After the native proof server stopped, generated the renderer's deterministic offline diagnostic report and opened the installed local files in headless Chrome using the dashboard package's existing Playwright dependency. The browser followed the actual corrupted-locator citation to evidence-appendix.html#fragment-tru-corrupted-locator, verified the entry is explicitly unavailable with selector_or_digest_mismatch and has no resolved-fragment content, followed its local run-manifest anchor, then followed the local run-ledger.json link and verified the report run ID. Captured browser requests used file: URLs only; no server, network mock, provider, database, Storage, Temporal, or external asset was used.

- corepack pnpm --filter @aiengineer/knowledge-application exec tsx ../../internal/prove-offline-report-navigation-browser.ts — exit 0.
- Browser receipt: ../internal/verification-offline-navigation-browser-c426af2a-0ea8-4b1d-9463-803d8921fa4d.json; SHA-256 444b772f8bdc8c59bca55c840ba1ed397da1c23ed8f56c68d09e553e5f292dfe.
- Retained generated local report: ../internal/verification-offline-navigation-browser-19fef300-dcbe-4a57-a10a-851edbfc964d.

Source hashes after the final all-verdict citation correction:
packages/application/src/verification-benchmark.ts f24412b8f524c914632200ea30e4e4a8560f97b8f9a54ce41dc8a4a00ad0a00a
packages/application/src/verification-benchmark.test.ts 510b631633e9efba634a152bde88193319097053e9fa7b7e080d622c34e8507b
internal/prove-offline-report-navigation-browser.ts 2056dffa9b3562221be5c04d75b9de406d5d38b77224e5a2c2bf5fbae176ac1a

The appendix also contains evidence-less cases as explicit unavailable entries and links back to verification-audit.html. No unavailable entry supplies a fake capture, selector, digest, or selected text.

### Server-resolved runtime-principal binding retained for claims/report sealing

Claims and report application results now retain the exact RuntimePrincipalBinding returned by the server-owned runtime-principal port. It is intentionally non-enumerable: the activity's strict public operation-result schemas and terminal DTO projections receive no principal digest or deployment binding by accidental object serialization. The in-memory result still supplies the exact binding to the worker sealer.

The sealer constructs and canonically registers `verification-runtime-principal-binding.v1` only after all existing recovery checks. Its content is `{schemaVersion, tenantId, operationId, operationStepId, producerAttemptId, verifierAttemptId, assertionsArtifact, runtimePrincipals}`. The artifact has media type `application/vnd.aiengineer.verification-runtime-principal-binding+json`, artifact type `verification_runtime_principal_binding`, and exactly the hydrated assertions artifact as its parent. It joins the signed audit manifest input closure. Sealing rejects absent, malformed, same-deployment, result-mismatched, bundle-mismatched, or producer-attempt-mismatched bindings. Recovery requires the exact canonical binding digest and assertions parent in the prior signed input closure; it writes nothing during recovery.

Focused coverage confirms server-port binding retention without JSON/public leakage, canonical content/parent custody, and recovery rejection after a principal digest mutation. Existing source custody and report-gate recovery controls remain covered. This is source-level integration only: no native operation, provider, database, Storage, or fixture export ran. The runtime artifact vocabulary must be available in the native artifact catalog before a future native proof may enable this path.

- corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims.test.ts — exit 0; 5/5 passed.
- corepack pnpm --filter @aiengineer/knowledge-application typecheck — exit 0.
- corepack pnpm --filter @aiengineer/knowledge-application build — exit 0; refreshed the worker's declared application dependency.
- corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts — exit 0; 6/6 passed.
- corepack pnpm --filter @aiengineer/knowledge-worker typecheck — exit 0.

Source hashes:
packages/application/src/verification-claims.ts 4c057964fccfb593db1ae6cb24aa14845222e3aaa1aa140c61b50ca53dfa18a6
packages/application/src/verification-claims.test.ts 862b14506843f51d83350052475e5604bcd97b54bff917e2f02c29c3cf9339e2
apps/worker/src/verification-claims-sealer.ts 7580d5be0be7770555623e42156be59b4f40192bbe45314d0d7d14bb2c5674fc
apps/worker/src/verification-claims-sealer.test.ts 7566b167b0338af4fb79b3e5d99254d4ac512bd0a448f2ea88656210321ae598
apps/worker/src/verification-claims-activity.test.ts d170d7f84c74e5bb5186e9106087cde3759a733de5f6280fd95abbefc59fbdd8

### Runtime-principal binding recovery compatibility amendment

Recovery now distinguishes legacy signed audits from new binding-aware seals by the binding artifact's dedicated media type. A legacy audit with no `application/vnd.aiengineer.verification-runtime-principal-binding+json` input remains recoverable for its existing authenticated behavior, but does not gain any standalone replay claim. A new audit that carries that media type must carry exactly one matching binding handle with the expected canonical digest, tenant, and sole assertions-artifact parent; a changed principal digest remains recovery drift. No default, derived, or caller-supplied principal binding is substituted.

- corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts — exit 0; 6/6 passed, including legacy recovery and new-binding tamper controls.
- corepack pnpm --filter @aiengineer/knowledge-worker typecheck — exit 0.

Amended source hashes:
apps/worker/src/verification-claims-sealer.ts 4a878d167b815472fa05f50f29c6411cb57f497a3110dfe7d720151127ad39a8
apps/worker/src/verification-claims-sealer.test.ts 69ac2c596092f2ce98d3d0e84b3e1c00f0f8376147df81dcb946852169743cf5

### Runtime-principal binding: failed-run sealing correction

The sealer no longer treats established deployment separation as a prerequisite for preserving an authenticated deterministic failure. It still requires a structurally valid server-resolved binding, the producer attempt matching the sealed bundle producer, the deterministic result's recorded runtime deployment IDs matching that binding, and the recorded verifier deployment matching the running verifier deployment. It deliberately does not require a declared bundle verifier identity to succeed. This retains an auditable negative result for self-verification or a forged declared principal instead of turning it into a sealing infrastructure failure.

A focused regression supplies an authenticated binding whose verifier principal digest equals the producer digest. The deterministic result records `not_established`; the sealer writes and signs its exact binding and produces a non-pass policy outcome. This confirms that a failed mechanical separation is retained rather than admitted or discarded.

- corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts — exit 0; 7/7 passed.
- corepack pnpm --filter @aiengineer/knowledge-worker typecheck — exit 0.

Amended source hashes:
apps/worker/src/verification-claims-sealer.ts 21ef7ca930e3249b47ff44e06a2dddccfd589f2f9313a21194283eab4a17dbcb
apps/worker/src/verification-claims-sealer.test.ts 61d75585075eaf95551b513faa5ca3217a6fb1923782b00ce75eda7310ca2b60

### Native claims/report r2 catalog failure and additive vocabulary repair

The retained native r2 attempt stopped after one settled 303-micro provider call with `operation_failed`. Root traced the failure to the foreign key on `orchestration.artifact.artifact_type`: the newly sealed `verification_runtime_principal_binding` artifact type was absent from the catalog. The focused in-memory registration mock did not enforce that foreign key, so this was not visible in the unit suite. The failed operation/history remain retained; no additional paid or provider call was made for this repair.

Prepared, but did not apply, the next canonical migration after 20260907013000:
`../ai-engineer-db-contract/supabase/migrations/20260907013100_verification_runtime_principal_binding_artifact_type.sql`.
It contains only a transactional idempotent registration of `verification_runtime_principal_binding` with its canonical description. The filename is collision-free against the canonical migration directory; the type had no prior repository occurrence.

Native runner recommendation before any retry: run the canonical migration preflight and require exactly this artifact-type code and description to be present before a claims/report operation is submitted. This is a catalog read/preflight gate; it must run before any provider dispatch so a missing vocabulary cannot consume another paid call. No migration, database, package, version, provider, or runtime action was performed here.

Migration SHA-256: f41ce6f1adef662b5be9b96eec83ed114a9ed44ea636375c75fd7f539736f6e4.

### Runtime-principal artifact vocabulary post-apply and DB-contract package

Read-only local catalog verification through `internal/verification-local-direct-config.mjs` confirmed 140 installed migrations, latest `20260907013100`, and exactly one `orchestration.artifact_type` row: `verification_runtime_principal_binding` with the expected canonical description. The query used a read-only transaction and emitted no connection values. No schema, accounting, Storage, or provider mutation was made.

Updated only `ai-engineer-db-contract/package.json` from version 0.2.34 to 0.2.35 and packed the canonical DB contract without installing it into Knowledge Services. The tarball includes migration 20260907013100 and is ready at `packages/persistence/vendor/aiengineer-database-contract-0.2.35.tgz` for root-controlled pinning/install. No generated types command ran; `src/database.generated.ts` already had unrelated working-tree changes before this package step and was preserved.

- Read-only catalog verifier: `../internal/verification-runtime-principal-binding-catalog-postapply.mjs` — exit 0.
- corepack pnpm pack --pack-destination ../ai-engineer-knowledge-services/packages/persistence/vendor — exit 0.
- Receipt: `../internal/verification-runtime-principal-binding-catalog-package-20260907.json`.

Package SHA-256: aa878b5a7c1630dda351fd20afd91826c50d8933be35981e6b65de4a27e63a37.
Migration SHA-256: f41ce6f1adef662b5be9b96eec83ed114a9ed44ea636375c75fd7f539736f6e4.

### Frozen v1 report rendering compatibility

The installed v1 CLI exposed a renderer assumption introduced by pilot-v3 navigation: `cite()` dereferenced pilot-only `tru-corrupted-locator` and `tru-pdf-graph-text-abstention` cases. The renderer now treats a missing case as explicitly `not included in this frozen dataset`, with no verdict, capture, fragment, appendix anchor, or local link fabricated. Observed-value text similarly avoids `undefined`. Citations for actual cases remain generated from the selected catalog and continue to link to their appendix anchors.

Added an actual `diagnostics-companies-v1` rendering regression. It verifies both pilot-only audit lines are explicit unavailable text, contain no `undefined`, contain no corrupted-locator anchor, and retain the actual sample-source local anchor. The frozen catalog itself is never changed. Existing optional semantic fixture and audit replay handling were preserved.

- corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-benchmark.test.ts — exit 0; 11/11 passed.
- corepack pnpm --filter @aiengineer/knowledge-application typecheck — exit 0.

Source hashes:
packages/application/src/verification-benchmark.ts 14d74a4dce3e9c7717f892f0b1000b1404e5e6f177b979861563715835e13cf7
packages/application/src/verification-benchmark.test.ts 60db824471a64e6595737d46d269e37679e5e9959d1c730df42bc7e700f44efc

No provider, database, Storage, Temporal, or native CLI action was run by this repair.

### Worker strict terminal fixture correction

The only full-worker regression was a test fixture that made untimePrincipals enumerable, unlike the application result. The activity then correctly rejected that private field through the strict public claims terminal schema. The fixture now defines the trusted binding as non-enumerable, matching the application retention boundary, and asserts the serialized activity result contains no principal digest.

- corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-activity.test.ts — exit 0; 1/1 passed.
- corepack pnpm --filter @aiengineer/knowledge-worker test — exit 0; 19 files, 87 passed, 5 skipped.

Fixture source hash: apps/worker/src/verification-claims-activity.test.ts 72808d83fc5f793974ccb8d3f0799ca53079084bc941cf9e9169f2c8d3ba509c.
No provider, database, Storage, Temporal, or native action was run.

### §15.9.5/§15.9.6 offline diagnostics CLI exit-contract gap audit

Read-only review only; no catalog, fixture, CLI, provider, or report source was changed.

The current installed command path is `apps/cli/src/index.ts:11-13` to
`apps/cli/src/diagnostics-demo.ts:17-46`. It validates the frozen catalog and
source-preparation digest, stages output, invokes
`runDiagnosticsCompaniesDemo`, publishes the staged artifact set, and then
unconditionally returns `{ status: "completed_without_admission", exitCode:
0 }`. Its exception path maps every thrown error to `DEMO_ERROR` and exit 2.
The installed CLI test at `apps/cli/src/diagnostics-demo.test.ts:25-49`
therefore currently asserts exit 0 and `completed_without_admission`.

That does not meet the normal exit contract in specification §18
(`docs/specifications/verification-module.md:971-977`): exit 0 is a
completed/admitted result, exit 1 is a completed quality-gate failure, and
exit 2 is infrastructure/configuration/authentication failure. It also falls
short of §15.9.5 (`:827-846`) and the pack gates in §15.9.6 (`:848-858`),
which require the command to evaluate the frozen pack, its adversarial
mutations, replay, and reports rather than merely generate them.

The actual offline executor confirms the gap. In
`packages/application/src/verification-benchmark.ts:405-424`, it does run
selector/extraction mechanics for every case, but only the baseline arm is
executed. `diagnosticsBenchmarkArms()` at `:106-109` declares four arms;
the three provider-dependent arms are explicitly manufactured as
`failureClass: "provider"`, `policy: "abstain"`, and
`providerDispatches: 0` at `:420-424`. The one optional semantic replay is
described as supplemental and the four-arm comparison unavailable at
`:487-492`. The audit itself says provider arms are unavailable and all
scores are engineering expectations at `:458-462`; the output JSON repeats
the unavailable-provider limitation at `:499`. No typed pass/fail/incomplete
gate is computed or emitted before `:507` returns.

The immutable v1 manifest is the correct input boundary: catalog manifest
`catalog/verification-benchmarks/diagnostics-companies-v1/manifest.json`
has dataset digest
`sha256:e3529d2d27e3f473d4f6eb9da633b404c14c48f20b9db8c1d7a428220d538d9e`,
source-preparation digest
`sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e`,
and manifest digest
`sha256:fc927c53f8bc308227fe3e9f1f5d321e3075986140a25ce07755208c86ac09e1`.
Its 40 cases include 20 `adversarial`-tagged immutable cases. Their
expectations are explicitly `labelStatus: "engineering_expectation"`; they
are neither human labels nor a substitute for unavailable provider arms.
This agrees with swarm instruction `03-SWARM-INSTRUCTIONS.md:184-204`,
especially required monotonic adversarial degradation and the prohibition on
relabelling engineering labels as gold.

**Required classification and minimal next implementation**

1. Add a typed, persisted diagnostics quality-gate result before the CLI
   decides its exit code. It must list every required §15.9.6 check,
   required case/arm coverage, the immutable dataset and output-manifest
   digests, the exact 20 adversarial case IDs, per-case expected versus
   observed support/policy/locator values, deterministic replay status, and
   report/selector navigation checks. Include `humanGoldScoringEligible:
   false` and explicit provider-arm states; never turn those states into
   labels or a passing semantic result.
2. Treat absent/tampered catalog, source preparation, required semantic
   replay asset, required case/arm, or gate-definition asset as
   `configuration_incomplete` (exit 2). The command should still publish a
   clearly marked diagnostic artifact set only when it reached a stable,
   validated output boundary; otherwise retain the existing no-partial-output
   failure behavior. A required provider/verification arm that is configured
   as unavailable is likewise incomplete coverage, not an adversarial pass.
3. Once every required input and execution path exists, evaluate the actual
   immutable expectations. A complete run with a selector, replay, report,
   required-arm, or adversarial mismatch is `quality_gate_failed` (exit 1),
   while retaining `quality-gate.json` and the report/ledger artifacts for
   review. Do not throw this completed outcome through the generic exit-2
   exception path.
4. Return exit 0 only for a complete typed gate pass. Do not retain the
   unconditional `completed_without_admission`/0 combination. Under the
   strict specification, the current v1 baseline-plus-unavailable-provider
   run cannot honestly be a full pass: it must be represented as typed
   incomplete/exit 2 until the required execution coverage is present. This
   avoids inventing a narrower offline-success scope or silently excluding
   the unavailable arms.

Recommended focused tests when implemented: (a) current immutable v1 yields
typed `configuration_incomplete`/2 rather than 0 while preserving its
reviewable output inventory; (b) remove or alter one required adversarial
case/expectation in a temporary copy and receive 2; (c) mutate one completed
baseline result after all required coverage is supplied and receive
`quality_gate_failed`/1 with its gate evidence retained; and (d) an all-path
fixture can receive 0 only with all 20 adversarial checks, replay, reports,
and selectors passing. These tests must use copies or synthetic output only;
they must never rewrite frozen v1 assets, assign human labels, or dispatch a
provider.

No validation command was run because this was a source/ledger audit and no
implementation was authorized in this slice.

### Strict full-demo diagnostics quality-gate classifier

Added only `packages/application/src/verification-diagnostics-quality-gates.ts`
and its focused test. `evaluateDiagnosticsFullDemoQualityGate` is a pure
classifier; it executes no catalog, report, provider, or verification work.
It requires exactly one compact observation for every fixed full-demo
obligation: catalog/preparation integrity; extraction verification; selector
resolution; count/timeline conflict visibility; authority/applicability
boundaries; adversarial mutations; report generation/citations; deterministic
replay; verdict-to-fragment navigation; offline artifact set; provider-arm
execution; semantic claim/report coverage; and immutable live-refresh diff.
There is no caller-selected scope or bypass.

The result is an immutable
`verification-diagnostics-full-demo-quality-gate.v1` record containing the
dataset and run-manifest digests, ordered compact gate evidence, reasons, and
the only allowed boundary flags: `admissionChanged: false`,
`humanGoldScoringEligible: false`, and
`labelBoundary: "engineering_expectations_only"`. It classifies malformed,
unknown, duplicate, missing, or unavailable records as `unavailable`/exit 2.
It returns `fail`/exit 1 only if all required paths were observed and at least
one measured gate failed. An unavailable path has precedence over failure.
It returns `pass`/exit 0 only with complete passing observations. The helper
does not claim that a present v1 run has supplied those observations; root
owns benchmark/CLI collection and publication.

- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-diagnostics-quality-gates.test.ts` — exit 0; 8/8 passed.
- Package typecheck was attempted concurrently but is not evidence for this
  helper: root's in-progress benchmark integration had not yet returned its
  newly required `qualityGate`, and separately added
  `verification-diagnostics-adversarial.ts` had pre-existing current type
  errors. The focused suite transpiled and executed the new helper.

Source hashes:
`packages/application/src/verification-diagnostics-quality-gates.ts`
`cd63b19f6789428b5c64b0bc95fc7e6bc96daa80c5f545a260de4e8780abfae9`.
`packages/application/src/verification-diagnostics-quality-gates.test.ts`
`e94a44dc9b2dcf9616e82d404782af91c73502a78ec2d7c0423483e2c699e3ff`.

No provider, database, Storage, Temporal, fixture, or report mutation was
performed by this helper.

### Read-only review: diagnostics quality-gate benchmark and CLI integration

Reviewed root's integration without running tests or editing product source.
`packages/application/src/verification-benchmark.ts:491-532` supplies every
fixed gate ID to the strict classifier, writes `quality-gates.json` and the
actual `adversarial-checks.json`, adds the gate outcome to the audit report,
and retains both before sealing the bundle/output manifest. The gate uses the
run manifest digest rather than the output-manifest digest, avoiding a
quality-gate/output-manifest hash cycle. `apps/cli/src/diagnostics-demo.ts:40-46`
publishes the complete staged output before returning a truthful status and
the classifier's exit code. Thus the present incomplete v1 execution yields
`verification_incomplete`/2 while leaving reviewable artifacts; unavailable
takes precedence over any measured failure. No provider result is relabelled,
and the audit explicitly retains `admissionChanged: false` and no human-gold
eligibility.

One concrete test update remains necessary: the former installed-command
assertion at `apps/cli/src/diagnostics-demo.test.ts:33-36` still expects
exit 0 and `completed_without_admission`. It must assert exit 2,
`verification_incomplete`, `qualityGate.outcome: "unavailable"`, and the
same retained artifact inventory.

One non-blocking evidence-granularity improvement was reported to root:
`offline_artifact_set` at `verification-benchmark.ts:504` is currently marked
unavailable because full verification results are unavailable. That makes the
overall result correctly exit 2, but this gate should eventually evaluate only
the documented generated inventory after writes and report passed/failed on
that evidence. The independent provider/report/replay gates already preserve
the unavailable state, so separating this observation would improve the
review record without creating a pass path.

No provider, database, Storage, Temporal, fixture, report, or CLI execution
was performed in this review.

### Correction and final bounded review: diagnostics CLI and output inventory

The preceding review's claimed stale CLI-test gap is withdrawn. The current
installed command test at `apps/cli/src/diagnostics-demo.test.ts:33-38`
already asserts exit 2, `verification_incomplete`,
`qualityGate.outcome: "unavailable"`, explicit no-admission state, the
unavailable semantic-coverage gate, and retained quality/adversarial files.
Root reports its current relevant suite as 28 passing tests; no concurrent
test was rerun for this read-only correction.

The final inventory implementation is also sufficient for the narrower
`offline_artifact_set` observation. After all report, ledger, gate,
adversarial, optional replay, bundle, and manifest files are created,
`verification-benchmark.ts:532-539` constructs the exact mandatory name set,
requires equal count and uniqueness, requires every mandatory name, then
re-reads every listed output and verifies byte length plus SHA-256 digest.
Any discrepancy throws `DIAGNOSTICS_OUTPUT_INVENTORY_INCOMPLETE` or
`DIAGNOSTICS_OUTPUT_FILE_INTEGRITY_FAILED`; CLI handling maps that exception
to infrastructure/configuration exit 2 and does not publish the staging
directory. Therefore the already-created `offline_artifact_set: passed`
observation at `:504` can only be returned after the final inventory check.

The remaining unavailable gates still make v1 `verification_incomplete`/2,
so this correction creates no pass route or semantic/admission overclaim. No
provider, database, Storage, Temporal, fixture, report, or CLI execution was
performed in this correction.

### Read-only reconnaissance: immutable diagnostics capture/proposal and diff commands

No network, provider, capture, database, Storage, CLI, or source mutation was
performed. The requested command surface is not implemented as specified;
the following reusable seams and missing contracts were identified.

**Existing reusable entrypoints**

- Generic authenticated source capture is already public through
  `CaptureSourceRequestSchema` in
  `packages/contracts/src/verification/requests.ts:32-45`, the typed client
  `KnowledgeClient.captureVerificationSource` in
  `packages/client-typescript/src/client.ts:56`, and CLI dispatch at
  `apps/cli/src/commands.ts:31` plus `:103` (the `captureSource` branch).
  It accepts exactly an `acquire` credential-free HTTP(S) URI or a
  `register` content-artifact reference, projection kinds, and a
  server-derived authenticated operation context. It does **not** accept a
  dataset version name, proposal destination, source policy, or catalog
  mutation instruction. The request contract rejects userinfo URLs and
  duplicate projection kinds; actual acquisition still depends on the
  configured server-side capture admission/runtime policy. It must never be
  used as an unbounded client-side fetch.
- The current `benchmark capture` command is only that generic capture
  dispatch (`apps/cli/src/commands.ts:31`), so it cannot satisfy
  `knowledge benchmark capture diagnostics-companies --propose-version ...`
  as written. It requires the normal `--input` request and trusted context.
- Frozen input loading is already strict and offline in
  `packages/application/src/verification-diagnostics-offline-catalog.ts`
  (`DIAGNOSTICS_OFFLINE_CATALOG_SEALS`, `loadDiagnosticsOfflineCatalog`),
  and current immutable assets are catalog directories such as
  `catalog/verification-benchmarks/diagnostics-companies-v1/` with a sealed
  `manifest.json`, dataset, source ledger, candidate pool, grant, and
  experiment. The v1 manifest binds the source-preparation digest rather
  than providing a mutable capture source list.
- `RegisteredBenchmarkInputAdmission`/`OfflineBenchmarkInputCatalog` in
  `packages/application/src/verification-benchmark-inputs.ts`,
  `RegisteredBenchmarkSourceImportAdmission` in
  `verification-benchmark-source-import.ts`, and
  `RegisteredDiagnosticsOfflineBenchmark` in
  `verification-benchmark-offline-executor.ts` safely run an *already
  registered* offline benchmark. Source import explicitly uses trusted grant
  mappings, exact artifact hydration, parent closure, and a read-only parser
  archive; it is not a refresh/proposal writer.
- `RegisteredBenchmarkPublicationBuilder` in
  `packages/application/src/verification-benchmark-publication.ts` produces
  immutable publication artifacts from a fully admitted offline run. It
  preserves the engineering-label boundary and no-provider accounting, but
  does not construct a new source capture/catalog/dataset version.
- `VerificationBenchmarkComparisonApplicationService` in
  `packages/application/src/verification-benchmark-comparison.ts`, the
  strict `CompareBenchmarkRunsRequestSchema`, and CLI `benchmark compare`
  (`apps/cli/src/commands.ts:31`) compare two existing **run IDs** under a
  server-owned comparison-profile grant. They cannot resolve
  `diagnostics-companies-v1`/`v2` names, and must not be misrepresented as a
  dataset-version drift diff.
- A one-off persistence script,
  `scripts/persist-verification-benchmark-v4.ts`, shows prior catalog-to-DB
  staging but hard-codes a historical catalog, tenant, artifact set, and
  direct database composition. It is evidence/migration tooling, not a
  reusable CLI proposal implementation.

**Minimal honest end-to-end implementation**

1. Add a dedicated application request/result contract for a diagnostics
   refresh proposal, separate from `CaptureSourceRequest`: accepted current
   sealed catalog name, exact proposed new immutable name (for example v2),
   server-owned approved source policy/reference, and output location or
   registered proposal artifact. Reject existing destination names, a name
   equal to the source version, caller-supplied source bytes/labels/grants,
   and any source outside the server-owned allowlist. The resulting proposal
   must contain new capture handles, source/license observations, immutable
   candidate catalog manifest/digests, and a drift input manifest; it must
   not overwrite v1 or publish/admit a promotion.
2. Compose this only in a configured worker/API capture runtime that applies
   the same authenticated ownership, SSRF/acquisition, private-Storage, and
   source-policy controls as `captureSource`. The CLI command should parse
   only `diagnostics-companies` and `--propose-version`, then submit this
   typed operation with normal idempotency/context; it must not iterate URLs
   from a local catalog or call provider SDKs directly.
3. Add a dedicated version-diff reader/application operation which resolves
   two sealed catalog/proposal artifacts by exact version IDs, verifies both
   manifests and source lineage, and writes a bounded drift report (added,
   removed, changed source/capture/case/selector/digest plus label-policy
   state). It may reuse the existing run-comparison statistics only after
   both versions have compatible sealed runs, but cannot substitute
   `CompareBenchmarkRunsRequest` for catalog drift.
4. Install the proposal command's discovered output through an explicit
   result/read endpoint: proposal ID, immutable catalog/manifest artifact
   references, captured-source count, policy observations, and drift report
   reference. Do not discover it by scanning a filesystem or treating an
   artifact ID as a version/evidence ID. Existing CLI output conventions can
   print that compact receipt.
5. Focused tests should use a temporary catalog/output namespace and a fake
   configured capture adapter: reject unknown/duplicate/prohibited source
   policy before an operation; prove v1 bytes remain unchanged; prove an
   exact v2 proposal manifest and drift report; and reject a version diff
   whose manifest/source/capture binding is tampered. No provider, human
   label, or production source acquisition is needed for these tests.

This remains a proposal-only gap. `ACCEPTANCE-MATRIX.md:53` retains VR-045
as missing, and `03-SWARM-INSTRUCTIONS.md:199-204` requires an immutable
refresh/diff without mutating v1. No existing generic endpoint may be called
"benchmark capture/diff" until the typed proposal and version-diff boundaries
exist.

### Pure sealed benchmark-version diff preparation

Added only `packages/application/src/verification-benchmark-version-diff.ts`
and its focused test. The exported
`prepareVerificationBenchmarkVersionDiff({ previousDataset, proposedDataset,
previousManifestDigest, proposedManifestDigest })` accepts no path, catalog,
URL, source bytes, label, capture, or persistence authority. It bounds each
raw JSON input to 8 MiB, parses the strict dataset schema, validates frozen
case and manifest canonical digests, binds each supplied manifest reference,
then delegates immutable lineage/case changes to the existing
`diffVerificationBenchmarkDatasets` implementation.

The compact result adds the pieces absent from that lower-level case-hash
diff: validated version lineage, source-preparation digest change, label
provenance change, human-gold-eligible case counts, pending
human/expert-review case counts, and adjudication-artifact references. It
always states `humanApprovalGranted: false`; it neither assigns labels nor
turns an observed provenance change into approval. Existing lineage errors,
case-digest tampering, mismatched supplied manifest references, malformed raw
JSON, and bounds fail closed.

- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-benchmark-version-diff.test.ts` — exit 0; 5/5 passed.

Source hashes:
`packages/application/src/verification-benchmark-version-diff.ts`
`81a2a91349a116405ba2df5ece2c47751fd49d62e2c6289d4b522a5b7bd67e86`.
`packages/application/src/verification-benchmark-version-diff.test.ts`
`3112307c238531db7a1fc2e8373d41ff28664265f53ef056aa2b31e636899077`.

No filesystem/catalog/CLI integration, network, provider, database, Storage,
Temporal, capture, or source mutation was performed.

### Acquisition executor focused boundary tests

Corrected the version-diff test's successor digest annotation so the package
typecheck accepts its `Digest` boundary. Added only
`packages/application/src/verification-service-acquisition.test.ts`; no
service, worker, acquisition adapter, catalog, or runtime source was edited.

The new tests compose the actual `VerificationOperationExecutor`,
`VerificationServiceCatalog`, `VerificationAdmissionService`, parser output,
and a content-addressed fake repository. They verify that an admitted acquire
path registers exact raw HTML bytes with exactly one canonical acquisition
receipt parent, preserves tenant/operation/source/content-digest response
metadata, then invokes actual parser admission. They also verify recovery
uses the deterministic registered capture without a second acquire; foreign
tenant and ungranted URI requests are rejected before acquire; cancellation
during acquire leaves no artifact/capture registrations; and tampering a
recovered receipt's bytes fails its digest/metadata custody check before
further admission. These are mechanics/custody controls, not expected-verdict
shortcuts.

- `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-service-acquisition.test.ts src/verification-benchmark-version-diff.test.ts` — exit 0; 10/10 passed.
- `corepack pnpm --filter @aiengineer/knowledge-application typecheck` — exit 0.

Source hashes:
`packages/application/src/verification-benchmark-version-diff.test.ts`
`89f0f90d9e0c549f5b894be1580cb65e7fc9cc57b28ec918651f294ca7e34afb`.
`packages/application/src/verification-service-acquisition.test.ts`
`b00a5a1defb1e803d4adf42e236063709714991a63a772a519150c86f5e6e5cd`.

No network, provider, database, Storage, Temporal, or source acquisition was
performed by these tests.

### Capture-acquisition API route boundary tests

Added only `apps/api/src/verification-acquisition-routes.test.ts`. The injected
Fastify tests use `KnowledgeIntegrationService` and a server-created
`VerificationServiceCatalog`; they make no database, network, worker, or
source-acquisition call. They cover the explicit HTTP boundary: acquire mode
is 503 without a catalog; an ungranted URI and a valid foreign caller/tenant
with no matching acquisition grant are both 403 before any durable operation;
an exact tenant+URI grant returns a queued 202 receipt and persists the
canonical capture-source request; and existing register mode remains 202 when
no acquisition catalog is configured.

- `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-acquisition-routes.test.ts` — exit 0; 3/3 passed.
- `corepack pnpm --filter @aiengineer/knowledge-api typecheck` — exit 0.

Source hash:
`apps/api/src/verification-acquisition-routes.test.ts`
`7c09b9f32b7ff64d6602cdb11a48cb3533b5d3073149323001d460538cd52768`.

This validates only injected route composition and durable in-memory submit
semantics. It is not a live capture, database, network, worker, or provider
proof.

### Immutable refresh proposal reconnaissance (no implementation)

**Scope:** mapped the requested future public commands
`knowledge benchmark capture diagnostics-companies --propose-version diagnostics-companies-v2`
and `knowledge benchmark diff diagnostics-companies-v1 diagnostics-companies-v2` against
current source. This is a design note only; no catalog, capture, artifact,
dataset, source, review, or promotion mutation was performed.

**Reusable components.** `benchmark capture` already resolves to the existing
`captureSource` public mutation in
`apps/cli/src/commands.ts` and posts `POST /v1/verification/captures`
(`apps/api/src/server.ts:620-628`). In acquire mode the route requires a
server-configured `VerificationServiceCatalog` exact `(tenantId, canonical
HTTPS URI)` acquisition grant and submits a durable `verification_capture`
operation; `VerificationOperationExecutor.#acquireCapture` deterministically
retains the raw response, acquisition receipt, capture, and admitted
projections (`packages/application/src/verification-service.ts:356-405`).
There is no reason to add an operation kind merely to refresh a source.

The existing immutable side is also reusable: `freezeVerificationBenchmarkDataset`
creates a new content-bound frozen dataset and refuses human-gold scoring
without an admitted adjudication artifact (`packages/evaluation/src/verification-benchmark.ts:63-83`);
`prepareVerificationBenchmarkVersionDiff` validates bounded frozen bodies,
binds the supplied manifest digests, delegates the existing dataset diff, and
reports source-preparation changes plus pending-review counts
(`packages/application/src/verification-benchmark-version-diff.ts:34-57`).
`RegisteredBenchmarkSourceImportAdmission` shows the required model for
readmitting preserved registered source/capture/projection artifacts with full
parent closure, artifact-byte verification, and no parser invocation
(`packages/application/src/verification-benchmark-source-import.ts:69-128`).

**Actual public-path gaps.** The CLI currently has no default context profile:
`apps/cli/src/index.ts:18-21` requires `KNOWLEDGE_API_URL`,
`KNOWLEDGE_API_TOKEN`, and an entire valid `--context` JSON value. Therefore
the requested no-context-flags command cannot be honest with today’s CLI. It
needs a separately designed, authenticated server-side operator context/profile
resolution; deriving tenant, actor, mission, attempt, or idempotency from an
unscoped environment default would weaken the current boundary. The command
also cannot publish an immutable candidate today: no CLI/application command
combines terminal capture reads, trusted artifact publication, source
preparation, and `freezeVerificationBenchmarkDataset` into a new catalog
version.

There is no dedicated terminal capture resource endpoint or client method.
The capture route returns only the queued operation receipt; generic operation
and receipt reads can expose execution state, but they do not provide a typed,
full registered capture/source/projection closure suitable for candidate
assembly. Existing typed public reads cover benchmark runs/manifests, cases,
and evidence (`apps/cli/src/commands.ts:52-58`), not captures. A capture
terminal read must be added before an end-to-end public refresh can safely
consume a completed operation.

**Smallest complete future path.**

1. Add a typed, tenant/actor-authorized capture terminal read that returns the
   exact source, capture, content/projection full handles, acquisition receipt,
   and only safe metadata; bind it to the submitted operation and never expose
   raw object keys/bytes.
2. Add server-owned authenticated CLI context resolution for this one command
   (or retain the required `--context` contract). It must create fresh
   correlation/idempotency values and exact grant checks; it must not be an
   implicit local identity default.
3. Implement `benchmark capture ... --propose-version NAME` as orchestration
   of the existing capture, terminal read, and registered-artifact publication
   only after the capture succeeds. Build a **new** source-preparation manifest
   and freeze a **new** candidate dataset. Retain `diagnostics-companies-v1`
   manifest/hash as an immutable parent/reference; never overwrite or promote
   it.
4. Carry source license/rights, source drift, and pending source/license/gold/
   leakage review records into the candidate manifest. `humanGoldScoringEligible`
   remains false until existing adjudication admission rules are met; no review
   approval can be inferred by the command.
5. Implement `benchmark diff PREVIOUS PROPOSED` as an artifact-backed lookup
   of both frozen datasets followed by `prepareVerificationBenchmarkVersionDiff`.
   Persist/display its digest-bound source-preparation delta, case diff, and
   pending-review dimensions. It reports a proposal comparison only and never
   promotes either version.

**Conclusion:** live capture plus registered artifact publication can compose
the refresh; a new operation type is unnecessary. The required typed capture
terminal read, candidate publication/catalog boundary, and no-context CLI
identity design are currently missing, so the specified commands are not yet
implementable as a complete public path.

### Capture terminal-read contract (strict compact DTO)

Added only `packages/contracts/src/verification/capture-reads.ts` and
`packages/contracts/src/verification/capture-reads.test.ts`; no contract barrel,
application, API, client, worker, catalog, or transport was changed. The new
`VerificationCaptureTerminalResourceSchema` is a strict discriminated terminal
projection for existing `captureSource` executor output:

- Common terminal fields are tenant/operation/request bindings, literal
  `state: "succeeded"`, literal
  `disposition: "captured_without_admission"`, source/capture identity, one
  `html_dom` projection admission, and result artifact.
- `captureMode: "acquire"` requires an acquisition-receipt reference;
  `captureMode: "register"` is a separate strict branch and rejects one.
- Every published artifact is the existing compact public reference
  `{artifactId,digest,mediaType,sizeBytes}`. The schema excludes bytes,
  object keys, transport headers, credentials, and producer-private fields.
- It reuses the capture and projection-admission primitives, constrains the
  compact subset, requires source/capture/projection identity equality, and
  rejects aliasing the source/native/projection/transformation/result roles.

- `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/capture-reads.test.ts` — exit 0; 3/3 passed.
- `corepack pnpm --filter @aiengineer/knowledge-contracts typecheck` — exit 0.

Source hashes:
`packages/contracts/src/verification/capture-reads.ts`
`1a1083e78cf138ce085ab28ee81f89aa784e1ea4b85c71182abf99425e669081`.
`packages/contracts/src/verification/capture-reads.test.ts`
`2a8f5b0d4e959d388064b3ce1f75b6680ff01f41e2cff57245bb22d8cecab08d`.

This establishes only a typed DTO contract. Authentication, verified terminal
hydration, application/API/client reads, and publication remain separate work.

#### Capture-read custody hardening amendment

Tightened the new contract before integration: source is explicitly `web_page`;
content must be `text/html`; capture and projection source artifact references
must match on all compact fields (ID, digest, media type, and size); acquire
mode must use exactly `https_acquire` /
`verification-source-acquisition.v1`; and the acquisition receipt must be a
distinct artifact role from the source/native/projection/transformation/result
roles. Added hostile cases for altered compact type/size, non-acquire capture
metadata, receipt/result aliasing, non-web source, and non-HTML content.

- `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/capture-reads.test.ts` — exit 0; 4/4 passed.
- `corepack pnpm --filter @aiengineer/knowledge-contracts typecheck` — exit 0.

Revised source hashes:
`packages/contracts/src/verification/capture-reads.ts`
`c58b50b03c2b054669068e7e44ad3e7348c6139164fef4311ca54874d85f6174`.
`packages/contracts/src/verification/capture-reads.test.ts`
`aa0c625e1b7c0528063c11b653d688c6cbc17b344ac7a7c9167da0ebc7b48b93`.

### Native capture terminal persistence reader

Added `packages/persistence/src/verification-capture-reads.ts`, its focused
unit test, and the corresponding persistence barrel export. The constructor is
`new PostgresCaptureReadRepository(database, verificationRepository, admission)`;
`verificationRepository` supplies tenant-scoped resolver and registered-capture
access, while `admission` supplies read-only `hydrateAdmittedProjection`.

`loadVerifiedCapture(tenantId, operationId)` validates UUIDs before I/O, then
loads one `verification_capture` terminal snapshot. It requires the durable
request and claimed step input to agree on authenticated operation context,
request/input hashes, actor/attempt/mission/work/correlation/ownership
bindings, exact `register_and_admit.succeeded` receipt, UUID event plus
positive safe fence, native guarded output hash, and a `verification_bundle`
ledger result artifact. It verifies the strict `captureSource` result against
the request, acquired/register mode, exact ordered bound artifacts and result
parents, acquisition receipt/source/projection/transformation lineage, and
hydrated canonical result bytes/registration. It then compares the native
registered source/capture and re-hydrates the recorded projection through the
actual read-only `VerificationAdmissionService` path. The snapshot is read
again after hydration/admission to reject terminal drift.

Focused controls cover malformed IDs before DB access; event fence, artifact
class, and step identity drift before Storage hydration; and projection
readmission receipt drift. The tests are fake DB/resolver only: no database,
Storage, parser, network, provider, or runtime process was invoked.

- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-capture-reads.test.ts` — exit 0; 3/3 passed.
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck` — exit 0.

Source hashes:
`packages/persistence/src/verification-capture-reads.ts`
`e0b0aaa73e4b2a31a7aefe5fffbfc27e93f8bd86d38fd5d4428fd31ea2358939`.
`packages/persistence/src/verification-capture-reads.test.ts`
`1dce3c43c402d73cdd8cb451ca729cb5c7ff0b00055a1c11f99a36f91ac74658`.

### TypeScript capture-terminal client test

Added only packages/client-typescript/src/capture-reads.test.ts. The focused
client test validates the operation UUID before transport, checks the exact
GET path and no request body, and verifies Authorization, tenant, and
correlation headers. It parses a complete acquired compact terminal resource
and rejects a response that attempts to include a Storage object key.

- corepack pnpm --filter @aiengineer/knowledge-client exec vitest run src/capture-reads.test.ts — exit 0; 2/2 passed.
- corepack pnpm --filter @aiengineer/knowledge-client typecheck — exit 0.

Source hash:
packages/client-typescript/src/capture-reads.test.ts
$hash.

This is mocked client transport coverage only; it is not a native capture-read
or authenticated server proof.

### Independent native acquisition/capture-read audit (7938d821)

Audited retained native receipt
`internal/verification-source-acquisition-native-7938d821-2872-421c-9947-d26b50f5c091.json`
(SHA-256 `40e15c45a30c0030b9ea91b07d78adcc76d3e6f620dce7ca3365f11c45709e5b`)
and its isolated wrapper
`internal/verification-source-acquire-isolated-5e196aaf-2e23-4d3b-b45f-d9849cdbb334.json`
(SHA-256 `b5e3f0fa9c1ff006b3a35e87ac3bc764e7a14c2ab96aed21c19bb2b75f069617`).

The retained proof reports one acquisition, no model/provider calls, authenticated
Fastify-inject compact capture read, denied unknown/unauthenticated reads, and
cleanup of the disposable database. Independently read six retained Storage
objects using the verified local configuration: each byte digest and length
matched; the compact terminal fields matched the terminal receipt; exact
receipt/source/parser/projection/transformation/result parent vectors held; the
result and acquisition-receipt bodies bound the recorded operation; and all four
source-snapshot digests still matched. The proof scope is authenticated Fastify
inject through configured runtime/PostgreSQL/Storage, not a network-listening
bootstrap.

Receipt:
`internal/verification-source-acquire-capture-read-independent-audit-7938d821-2872-421c-9947-d26b50f5c091.json`
(SHA-256 `84305f1abc776eb65aa491ab03a7e71c4edca38518d2cbf7fe3aa14cfb3751aa`).

Finding **P1 CAPTURE_READ_RECEIPT_HYDRATION_GAP**: the current
`PostgresCaptureReadRepository` hydrates the result and re-admits the
source/native/projection/transformation path, but does not hydrate and validate
the acquire-mode acquisition-receipt bytes. It must bind the full registered
receipt handle, canonical receipt body and its tenant/operation/source/content
metadata and transformation signatures before serving a succeeded read. The
native proof remains evidence for its exercised path, not for this missing
reader validation. The wrapper JSONL also left `receiptPaths` empty because it
did not parse the child `outputPath`; manual file-time receipt discovery was
required.

### Capture-read acquisition receipt custody repair

Resolved the receipt-hydration finding in
`packages/persistence/src/verification-capture-reads.ts`. Acquire-mode terminal
reads now use the trusted resolver to authorize and hydrate the exact receipt
handle before projection readmission. They require the full registered handle,
digest, byte length (at most 65,536), receipt media type and empty parents; a
canonical strict `VerificationAcquisitionReceiptSchema` body; tenant,
operation, source, source URI, capture timestamp and content-digest bindings;
redirect/final-URI and content-length consistency; and exact source/receipt
transformation signatures. A succeeded capture read therefore cannot rely on
receipt IDs alone.

`VerificationAcquisitionReceiptSchema` is now exported from
`packages/application/src/verification-service.ts` for this internal reader,
keeping its validation rules shared with acquire/recovery rather than copying a
second schema. No public DTO changed.

Focused negatives now reject altered receipt bytes/registration parent and
canonical receipt metadata whose operation or redirect-final URI does not bind
the terminal. These controls fail before projection readmission.

- `corepack pnpm --filter @aiengineer/knowledge-application build` — exit 0
  (needed to refresh the local application dist for the new schema export).
- `corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-capture-reads.test.ts` — exit 0; 5/5 passed.
- `corepack pnpm --filter @aiengineer/knowledge-persistence typecheck` — exit 0.

Current hashes:
`packages/application/src/verification-service.ts`
`054138b9116fbaa9e3d826fcc4e18c4330f8b487ca51af2a5cecab1c1b257c66`;
`packages/persistence/src/verification-capture-reads.ts`
`90ce9faec0dc82483c45081211f6aa19c63afaf7b91a5adb578550bb30fbdbb5`;
`packages/persistence/src/verification-capture-reads.test.ts`
`3e38e266e306f4e53f5e67e7d6010ae564fbb22cc7be5a4635c124ebf868e104`.

The repair is focused local test/typecheck evidence. The native successor proof
must exercise this reader before it is treated as native evidence.

### Successor native acquisition/capture-read audit (fa90f602)

Independently audited successor native receipt
`internal/verification-source-acquisition-native-fa90f602-b6e6-4ef3-9dd2-8bc323e68f1b.json`
(SHA-256 `652e96984729b34c1ffe456706bb7f9d69a6fc82ebbad837fb6f40c5f64dd35c`)
and wrapper `internal/verification-source-acquire-isolated-55b7a7bc-559c-4eae-aed5-9f567d590b7d.json`
(SHA-256 `b83771cf359248187d0b2c8c78edf82c1a1b4bfb52072cd0648e42faafa3bf05`).

The wrapper JSONL now binds its child output to the exact native receipt path,
with exit 0, zero retained model/provider/accounting calls, and verified
removal of its only database and dump directory. The parent wrapper JSON remains
intentionally compact and does not duplicate that receipt-path field.

Read-only Storage hydration independently verified all six registered artifacts:
byte digest and length, compact capture-to-terminal equality, exact
receipt/source/native/projection/transformation/result parent vectors, result
and acquisition receipt body bindings, and all retained source snapshot hashes.
The native receipt reports authenticated compact capture read, denied
unknown/unauthenticated reads, and no re-fetch. It exercised the patched
acquire reader path; focused reader tests remained 5/5 passing.

The prior **P1 CAPTURE_READ_RECEIPT_HYDRATION_GAP** is fixed within this bounded
scope: the reader now hydrates and validates the exact receipt before
projection readmission, and the successor supplies authenticated native
read evidence. This is still a one-source Fastify-inject proof, not a
network-listening, CLI, catalog, semantic/provider, or continuous-freshness
acceptance claim.

Immutable independent receipt:
`internal/verification-source-acquire-capture-read-independent-audit-fa90f602-b6e6-4ef3-9dd2-8bc323e68f1b.json`
(SHA-256 `d526b6a7cae305be335aafae9739be60c089c839e1e552ed07b738de0298a71b`).

### Independent local benchmark-version-diff CLI review

Read-only review covered `apps/cli/src/benchmark-version-diff.ts`, its dispatch
in `apps/cli/src/index.ts`, frozen source snapshot
`internal/verification-local-diff-source-be14f0c4`, and installed-command
receipt `internal/verification-installed-benchmark-version-diff-be14f0c4-ae74-436b-9fe5-6d99f5c9fbca.json`.

No actionable defect found in the bounded scope. The command accepts exactly
`benchmark diff <previous> <proposed>` plus at most one local catalog-root,
uses constrained dataset names, resolves and re-checks real paths under that
root, rejects symlinks and traversal, and bounds manifest/file/count/total
bytes. It verifies every listed file digest and the catalog manifest digest,
then delegates frozen dataset digest, version, dataset ID and strict
supersession lineage validation to the application helper. The installed
receipt's pilot-v3 → pilot-v4 result agrees with its frozen source hashes and
reports no credentials, external requests, or human approval. The missing
packaged v2 command exits 2 without creating or proposing a dataset.

The result explicitly returns `humanApprovalGranted: false`; neither its parser
nor its local loader admits an approval flag, persistence, network, provider,
or capture behavior. This is a local immutable comparison only.

Reviewed hashes: CLI command
`1f385a26c4d08195c100fd015818c09e85aae682ab49ac76c9e76243105d01ed`,
CLI index `82dbce605de7228a74e031d2b944183ad169bbde3fb6d47f042e731efca3440d`,
and installed receipt
`a87ebc8610f51fb8e01edf89e38d98060fc3fcf2fb44e7992dd2c93a9cae1a29`.

Limit: this review did not create a v2 catalog, invoke source acquisition, or
run a command; it relies on the immutable installed receipt and frozen
snapshot as requested.

### Reconnaissance: exact-syntax authenticated benchmark capture

Current CLI mutation dispatch in `apps/cli/src/index.ts:22-29` requires
`KNOWLEDGE_API_URL`, `KNOWLEDGE_API_TOKEN`, full caller JSON `--context`, and
`--input`. It has no context profile/default resolver. The TypeScript client
only turns that context into `x-tenant-id`, correlation/idempotency and
verification attempt/work-item/mission headers
(`packages/client-typescript/src/client.ts:69,98`). Therefore the exact syntax
`knowledge benchmark capture diagnostics-companies --propose-version
diagnostics-companies-v2` cannot safely submit today.

The API already has the correct server-owned building block:
`createVerificationOwnershipResolver` in
`apps/api/src/verification-ownership.ts:49-83`. It binds a bearer-authenticated
actor plus a configured ownership grant to existing canonical tenant, mission,
work item and attempt records, then mints deterministic operation context. It
requires the routing hints today; `server.ts:421-432` rejects their absence.
`KNOWLEDGE_API_IDENTITIES` supplies bearer-to-actor and tenant action grants;
`VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON` separately binds the permitted
mission/deployment/capability. Benchmark runtime also refuses startup without
that dynamic ownership resolver (`apps/api/src/index.ts:75-77`).

Minimal safe implementation: introduce a **server-only opaque benchmark capture
profile** configuration, e.g. a bounded strict
`VERIFICATION_BENCHMARK_CLI_PROFILES_JSON`. Each named profile contains the
already-existing tenant, actor identity, mission, work item, attempt, and
optional exact external-execution binding; it contains no credential and is
validated by the same tenant-qualified joins and ownership grant resolver.
The exact CLI command sends only the fixed command/version intent, bearer token,
an opaque profile name, generated correlation/idempotency values, and no
actor/tenant/attempt/work/mission JSON. The API resolves the profile *after*
bearer authentication, requires the profile actor to equal the authenticated
actor and its tenant to be authorized for `operation.submit`, refuses a
nonunique/missing/stale/foreign profile, and passes its server-owned hints to
the existing resolver. It must reject any simultaneous caller routing headers.

This requires a narrow API access/profile adaptation because current
`requireAccess` demands `x-tenant-id` before verification-context resolution.
Do not replace it with a client environment profile: that would merely move the
current caller-controlled routing IDs from `--context` to environment. Existing
static `VERIFICATION_SERVICE_ATTEMPT_ID` is explicitly development-only and
cannot enable benchmark runtime. No existing config supports the required
exact syntax yet.

No source was changed and no capture, network, provider or database activity
was performed.

### Server-owned benchmark capture profile resolver

Added only `apps/api/src/verification-benchmark-capture-profile.ts` and its
focused test. `createVerificationBenchmarkCaptureProfileResolver(database,
rawProfiles, rawOwnershipGrants)` returns the API-facing resolver requested by
the capture-profile route. Profiles are bounded strict configuration records:
opaque `profileName`, existing tenant, exact actor, mission, work item and
attempt IDs. No IDs are generated from the command or caller input.

Resolution accepts only profile name, authenticated `LocalApiIdentity`,
correlation ID and idempotency key. It returns `undefined` for unknown,
malformed, actor-mismatched or tenant-action-ungranted profiles before any
canonical query. A valid profile requires `operation.submit` for the configured
tenant, then calls the existing `createVerificationOwnershipResolver` with
server-owned hints for `captureSource`; that resolver verifies the
attempt/work/mission/deployment relationship in PostgreSQL and returns the
normal deterministic `OperationContext`. Stale/mismatched canonical ownership
returns `undefined`. Duplicate names and oversized configuration fail startup.

Focused test uses the actual ownership resolver over a query-capable fake
canonical database (not a mocked context resolver), covering valid binding,
unknown/foreign/ungranted pre-query denial, stale canonical attempt denial, and
config duplicate/size rejection. No route, runtime, Storage, network, capture,
or mutable database work was added.

- `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-benchmark-capture-profile.test.ts` — exit 0; 4/4 passed.
- `corepack pnpm --filter @aiengineer/knowledge-api typecheck` — exit 0.

### Profile capture route and client tests

Added test-only coverage for root's server/profile route and typed client method:
`apps/api/src/verification-benchmark-capture-profile-route.test.ts` and
`packages/client-typescript/src/benchmark-capture-profile.test.ts`.

The API test covers valid acquired-source 202 with the compact `{tenantId,
operation}` response; unauthenticated 401; forged tenant/verification routing
header 400 before profile resolution; unknown/ownership-unresolved generic 404;
ungranted source 403 before durable submission; and disabled profile
composition 503. It asserts the successful durable operation uses the returned
server-owned profile context.

The client test requires the exact profile endpoint, request body, bearer,
correlation and idempotency headers while asserting it does not emit tenant,
attempt, work-item, mission or causation headers. It rejects an invalid profile
name before `fetch` and rejects an expanded response outside the strict compact
schema.

- API focused test — exit 0; 4/4 passed.
- Client focused test — exit 0; 2/2 passed.
- API and client typechecks — exit 0.

Hashes: route test
`ffb491301d71552493f9c66cc3433bcfbed7952a3b394460ad19aa9fe25a3e56`;
client test
`d72981c004354bf95a04fee03adf19b440eebff8388141bcfe81289aadc5e017`.
Tests use Fastify injection and mocked client fetch only; they are not a native
capture proof.

### Independent native server-owned profile capture audit (b7f8e92e)

Read-only audited native profile receipt
`internal/verification-source-acquisition-native-b7f8e92e-a4f3-46b8-bc87-f930dc7a854e.json`
(SHA-256 `4fecf7299937c850e73c95ccd9a43dd87e16b8e7d7810e06243aa85a2bb44ec5`)
and isolated wrapper
`internal/verification-source-acquire-isolated-dd5d1031-253c-4d05-b3cd-19628d606d7b.json`
(SHA-256 `21c9b1d305daa4b9ce0a7aaf81681298f3d0e7d8d729407424eb41e9804f9b3d`).

The wrapper JSONL binds the exact child receipt, records exit 0, zero provider
attempt/budget/observation/capture rows, and confirms deletion of its owned
database and dump directory. The native receipt records authenticated
server-owned profile submission, one acquisition, native worker completion,
terminal and capture-read no-refetch, authenticated compact read, denied
unknown/unauthenticated reads, and a complete six-artifact registered closure.

Independently recomputed the deterministic operation ID from the retained
proof tenant and proof ID using the installed runtime helper; it equals both
the profile route result and persisted terminal/compact operation ID. The
terminal request/capture/receipt/projection/result linkage and exact parent
vectors agree with the compact terminal resource. All four source snapshot
hashes match current sources.

Immutable compact audit:
`internal/verification-source-acquire-profile-independent-audit-b7f8e92e-a4f3-46b8-bc87-f930dc7a854e.json`
(SHA-256 `6c780fd892b3a543ffbf43204afff44b29254694655230ee60881426ac3f918f`).

No defect found in this bounded receipt audit. It did not repeat acquisition,
Storage hydration, parser, Fastify, or PostgreSQL work; the proof is one
Fastify-inject local runtime path, not a network-listening CLI/catalog-refresh
acceptance claim.

### Immutable diagnostics refresh proposal writer (current)

Added `apps/cli/src/benchmark-refresh-writer.ts` and its focused test. The
writer accepts only the server/orchestrator compact outcome union: a strict
capture terminal resource on success, or a bounded submit/poll failure code
and optional poll-only pending operation ID. It rejects response bodies,
headers, storage fields, tokens, and unrecognised outcome keys.

Before publish it verifies the proposal canonical digest, exact v2/review-gate
state, all sixteen unique source outcomes, and each outcome's binding to the
proposal source diff. Successful records must match tenant, request, canonical
URI, operation, capture, content/projection/transformation/result handles;
unavailable records must match the proposed unavailable code. It writes only
canonical `proposal.json`, `source-outcomes.json`, and a SHA-256/byte-length
manifest through an exclusive lock and owned staging directory; all staged
bytes are re-read and hashed before atomic publish. Existing destinations are
never overwritten and owned lock/staging cleanup is bounded to resolved paths.
The writer cannot approve, freeze, or create a successor dataset.

Focused check: `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run
src/benchmark-refresh-writer.test.ts` — exit 0, 2/2. Coverage exercises
canonical manifest byte/digest records, the exact sixteen-outcome envelope,
private-field rejection, cross-bound URI rejection, destination no-overwrite,
and lock/staging absence after rejected input. CLI package typecheck was not a
writer failure: concurrent capture integration still had its own mock writer
file-type and optional `signal` errors; root/claims_report own those files and
asked to defer the whole check until their release. Writer hash
`783918831044c226cd54cae5705c7ac61f0613dbdde7ee63ef3c04d1b4fc2226`; test
hash `07544127ed8d846dde41ca1f525bb4b6ba66a8cc8efd39a8bee0eb31fd2d0560`.

### Local v1 → proposed-v2 refresh diff fallback (current)

Extended `apps/cli/src/benchmark-version-diff.ts` and its focused test so the
exact v1/v2 command first uses a real frozen v2 catalog when that directory
exists. Only when `diagnostics-companies-v2` is absent does it read the default
cwd `.knowledge/benchmark-proposals/diagnostics-companies-v2` directory (or
one explicit `--proposal-root`). It accepts exactly three regular,
non-symlinked bounded files, validates the two-entry manifest, byte lengths and
SHA-256 digests, validates the bounded sixteen-outcome envelope, then
recomputes the proposal from sealed v1 dataset/source-ledger inputs with
`prepareDiagnosticsBenchmarkRefreshProposal`. The stored canonical proposal
must match in full.

The fallback output is explicitly `kind: "refresh_proposal"`, with source diff,
historical case count, and review requirements. It sets
`frozenDatasetCreated: false` and `humanApprovalGranted: false`; it does not
construct or claim a frozen v2 dataset. A corrupt present v2 catalog is never
silently replaced by proposal fallback.

Focused check: `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest
run src/benchmark-version-diff.test.ts` — exit 0, 6/6. The new cases write an
actual proposal through the bounded writer, verify fallback output, reject a
tampered proposal manifest, and reject corrupt-present frozen v2 rather than
falling back. No CLI build ran while root's live-capture proof uses its current
dist snapshot. Diff source hash
`1a21f94f268aff3e74aa879c4dfc12ab2b2c761ed583f433bddc63905c7260ef`;
test hash `04a6c9cf2259895bca137fc4e7bbdebf40f4bd91eb284e5190939934a09bfe7e`.

### Refresh-diff final custody/type corrections

Bounded source outcomes are now bound to the pinned v1 source ledger before
proposal recomputation: each source key maps to its exact ledger URL, and every
successful terminal resource must repeat that canonical URI. This closes the
case where a re-sealed outcome/manifest could relabel a URI without changing
the proposal body. The reader's explicit safe leaf allowlist now includes the
already manifest-verified baseline `source-ledger.json`; it remains limited to
proposal, outcomes, manifest, and ledger leaves.

Focused diff test — exit 0, 6/6. It now re-seals a malicious outcome URI and
manifest to demonstrate the new pinned-ledger binding rejection. CLI typecheck
— exit 0. Current hashes: diff
`9b70d83c1e5a6545684aa2f9bf2eb316705a9af3e1de66b521c0fe7e35b4aefc`;
test `2dc4ff11f31c7a7e31857a4d65c6a9543c29c0f5c582e5f0f8ee7c04f5e7ac53`.

Correction: the immediately preceding hash line was recorded from a stale
scratch value. The actual SHA-256 values after the final URI binding/type fix
are diff `108c10258a91a5c8df41206f28dad81351d9cb5deaa85717839b300ce66b2a76`
and test `1001181c81ee261af59ae5ff374db881aabfd7764843a04ddc1405c98f95dd03`.

### PDF compact capture terminal contract prerequisite

Inspected native parser admission before changing the read DTO. Native HTML is
exactly one `html_dom` projection at ordinal 0. Native PDF is exactly two
projections in order: `pdf_text` ordinal 0 and `geometry` ordinal 1. Both PDF
receipts reuse the one native parser-output artifact; each has its own
projection and transformation artifacts. `SourceKindSchema` already includes
`pdf`. Current capture-source application admission remains HTML-only, so this
contract change does not imply that public PDF acquisition is enabled.

Updated only contracts `verification/capture-reads.ts` and its test. Acquired
terminal resources now accept the exact HTML or PDF shape, enforce web-page
`text/html` versus PDF `application/pdf`, full capture/source equality, the
exact PDF cardinality/order/shared-native rule, and distinct remaining role
IDs. Registered capture remains HTML-only. Focused contract test — exit 0,
5/5; contracts typecheck — exit 0. Hashes: source
`5e8ed72cef35a849ef3b56d96b956ade3b8d431bebb6b1fa69cccd489b2bfe80`; test `24dee18ab98baf878983537fe4c1d60d9eb083ff59d385fd5353174032c12f14`.

### PDF capture-read application and persistence custody

Updated only the application and persistence capture-read layers for the
contract's acquired PDF terminal shape. Both validate the ordered
pdf_text/geometry pair, exact source/capture bindings, one shared native
output, and a first-seen deduplicated closure in the precise order
receipt/source/native/text/transformation/geometry/transformation. Every PDF
transformation has its own exact three-parent vector. Persistence rehydrates
and compares both admitted projections before the terminal snapshot recheck.
Registered reads remain HTML-only; neither layer enables a capture route.

Focused application capture-read test — exit 0, 5/5. Focused persistence
capture-read test — exit 0, 6/6, including successful two-projection hydration
and independent projection IDs. Application and persistence typechecks — exit
0. An application build refreshed the typed receipt schema dependency before
the persistence test; no provider, database, or executor call was made.
Hashes: application $app; application test $appTest; persistence
$persist; persistence test $persistTest.

### PDF read request and compact parser identity hardening

Both readers now require equest.requestedProjectionKinds to equal the
actual admitted ordered projection list exactly. PDF additionally requires the
two compact receipts to agree on parser version, image digest, parser options
digest, parser transformation signature, and residuals digest, in addition to
the previously enforced full shared native-output handle. Focused application
coverage rejects a resealed wrong PDF order and compact parser drift;
persistence coverage rejects both before projection hydration.

Application build completed to refresh its typed dependency. Application test
5/5, persistence test 7/7, application typecheck and persistence typecheck all
exit 0. Hashes: application $app; application test $appTest; persistence
$persist; persistence test $persistTest.

### PDF compact contract parser-identity closure

The public compact capture terminal schema now independently requires PDF
pdf_text and geometry entries sharing native output to also agree on parser
version, image digest, parser options digest, parser transformation signature,
and residuals digest. The contract regression mutates parser options while
retaining the native artifact and is rejected. Focused contract test 5/5,
contracts build, and client build all exit 0. No application or persistence
build was run for this follow-up. Source $source; test $test.

### Next acceptance-gap prioritization (read-only)

The matrix remains 29 partial and 17 missing, with no complete rows
(`STATUS.md`). The most valuable local/no-provider next slices are:

1. **VR-043: executable assertion-to-fragment coverage audit.** Add a strict
application report-audit helper and CLI subcommand that scans the existing V5
report/claim/evidence ledgers, resolves every rendered factual assertion to one
registered case/evidence read and one local appendix anchor, and emits a sealed
coverage report with explicit unavailable records. Reuse
`packages/application/src/verification-diagnostics-adversarial.ts`, existing
report artifact manifests, and the authored case/evidence read services; do
not write facts or labels. Acceptance condition: every rendered factual
statement is either exact-linked or marked unavailable, with no orphan
anchors/fragment aliases; browser/local-file audit passes. Estimate 1–2
engineering days. This improves VR-043 directly and makes the existing
140-anchor V5 evidence inspectable as a reproducible gate.

2. **VR-041: run the mandatory adversarial transformations against the sealed
V5/offline replay path.** The mutation definitions and quality-gate ID already
exist (`verification-diagnostics-adversarial.ts`,
`verification-diagnostics-quality-gates.ts`), but the current demo truthfully
reports unavailable coverage. Compose a deterministic mutation runner from
immutable V5 inputs and retained replay outputs; emit per-transform original ↔
mutated verdict/selector/policy comparisons and fail quality only for measured
non-monotonic cases. Acceptance condition: name/algorithm/biomarker/count/
qualifier/citation mutations are all evaluated and retain artifacts; unsupported
arms remain unavailable, never pass. Estimate 2–3 days. No provider or human
gold is needed because this checks deterministic degradation, not quality.

3. **VR-045: close the local refresh/diff/replay lifecycle around the newly
implemented native proposal flow.** The native 16-source capture already
writes a proposal and installed diff validates it, but it stopped at 13
captures/3 unavailable and does not produce a candidate selector
revalidation/drift review artifact. Add a read-only candidate replay/audit
command over `proposal.json` that rehydrates successful capture projections,
checks historical case fragments only for drift/unavailability, and writes a
review-required drift ledger; it must not copy selectors, labels, or create v2.
Acceptance condition: all 16 outcomes, including unavailable PDF/HTML sources,
are retained; every historical evidence edge is classified changed/unchanged/
unavailable with exact handles; prior v1 bytes/results remain unchanged.
Estimate 2–4 days. This advances VR-045 without needing source success,
human approval, or cloud credentials.

Not prioritized: VR-020/021 need paired arms/human-gold/calibration; VR-013
requires semantic runtime/provider evidence; VR-038–040 need reviewed factual
coverage and authority work. No product files changed by this planning pass.

Correction for previous shell interpolation in this ledger: current hashes are
application `079f9c38c8ee96a2aea67c221b1c09cb7397bdd6574118c6f7c0a778b1976e1a`,
application test `1def3645e3de06cf9f8a5ea2424a20f257bd0c6e30e69e3506ead9bc088660ed`,
persistence `0bfb7e3ae96396f85a84a8960d9362bfcab8c493f3e40049edc6eb95ceb1cfb9`,
persistence test `9ec8af09bf0a6a468fe9fe1950653f54968c22b7c7e7a0d66737d2e0fd6b2e24`,
contract `e251de11d78ea35759ad1e377640f0f223ff1493726bd9f80680135ca21e12ca`,
and contract test `11602ffda70acd4b33c3c45567c2d7cab5ea53ef4a32551486ed591a55dbe7bc`.

### Report factual-prose / VR-043 audit (read-only)

Independent review recorded in `SW-07-REPORT-FACTUAL-PROSE-AUDIT-20260907.md`.
Against specification §15.9.4/15.9.6 and VR-043, the current generator only gives
exact case-assertion prose to `factual(caseId)`. Factual paraphrases remain in company
limitations and all comparison bullets, while audit measured verdicts, gate outcomes,
and semantic replay verdicts need canonical case/result/run blocks or explicit
operational-notice classification. The semantic replay verdict currently has no exact
appendix verdict entry. Existing local-file browser proof is
`internal/prove-offline-report-navigation-browser.ts`; it checks one unavailable
anchor then run-ledger navigation and rejects external requests. Reusable application
and installed-CLI boundaries are `packages/application/src/verification-benchmark.test.ts`
and `apps/cli/src/diagnostics-demo.test.ts`. No product source, test, browser, provider,
or runtime action was performed.

### Offline mini-report coverage harness and installed-output audit (partial)

Added root-level read-only harness
`C:\Users\Pinda\Proyectos\aiengineer\internal\audit-verification-offline-report-coverage.mjs`
(SHA-256 `da5db376ebe33426818599959af147446b2f2481da1a8f58299c0ece287d8a6f`).
It validates every manifest-listed file, rebuilds each canonical coverage object with
the built application auditor using frozen v1 plus `field-ledger.json`, compares all
three Markdown/JSON/HTML representations, follows every local factual anchor with
installed Playwright, compares case/capture/fragment/projection/transformation/selected
digest binding in the appendix, and requires the run-manifest backlink. It accepts only
`--output-dir`, starts no server, rejects non-`file:` browser requests, and writes a
receipt only after all checks pass.

Executed `node --check` successfully, then ran it against root's installed offline
artifact `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-installed-offline-demo-abf14ad4-1cfd-451e-abfc-a71430054e26`.
The audit stopped before receipt with the concrete fail-closed finding
`OFFLINE_REPORT_COVERAGE_AUDIT_APPENDIX_BINDING_INVALID`: report coverage preserves
`projectionDigest`, while `evidence-appendix.json` and its HTML omit it. Confirmed on
`tru-sample-source`; no product source or artifact was changed. Core must expose the
existing compact digest in the appendix before this exact custody/navigation proof can
pass. The factual report counts (11 TruDiagnostic, 9 Generation Lab, 9 comparison) are
encoded as strict harness expectations but were not reached after the first binding
failure. No provider, network, DB, or server action occurred.

### VR-043 installed mini-report coverage proof (successor r2)

Root corrected the previously identified appendix omission by retaining compact
`projectionDigest` in JSON and HTML. The tightened independent harness now has SHA-256
`a4e1f7fabd4fc808ec0eeaddfe5e94bc77772fa4f607c857ce44ea9f955fec0d` and passed
against `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-installed-offline-demo-3d2b5f0a-e6bd-4a9e-97ca-f81736f06604`.
Receipt: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-offline-report-coverage-audit-bb18478f-1e47-4bde-a024-f956c12f3715.json`,
SHA-256 `3bc02a56505d941e339e3e6d3f46624d33e33ecc988358f6eddbf20b4be0c678`.

The harness loaded the sealed frozen v1 catalog through
`loadDiagnosticsOfflineCatalog`, rebuilt each report with
`auditDiagnosticsReportCoverage`, and checked all 24 manifest-listed artifacts plus
`manifest.json` (25 output files total). It verified canonical `fileManifestDigest`,
canonical bundle digest, exact bundle-to-manifest ordered file list, the three
coverage-report JSON copies, Markdown UTF-16 span content, and rendered HTML `<pre>`
content. It then used installed Playwright with an abort-before-navigation route for
all non-file schemes to click every factual link: 11 TruDiagnostic, 9 Generation Lab,
and 9 comparison assertions. For every link it verified case assertion, capture,
fragment, projection ID/digest, transformation ID, selected digest, exact resolved DOM
text/digest (or explicit unavailable state), clicked the `#run-manifest` backlink and
returned to its report, then clicked the final run-ledger link and confirmed the
manifest identity. Requests were only `file:`. No provider, network, database, server,
or product mutation occurred.

Acceptance assessment: the narrowly worded VR-043 is now **proved for the installed
frozen v1 offline artifact**, rather than merely missing: all rendered mini-report
factual blocks are canonical exact assertions with an inspected local
assertion-to-fragment-to-run-manifest path. This does **not** prove the broader
§15.9.4 semantic/report-quality requirements: the coverage object deliberately marks
semantic verification incomplete and human-gold ineligible, so it supplies no claim
that the source assertions are independently corroborated, complete, or admitted.
The original first-output failure remains retained evidence of the fixed
projection-digest gap.

### Paired Luna/Terra semantic feasibility (read-only)

Recorded `SW-07-PAIRED-SEMANTIC-FEASIBILITY-20260907.md`. D-014 authorizes a
USD-25 isolated `cph-20260907` completion cohort while retaining all D-013 input,
privacy, serial-call, stop, and accounting bounds. The frozen v1
`derived-input-grant.json` binds 40 authorized derived inputs (all 20
original/mutated pairs), rather than only the previously exercised one-case fixture;
it lists Luna, Haiku, and Interfaze but **not Terra**. The worker supports Terra, so
a server-owned immutable Terra profile-grant bound to selected already-authorized v1
inputs is still required before a Luna/Terra call. The shortest genuine pair is two
claims operations for one exact `pairCluster`, each run through identical Luna and
Terra profiles (four bounded calls) in the existing isolated semantic launcher and
fixture path. It is same-provider comparison, not cross-family corroboration.

Frozen v1 includes biomarker mutations but has no name/company-name or institution
mutation family, so it cannot close VR-041's required family coverage. No product,
provider, database, storage, Temporal, browser, or network action occurred.

### All-v1 Luna semantic runner preparation (source-only)

Added a separate, unexecuted all-v1 Luna source path:
`scripts/prove-verification-diagnostics-v1-semantic-pairs.ts`,
`../internal/verification-diagnostics-v1-semantic-pairs-isolated.mjs`, and
`../internal/verification-diagnostics-v1-semantic-pairs-launch.mjs`.
The runner plans 40 distinct claims contexts across 20 exact pair clusters, binds each
case to the legacy D-013 v1 grant before worker startup, limits every operation to one
Luna call with a 5,000-microdollar reservation, runs only serially, has no quality
retries, stops after three consecutive failures, and retains typed terminals, signed
artifacts, provider attempts, observations, and captures for later fixture work.
The launcher's default is preflight; only explicit `run` can invoke its isolated child.
No run/preflight was invoked.

Focused static check passed:
`corepack pnpm exec tsc --noEmit --pretty false --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --skipLibCheck scripts/prove-verification-diagnostics-v1-semantic-pairs.ts` (exit 0).
`node --check` passed for both root-level `.mjs` wrappers. A direct `tsx -e` loader
probe did not run because package built exports were unavailable in the current source
state (`ERR_PACKAGE_PATH_NOT_EXPORTED`), so it did not contact a provider or local
runtime. It is a build-order limitation only; runner static compilation succeeds.

Important compatibility observation retained: current v1 and pilot-v3 case digests
all differ, and all 20 source assertions differ, although source fragments/captures
match. The runner uses the existing v1 D-013 grant and refuses silent v3 substitution;
a later v3 mapping must bind those assertion differences explicitly. The feasibility
note was corrected: v1's biomarker entries are count changes, not a biomarker-identity
swap, so names, institutions, and biomarker identity/list remain missing VR-041
families.

### All-v1 Luna semantic runner preparation r2 (source-only)

The runner now imports Mission Control's canonical
erificationDispatchIdempotencyKey directly from the mission-kernel source and uses
that d1:verifyClaims:tenant:mission:work-item:attempt key both in the operation UUID
binding and OperationContext; no local idempotency derivation remains. Before worker
startup or any provider-capable path it writes an exclusive prepared-plan journal with
all 40 case bindings, canonical request digests, exact blinded Gateway request digests,
V1 grant authority, public verification key, and frozen source hashes. The final proof
references that journal and retains the exporter-required publicKeyPem and
equestedCases[*].expectedSemanticRequestDigest fields. Assertion digest evidence now
uses SHA-256 of the actual assertion text, matching the benchmark case definition.

The semantic request preflight is reconstructed from the stored server-composed
assertion bundle with its actual assertion ID, proposition, qualifiers, entity bindings,
and selected fragment ID plus exact selected text. It enforces the D-013 2,000-character
bound on that actual blinded payload. Receipt completion is false/nonzero when any case
fails or is stopped; its artifacts remain available for review. No execution was
started.

Focused static check passed after these changes:
corepack pnpm exec tsc --noEmit --pretty false --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --skipLibCheck scripts/prove-verification-diagnostics-v1-semantic-pairs.ts (exit 0).
Current runner SHA-256: $h.

### Live paired semantic run: prepared-plan and history snapshot (read-only)

At the requested live snapshot, the exclusive prepared plan
$p (SHA-256 $h) was structurally sound: 40 distinct case IDs, 20 pair clusters,
40 distinct operation IDs, and 40 distinct canonical
d1:verifyClaims:tenant:mission:work-item:attempt keys. Every plan had both bounded
SHA-256 request fields and a public verification key; the plan retains seven frozen
source hashes. No runner, database, provider, or Temporal state was modified.

I decoded the 12 completed current-run Temporal histories available at the snapshot and
compared their decoded launch request and terminal result to the prepared plan by
canonical idempotency key. All 12 were erifyClaims; each matched its planned tenant,
request digest, operation UUID, and canonical key, and each had an 11-event completed
history with terminal state succeeded. The observed dispositions were
eview_required for source cases and quality_rejected for corresponding observed
mutations where applicable; neither is an admission claim. The active run was still in
progress, so this is not a 40-case completion or accounting audit.

### Planned CLI adoption of the verified 40-case semantic fixture (read-only map)

No code was changed while the live runner remained active. The installed demo currently
pins the one-case fixture digest
sha256:c63055da4dee19de98bfdaf8fafa7884fef6ae9f127964041b2dc4d97d561352
in exactly two packaging/runtime locations:

- pps/cli/scripts/copy-demo-assets.mjs lines 38–52 validates the fixture manifest,
  its canonical digest, each bounded rtifacts/<UUID>.bin entry, and copies that
  closure to dist/demo-assets/semantic/<digest>.
- pps/cli/src/diagnostics-demo.ts line 39 passes that same copied directory and
  expected digest to unDiagnosticsCompaniesDemo.

Once the independent exporter produces a pinned 40-entry fixture digest, replace those
paired constants together and add the new immutable directory below
catalog/verification-semantic-fixtures/<new-digest>/. No copy-path algorithm change
is needed: copy-demo-assets.mjs derives all artifact count/copies from the verified
manifest and already rejects traversal, altered bytes, and altered canonical manifest
material. It will therefore report the new closure count without a hard-coded asset
count.

packages/application/src/verification-diagnostics-semantic-replay.ts already loops
all ixture.entries, binds each entry to the frozen v1 case digest/input manifest,
re-admits its projection, validates retained deterministic and runtime-principal
binding, then replays captured semantic bytes with xternalRequests: 0. It needs no
multi-entry mechanism. Preserve the existing one-case fixture tests in
packages/application/src/verification-diagnostics-semantic-fixture.test.ts as
historical regression coverage; add a separate exact-40 fixture test only after the
exported digest is available.

Required changed tests/docs at adoption:

- pps/cli/src/diagnostics-demo.test.ts: update pinned digest, assert 40 replay
  results / 40 distinct v1 case IDs and zero external requests, retain the installed
  no-network guard, exit 2, unchanged generated 24-file inventory, and unchanged
  dmissionChanged: false.
- pps/cli/README.md: replace “one retained Luna assessment” with “40 retained Luna
  claims assessments”, while explicitly retaining that no report replay, four-arm
  provider comparison, human-gold score, quality admission, or new provider call is
  supplied.
- packages/application/src/verification-benchmark.ts: replace the current
  one-case/supplementary wording in the provider-arm, semantic-coverage, and audit
  report gate evidence with the actual replay count. Keep
  semantic_claim_report_coverage, provider-arm, deterministic full replay and other
  unavailable gates unavailable unless their own required evidence exists; the CLI must
  continue returning erification_incomplete/exit 2 and retaining review artifacts.

The generated report output remains 24 files because semantic-replay.json already
belongs to the inventory; the fixture’s internal artifact count may grow substantially
but must not be represented as output-file count. The existing incomplete cedad...
fixture remains historical and must not be overwritten or used as a fallback.

### All-v1 Luna semantic run r1: retained failure diagnosis (read-only)

The isolated execution completed all 40 serialized Luna calls with 15,801 settled
microdollars. Its original proof is retained at
C:\Users\Pinda\Proyectos\aiengineer\internal\verification-diagnostics-v1-semantic-pairs-18a74b72-068c-446c-9315-423b993c5689.json:
38 operations succeeded and signed their terminals; two reached provider response
capture/observation but ended operation_failed without an automatic retry:
gl-interested-comparison-mutated (6b84ae56-31ad-56e5-a14a-839ba1cfaf6b) and
gl-repeatability-mutated (2ca3b729-9d70-5b5e-aa5e-1103b621ad6d). The isolated
wrapper reports cleanup complete; the disposable database is absent.

Read-only inspection of both persisted Temporal histories and their retained raw
response artifacts found a real judge-output consistency failure, rather than an
allowed-disposition guard or malformed Gateway response. Each was HTTP 200, model
openai/gpt-5.6-luna, valid JSON-schema output, and accepted by the gateway response
interpreter. Each nevertheless emitted 
ot_supported / 
eutral while listing a
supporting fragment ID. The ID and assertion binding were exact, but
alidateOutput correctly rejects that combination as
JUDGE_UNSUPPORTED_FRAGMENT_FIELDS_CONTRADICT: unsupported verdicts may not cite a
supporting or contradicting fragment. This is retained as an actual failed semantic
outcome; it was not repaired, retried, resealed, or substituted.

Independent recovery receipt:
C:\Users\Pinda\Proyectos\aiengineer\internal\verification-diagnostics-v1-semantic-pairs-recovery-0cd0665b-68ac-4a9c-9cb6-15bb66fb42a8.json, SHA-256
c6d7a22fd58de2f4bf8f1ec7ef13e10323a39aa0ce7ac9ae8db9134dfc0c60ec.
It references two separately exported 11-event Temporal histories and the original
helper failure journals without copying private raw provider responses. No provider,
database, runner, or source mutation occurred during diagnosis.

Correction to the earlier fixture-adoption map: EV131's current installed output has
**26**, not 24, output files. Future CLI tests must preserve the current verified
inventory/count rather than a stale hard-coded count; a 38-success/2-unavailable
fixture must assert that exact coverage and explicit missing case IDs, not claim 40
successful semantic replays.

### CLI offline semantic fixture adoption (38 replayable / 2 unavailable)

Updated only pps/cli/** to pin and package immutable semantic fixture
sha256:768721ef0648e5ca6beddf5606ee533dac40c194c081af159d4738513b95f058.
The copy script still verifies the fixture's canonical manifest and every bounded
artifact before copying; this fixture contains 498 retained artifact objects and 38
replay entries. The installed demo passes that same exact directory/digest to the
application, preserving offline operation and zero provider dispatches.

The CLI installed-run test now verifies 38 distinct replayed cases, explicitly excludes
gl-interested-comparison-mutated and gl-repeatability-mutated, verifies each replay
has zero external requests and retained artifacts, and inspects the generated 20
original/mutated semantic pair records for those two null mutated assessments. It
asserts the current EV131 output inventory of 26 files and retains exit 2 / unavailable
quality gate / dmissionChanged: false. Existing application one-case fixture tests
were not changed. README wording now accurately describes 38 retained claims
assessments, two unavailable failed-output cases, no new calls, and remaining report,
provider-arm, human-gold, and admission gaps.

Validation: corepack pnpm --filter @aiengineer/knowledge-cli build exit 0 (copied 8
catalog files, 82 preparation artifacts, 498 semantic artifacts);
corepack pnpm --filter @aiengineer/knowledge-cli typecheck exit 0;
corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run
src/diagnostics-demo.test.ts exit 0 (1 file, 7 tests). A package-level CLI test run
also passed 9 files / 43 tests.

### VR-042 independent acceptance review

Wrote SW-07-VR-042-INDEPENDENT-REVIEW-20260908.md after a read-only audit of the
installed semantic-cohort CLI output. All 25 manifest entries matched exact SHA-256 and
byte length; the directory has 26 files including the manifest. The exact CLI exited 2
with `verification_incomplete`, which preserves reviewable output. Final recommendation:
retain VR-042 as **partial**, not proved. The artifact-inventory subclaim is evidenced:
one offline command generated the four named report families plus machine ledgers and a
manifest. But §15.9.5 defines that command as also running extraction and claim/report
verification, adversarial mutations, and deterministic replay. The current result has no
evidence for those required execution paths; the ten unavailable gates corroborate that
specific gap. This conclusion does not impose an arbitrary all-13-gates threshold.
No product code, provider, database, or runtime was changed.

### Cursor verification skills — current CLI surface

Updated only the six Mission Control Cursor verification skills and their skill-support
catalog/credential-free command fixtures to match the currently implemented KS CLI.
`verify-report` and `verify-source-attribution` now use the public typed
`verify report-result` and `verify claims-result` reads after operation status;
`verify-extraction` uses `extraction show`; and `adjudicate-verification` now documents
admitted `adjudication request` and `adjudication get`, while explicitly retaining a
pending subject as neither human decision nor admission change. Replay and benchmark
instructions remain bounded to their actual admitted retained-input commands. The shared
boundary now applies `verificationContractVersion` only to mutation bodies and uses
compact references, without copying algorithms or granting human authority.

Validation: `node internal/verification-cursor-skills-review.mjs` exit 0. It ran six
credential-free installed-CLI resolution checks and parsed all six example bodies with
the current strict contracts, including adjudication. New immutable receipt:
`internal/verification-cursor-skills-review-20260908.json`, SHA-256
`8d803b51e218c878b1af595dbb9ac5ddaba19182e7193662b36733088a9f7531`. This is not a
Cursor-agent or configured-endpoint acceptance run; it made zero network/provider calls
and read no terminal resource.

### Cursor agent report fixture

Added `scripts/verification-agent-report-fixture.ts` and its focused test. The pure host
fixture accepts the existing trusted semantic-fixture identifiers plus actual agent-authored
Markdown and one assertion span. Before any admission or repository call it limits the
report to 3,000 UTF-16 code units, verifies exact UTF-16 span boundaries and text, permits
only the exact frozen v1 case assertion or its public excerpt, and binds exactly one frozen
capture/projection/transformation/evidence fragment. The caller remains the source of
all tenant, mission, attempt, and producer/verifier deployment values; no model-supplied
context, selector, or authority is accepted. On valid input it registers only
`report_markdown` and `verification_report_ledger`, records the assertion, and returns
the report verification request, projection grant, bundle, report/ledger handles, and
resolved evidence text. It does not parse, execute a provider, or create orchestration rows.

Validation: `corepack pnpm exec vitest run scripts/verification-agent-report-fixture.test.ts`
exit 0 (3 focused tests), including wrong range and wrong assertion identity before any
repository write; `corepack pnpm exec tsc --noEmit --target ES2024 --module NodeNext
--moduleResolution NodeNext --strict --skipLibCheck scripts/verification-agent-report-fixture.ts`
exit 0. No native fixture, network, provider, or database call was made.

### Cursor report-only native proof preparation

Added `scripts/prove-verification-cursor-report.ts` and
`internal/verification-cursor-report-isolated.mjs`, derived from the retained semantic
Mission Control proof without changing it. The child requires an absolute
`VERIFICATION_CURSOR_REPORT_INPUT` JSON path containing actual report Markdown, one
UTF-16 assertion span, and bounded host `producerAgentId`/`producerRunId`. It loads the
exact v1 `tru-symphony-source` grant, dispatches only `verifyReport` through the native
MC Temporal helper, and configures one Luna semantic call with a 100,000-micro ceiling,
100,000-micro reservation, 900 completion-token limit, and no retry. It retains startup,
prepared, success/failure, typed terminal, history, signed-artifact, and provider-custody
references. The wrapper creates and destroys only an absent local
`verification_cursor_report_*` clone, forwards the agent-input path and only an already
provided gateway key, journals accounting even if the child fails, and prints a receipt
path. Preparation only: no server, database clone, Temporal workflow, or provider call
was started.

Validation: standalone strict TypeScript check of the child and `node --check` of the
wrapper both exit 0. Native execution remains unaccepted pending root review.


### Cursor SDK report harness pre-execution review

Read-only review of `internal/verification-cursor-report-sdk.mjs`, installed Cursor SDK
1.0.31 type declarations, and prepared receipt
`internal/verification-cursor-report-sdk-4746a7b7-4ffc-42d6-9eeb-587d2abaea79/receipt.json`.
The custom-tool configuration is compatible with the installed SDK: `local.customTools`,
`tools: ['mcp']`, per-send `onStep` and idempotency key, and disabled agent retries are
all declared supported APIs. The receipt records preparation only.

Blocking execution-bound gap reported to the coordinator: the 240-second timer starts
only after `await agent.send(...)`; the custom tool then awaits the native child wrapper
without a deadline or abort/termination link. Cancelling the SDK run is neither awaited
nor propagated to that child, so a stalled send or child can outlive the declared bound
and potentially continue toward the one provider call. The callback also depends on a
`run` variable assigned after `await agent.send`; installed type declarations do not
promise callback ordering. An absolute timer before send and child cancellation/receipt
handling are required before treating the harness as bounded.

### Cursor report proof deadline propagation

Updated only the isolated wrapper and report-proof child after the pre-execution review.
`VERIFICATION_CURSOR_REPORT_DEADLINE_MS` is now a mandatory 13-digit absolute UTC epoch
millisecond value. The wrapper rejects an expired deadline before cloning, forwards it to
the child, requires more than 120 seconds before native spawn, and applies
`min(remaining deadline, 120 seconds)` to every owned subprocess. On timeout it kills
only that subprocess and waits for its close event before its existing disposable-database
cleanup. The child revalidates the same deadline and refuses to start its worker unless at
least 60 seconds remain; the existing Mission Control helper still supplies its own bounded
workflow timers. This is a cleanup grace mechanism, not a hard wall-clock guarantee.

Static validation: `node --check internal/verification-cursor-report-isolated.mjs` exit 0;
`corepack pnpm exec tsc --noEmit --target ES2024 --module NodeNext --moduleResolution
NodeNext --strict --skipLibCheck scripts/prove-verification-cursor-report.ts` exit 0. No
server, database clone, Temporal workflow, Cursor agent, or provider call was made.

### Cursor report proof independent auditor preparation

Added `internal/audit-verification-cursor-report.mjs` while the root-owned SDK run is
active; it is not executed yet. The auditor requires a completed SDK receipt and checks
host report-input bytes, agent/run identity, report Artifact bytes, a single native
operation/provider attempt bounded to 5,000 micros, signed terminal manifest and public
key verification, retained CAS report/manifest hashes, source snapshots, isolation cleanup,
and SDK event/tool-result disposition parity. It writes only a new local audit receipt.

Validation: `node --check internal/audit-verification-cursor-report.mjs` exit 0. No
provider, Cursor SDK, Temporal, database, or Storage operation was started.

### Cursor report pre-provider failure diagnostics repair

The first SDK run is retained as failed: its recovered Temporal history records one
`verifyReport` operation `bdc41367-db96-568b-a633-ba12c2554adc` with state `failed`,
disposition `operation_failed`, and receipt ID `70fb91b9-793c-45dd-b131-9409b27c0755`.
The isolation cleanup completed and the SDK accounting remained 53 attempts / 19,978
micros, so no Gateway call occurred. The original v1 child failure receipt only retained
the wrapper assertion `SEMANTIC_DISPOSITION_REQUIRED`; its disposable database was
already removed, so it cannot establish the underlying KS error retrospectively.

Updated the child failure receipt to v2 before the authorized repair attempt. For every
created operation it now records only compact terminal diagnostics: operation state/kind,
request hash, ownership/external-run binding, step state/input hash/attempt count, receipt
IDs and input/output hashes, and event type/sequence. It emits a sanitized one-line
failure log and prints the failure receipt path as structured stdout, allowing the wrapper
receipt to retain it through its existing `childReceiptPaths` extraction. No raw request,
provider output, key, or lease token is recorded.

Validation: strict standalone TypeScript check of
`scripts/prove-verification-cursor-report.ts` exit 0; `node --check`
`internal/verification-cursor-report-isolated.mjs` exit 0. No rerun, database, Temporal,
Cursor, or provider action was performed.

### Cursor report auditor repair mode

Extended the new independent auditor with an explicit `--repair` mode:
`node internal/audit-verification-cursor-report.mjs --repair <original-sdk-receipt>
<repair-receipt> [audit-output]`. It requires the original SDK receipt to remain failed,
requires the repair receipt to declare zero new Cursor generation calls and bind the same
host agent/run/report bytes, derives the fresh native proof through the repair isolation
receipt, and never compares the repair terminal to a nonexistent original SDK success.
It also normalizes the native `sha256:` prefix only at the report-byte comparison boundary.

Validation: `node --check internal/audit-verification-cursor-report.mjs` exit 0. The
repair wrapper is root-owned and running; no runtime action was taken by this task.

### VR-013 capability audit — 2026-09-08

Read-only SW-07 audit written to `SW-07-VR013-CAPABILITY-AUDIT-20260908.md`.
The acceptance row remains `missing`. Source and focused tests establish bounded
in-process semantics: opaque runtime admission, mechanical gate precedence, blinded
fragment-only input, empty adapter tool catalogs, fixed Gateway model/request bounds,
and no `tools`/`tool_choice` in the injected provider request. The focused rerun
passed 3 files / 21 tests with no provider call.

EV-120/EV-121 provide separate actual-request evidence: local Temporal -> KS HTTP ->
configured worker -> real Luna, with native attempt/capture/observation and signed
terminal custody. They do not inspect the effective runtime tool catalog or exercise
prohibited-tool/prompt-injection behavior. The minimal remaining VR-013 proof is one
independent credential-free runtime capability inspection and prohibited-tool eval,
including isolation of Eve's `list_research_records` extension and source/provider
metadata injection fixtures. No implementation or acceptance status was changed.

### Cursor report repair diagnostic result

The third no-Cursor repair attempt retained the causal native receipt. The report operation
failed before any provider dispatch with nonretryable
`SEMANTIC_PROFILE_IDENTITY_MISMATCH` at `verify_report_and_register`; its receipt and
compact operation/step/event diagnostics are in
`internal/verification-cursor-report-3fc37cfb-872c-467b-b9b5-11f10b6d4a4f.failure.json`.
The repair receipt confirms zero new Cursor generations and no Gateway attempt.

Source inspection identifies the exact configuration mismatch: the child creates the
semantic profile artifact with deployment ID `cursor-report-luna-${namespace}`, but its
profile-grant identity uses `semantic-luna-${namespace}`. These must be the same
server-composed identity. No edit was made while the repair run was active.

### Cursor report repair status distinction

Root corrected the server-side semantic profile grant to reuse the already-declared profile
identity, eliminating the duplicate deployment-ID construction that caused the retained
mismatch. The next repair run is root-owned. The first SDK and the two subsequent repair
attempts remain evidence of harness/identity guards, not semantic quality outcomes: all
failed before provider dispatch, retained their failure receipts, and left Gateway
accounting unchanged. The independent auditor must use `--repair` only for a successful
fresh native terminal and must preserve `originalSdkPassed:false`.

### Cursor report repaired native proof independent audit

Executed the independent auditor in explicit repair mode against the retained failed SDK
receipt and successful native repair receipt. It passed and wrote
`internal/verification-cursor-report-sdk-ac643859-c4aa-42f4-ad27-f51820d988b7/cursor-report-independent-audit-ac643859-c4aa-42f4-ad27-f51820d988b7.json`
SHA-256 `6462d394b1c08d889420335d711c57c62ae6b938da72d2cdbfb4593e67502177`.

The audit verified exact host report bytes and agent/run identity, one repaired native
operation `32487d8e-a856-5d0d-a437-da1066b5a8a0`, `review_required` terminal state,
report artifact `d40966cc-d392-5e68-a199-8823d89999cc`, signed manifest
`75d66f1d-dfba-5bb8-aee2-2c54d61d6512`, verified Ed25519 manifest signature, all retained
source snapshots, and successful isolated database/dump cleanup. Provider custody is one
attempt/observation/capture, 5,000-micro reservation, and 331 actual micros. The audit
also establishes that the original SDK receipt remains failed and the repair made zero new
Cursor generation calls. It performed only two local Storage reads and wrote its audit
receipt; no provider, database, Temporal, or Cursor SDK call occurred.

### EV-134 Eve loopback independent audit — 2026-09-08

Read-only audit written to `SW-07-VR024-EVE-LOOPBACK-INDEPENDENT-AUDIT-20260908.md`.
Reviewed receipt `internal/verification-eve-ks-loopback-fixture-20260908-r19.json`
(SHA-256 `e3080b1874f7dff100a9ed0cfbb2932af791994fca0ed526d575590b8a8e49b2`). The
retained proof reports a successful actual Eve build/eval process with exactly one
authenticated POST to `/v1/verification/claims:verify` and one authenticated GET to
the pregranted claims operation, including Eve external-runtime and stable idempotency
headers. The active fixture uses `mockModel` and its own canned loopback HTTP server.

The receipt has no source manifest; this audit independently records the runner and
active agent/runtime/tool source hashes. Its explicit limitations are decisive: no KS
application, worker, PostgreSQL, Storage, Mission Control, persistence, provider, or
live model ran. Recommendation is VR-024 `partial` only, never `proved`. Remaining
native gap: real authenticated KS HTTP/worker operation identity, same-deployment and
corrupted-locator denials, cancellation/retry against durable state, and a separately
labelled live-model run. Matrix was not edited.

### Eve verification lineage bridge — initial additive source

Added the canonical DB-contract migration
`20260908010000_eve_verification_binding.sql` and persistence export
`resolveEveVerificationBinding(database,envelope)`. The migration defines tenant-scoped,
immutable first-binding and append-only invocation ledgers, retains the full public signed
envelope and canonical envelope hash, stores issuer/key/JTI metadata, uses global
issuer/JTI replay prevention, and grants only `control_plane` tenant-RLS insert/select
access. The resolver reparses the strict envelope, serializes first claim by a tenant and
idempotency advisory transaction lock, checks canonical mission/work/attempt/deployment
and populated session/turn corroboration, freezes first lineage, idempotently accepts an
exact same-JTI retransmission, rejects changed JTI/lineage/binding data, and returns only
the original external execution.

Focused persistence typecheck: `corepack pnpm exec tsc --noEmit` exit 0. Migration has
not been applied and no DB/native/provider operation was performed. Pending: focused
repository tests, canonical migration preflight/local application, type generation and
0.2.36 package pin coordination.

### Eve verification lineage bridge — migration, generated contract, and focused checks (2026-09-08)

Applied `ai-engineer-db-contract/supabase/migrations/20260908010000_eve_verification_binding.sql` locally through the canonical migration command: migration count is 141. The additive migration creates immutable tenant-scoped first bindings and append-only signed-envelope invocations; it permits a new signed JTI for the same bound lineage as a retry, while the global `(issuer,jti)` uniqueness prevents altered retransmission. The attempted test writes are contained in `supabase/tests/eve_verification_binding.sql` within `BEGIN … ROLLBACK`; it seeded a minimal owned mission/work/session/attempt chain and passed 5/5 checks (first binding, full-envelope retention, same-lineage retry, immutable binding, issuer/JTI collision).

Generated canonical native types were refreshed and checked at DB-contract `0.2.36`; persistence now consumes the packed `aiengineer-database-contract-0.2.36.tgz` and queries `Database["knowledge_service"]` Eve binding/invocation row types rather than handwritten row records. Focused persistence bridge tests passed 2/2, persistence typecheck/build passed, and DB-contract `types:check:native` plus TypeScript typecheck passed. No provider call occurred. Native end-to-end HTTP/ownership admission remains for the root-owned isolated proof.

### Eve bridge isolated native repository concurrency test (2026-09-08)

Added and ran `internal/verification-eve-binding-isolated-concurrency.mjs`. It clones only the current local schema into a UUID-named disposable database, seeds a minimal tenant-owned mission/work/session/attempt chain, and drops that database and schema dump in `finally`. Receipt: `internal/verification-eve-binding-concurrency-1dcff994-7c95-447b-819d-c6c7e26aba8a.json` (`passed:true`, cleanup confirmed). Two separate real `PostgresCanonicalRepository` connections concurrently made the first signed claim under one tenant/idempotency lock; the result was exactly one frozen binding and two invocations, with both callers returned the same original external execution. A new JTI with the same static grant/context was admitted as the append-only retry. Native controls rejected wrong tenant, attempt, deployment, populated session, turn, changed request digest, and changed full service principal identity. Provider calls: zero. This is repository/SQL custody evidence; the root-owned HTTP admission proof remains separate.

### Eve signed runtime bridge documentation (2026-09-08)

Updated the existing §21 integration specification and `EVE-INTEGRATION-PREPARATION.md` only. The documentation now describes server-owned `VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON`, matching ownership `eveRuntimeAuthority`, exact Eve grant `runtimeAttestation`, host-only `EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM`, stable correlation/idempotency, immutable first-lineage plus append-only signed invocations, and session/turn corroboration. It includes a public placeholder configuration shape, key rotation/revocation behavior, and links to the lineage design, rollback-only admission receipt, and isolated concurrency receipt. It explicitly states that the full Eve-to-worker sealed-result proof remains pending and changes no acceptance status.

### Eve bridge concurrency receipt correction (2026-09-08)

The earlier isolated receipt `verification-eve-binding-concurrency-1dcff994-7c95-447b-819d-c6c7e26aba8a.json` used schema-valid placeholder signatures and did not execute the claimed same-lineage third invocation. It is retained, but must not be read as cryptographic-attestation or retry evidence. The harness was corrected to create, parse, and verify real ephemeral Ed25519 Eve attestations through the shared runtime functions; it now executes and counts a third, newly signed same-lineage JTI retry and an exact retransmission. Corrected receipt `internal/verification-eve-binding-concurrency-288164b9-548b-44ea-aeae-b8d5d3145c9b.json` passed with post-race `1/2`, post-retry `1/3`, and post-retransmission `1/3` binding/invocation counts, zero provider calls, isolated cleanup, and unchanged source plus executed dist hashes before/after. The subprocess environment now contains only required OS variables and `PGPASSWORD`, rather than inheriting the full process environment.

### Dashboard retained adjudication terminal-read proof (2026-09-08)

Ran `scripts/prove-verification-dashboard-adjudication-read.ts` against the retained local adjudication subject. Receipt: `internal/verification-dashboard-adjudication-read-6a7d33f0-21fe-4d69-8c24-82c0514f7b57.json`. A real local Chrome session signed in to the Next dashboard, opened the pending-adjudication detail, and fetched the compact terminal resource through the dashboard trusted proxy, the configured Fastify API, and the configured KS native read service. It verified the exact operation ID, pending/no-decision/no-admission-change state, original outcome, reviewer/source/admission presentation, and absence of raw storage keys. All five checks passed; provider calls and mutations were both zero. The screenshot is retained beside the receipt. This is a retained read proof only: it does not launch a workflow, make a human decision, or establish coverage of every dashboard route. Earlier assertion-only failure receipts are retained separately and did not mutate state.

### Dashboard route/control boundary inventory (2026-09-08)

Added and ran the machine-readable static inventory `internal/audit-dashboard-route-inventory.mjs`. Receipt: `internal/verification-dashboard-route-inventory-61f150b2-c46a-49d7-b929-c059a0daa883.json` (15 rendered routes, 10 actual browser controls/fetches, and SHA-256 entries for the reviewed dashboard sources). It maps each page/control to the only supported server/API boundary, required signed-session and role/CSRF rules, and compact DTO projection. The inventory verifies that the dashboard sources have no direct Postgres/Supabase/persistence imports; all browser-to-service requests flow through the two authenticated Next catch-all proxies. It explicitly lists five allowlisted read endpoints that the present UI does not issue, rather than implying they are exercised.

Focused dashboard unit tests passed 35/35 and dashboard TypeScript typecheck passed. Existing native evidence is bound in the receipt: EV-122 retained claims/report lifecycle/navigation and the new real retained adjudication terminal read `verification-dashboard-adjudication-read-6a7d33f0-21fe-4d69-8c24-82c0514f7b57.json`; no provider was rerun. A process check found no owned Next/API proof process left running. This closes the bounded route/control inventory review, not deployment/Cloud authority, human decisions, promotion, or every supported upstream capability.

### VR-013 bounded Eve capability and prompt-injection proofs (2026-09-08)

Executed `internal/prove-verification-eve-prohibited-tools.mjs`: actual Eve info/catalog returned only `verify_evidence_bundle`; nine distinct synthetic prohibited tool requests generated zero real Eve action requests/results. Receipt `internal/verification-eve-prohibited-tools-ae8d7603-cf89-4c3d-ab55-e147bd8ea810.json` SHA-256 `df7d000de3eb1c0bd9beb66f0725b1839c7efcb413984614252d6b2c64f22663`. Executed `internal/prove-semantic-prompt-injection-boundary.mjs` against installed Gateway semantic adapter: fixed untrusted-data system instruction, JSON-only injected source, no tools/tool_choice, empty adapter catalog, and no provider-metadata-injection projection. Receipt `internal/verification-semantic-prompt-injection-boundary-802c81a4-ca82-4497-b0fc-bfa5ad0be35e.json` SHA-256 `e3098b8e344525a7dd4b9437232fc1e33154bb2937b8bfd48cb625f04d32442b`. Both runs have zero provider network/KS calls; the mock model and injection content are explicitly synthetic. No acceptance promotion or semantic-quality claim is made.

### SW-06 CPH HTTP bridge independent loopback review (2026-09-08)

Reviewed and repaired `internal/verification-cph-http-bridge.mjs` against the D-017 proposal and Mission Control's actual verification-execution HTTP routes. The repair adds exact planned GET terminal-read support, expiry recheck after body read and before dispatch, literal `127.0.0.1` upstream-only enforcement, fixed-header/bearer-isolation checks, strict upstream JSON media validation, and bounded request/header timing. The loopback-only suite passed. Independent receipt: `internal/verification-cph-http-bridge-independent-review-20260908.json`; full bounded review: `SW-06-CPH-HTTP-BRIDGE-INDEPENDENT-REVIEW-20260908.md`. No tunnel, Cloud workflow, external network request, or credential output occurred. D-017 remains proposed and unaccepted.

### SW-06 CPH HTTP bridge R2 final hardening (2026-09-08)

The earlier independent CPH review receipt is retained as superseded preparation. R2 removed request-target normalization from the bridge policy: configured and raw request paths are canonical and aliases using dot segments, percent encodings, backslashes, fragments, queries, repeated slashes, or absolute-form targets are denied before dispatch. The request reader now settles on aborted/error and pauses oversized bodies; constructor validation now rejects short bearer values, non-integer listener ports, unsafe or case-duplicate fixed headers; exact media parsing permits only `application/json` or `application/problem+json`. The expanded loopback suite passed. R2 receipt: `internal/verification-cph-http-bridge-independent-review-20260908-r2.json` SHA-256 `1df464c62d29d1f327f3cb722d8d22e7bf5a9ddbbab22b860363ebd1d4be6944`. No tunnel, external request, Cloud workflow, or credential output occurred; D-017 remains proposed and unaccepted.

### VR-046 frozen acquisition policy/source-manifest closure (2026-09-08)

Added a fail-closed runtime request shape check to TrustedVerificationSourceAcquirer: only server-selected sourceKey and cancellation signal are accepted. Caller-provided authentication references, authorization headers, form fields, terms acceptance, and POST method controls now fail as SOURCE_ACQUISITION_REQUEST_INVALID before catalog lookup or transport. Focused application test passes 5/5 and application typecheck passes. The independent local auditor cross-binds §15.9.1, the 16-entry frozen v1 source ledger, source-capture notes, acquirer source, and test. It confirms the anonymous tru-sample-report is the only sample-report ledger source; Generation Lab sample-report links are documented as form-gated and absent, with no submitted form or bypass. Receipt `../internal/verification-acquisition-policy-vr046-da5a20ba-0227-45c1-a3ab-075fc8df8254.json` SHA-256 `3557b5a6b41c33797b92d1e92a3007e0fba54c082dfb3f7ba1394317288591ff` has eight passing checks and zero acquisition-network/user/provider/persisted-capture actions. Review SW-07-VR046-ACQUISITION-POLICY-REVIEW-20260908.md; status/matrix deliberately unchanged pending coordinator decision.

### VR-002 / VR-004 retained-native independent review (2026-09-08)

Independent machine audit `internal/verification-vr002-vr004-independent-audit-a64c59e1-333c-47f9-a58e-8ee552845ece.json` passed, SHA-256 `992cb1ae1b7191ccd066a8cbcc75ff6a22e90b35b29ad04e2c82ac4f7abecacb`. It binds the EV137 native deterministic `LOCATOR_UNIQUE` failure and zero semantic-provider custody to the retained policy-boundary replay: two synthetic semantic reversals remain `fail`, four attempted outcome reversals reject `POLICY_OVERRIDE_FAIL_CLOSED`, and no override is persisted. It also binds EV136 to the retained capture replay: 22 loopback CAS reads, 14 artifact replays, native projection re-admission, semantic and policy replay, and six digest/length/registration tamper rejections. The original replay source snapshot was verified because later builds changed live dist. The review recommends VR-002 and VR-004 as proved for their exact matrix boundaries only; it does not promote VR-035, semantic quality, human review, or Cloud scope. See `SW-07-VR002-VR004-INDEPENDENT-REVIEW-20260908.md`.

### VR-044 generated-report safety boundary (2026-09-08)

The earlier VR044 receipt is retained as pre-correction preparation. Superseding receipt `internal/verification-vr044-report-safety-audit-99025576-3126-4aa6-8c5b-ec1b8667dc17.json` passed, SHA-256 `2f52e5911fde13dc9329e340261d7b74b5c53518b265601faab9a3acacdc143b`. It binds all three EV130 retained report triplets (Markdown, HTML, coverage JSON) to their recorded hashes, verifies the fixed informational/non-recommendation qualification in each representation, and verifies the Generation Lab medical-practice, clinician-consultation, and informational/warranty qualifications. It found no rendered adversarial assertion or patient-directed treatment imperative in those exact bytes.

The review added a report-plan safety policy: each public report requires `informational_only`, accepts only literal source statements, rejects adversarial blocks, and rejects bounded direct patient-directed treatment imperatives in matching-digest resolved text before it is rendered. Focused report-coverage tests pass 6/6 and application typecheck passes, including a harmless assertion paired with an unsafe resolved fragment. The imperative check is intentionally bounded: a literal “For patient Jane Doe, discontinue insulin immediately” statement is outside that grammar, so it is not claimed as a semantic safety classifier. The exact frozen-report conclusion relies on manual inspection of all 29 factual statements plus catalog/EV130 integrity, literal-only structure, and required qualifications. Review `SW-07-VR044-REPORT-SAFETY-REVIEW-20260908.md` recommends VR-044 proved only for its report-output row, with no clinical, provider, human-label, or broader-product safety claim.

After the literal resolved-text change, the application was rebuilt only with installed `tsup.cmd` and `tsc.cmd`; focused report coverage remained 6/6. Parity receipt `internal/verification-vr044-frozen-report-parity-6ed0b4a1-0b14-44bd-916f-75a99b549f52.json` SHA-256 `ff5b0a05093873e59b36f753ca36d507b93eae793bfc679cf4d897d6a13df7b9` reconstructs the three reports from the current frozen v1 catalog and retained field-ledger resolutions. All 29 assertion blocks, rendered Markdown, and report digests exactly match EV130. No offline report output was regenerated or replaced.

### VR-005 / VR-009 supported-operation inventory (2026-09-08)

Machine audit `internal/verification-vr005-vr009-supported-operation-audit-d62dc1ec-2973-443a-9092-78a06e750d34.json` passed, SHA-256 `f9d8eb7fe403ee815b78884f5ffbf551ac91ea8b67bb505fa559dda5ef911ee3`. It records the exact 11 field comparison kinds, six exact-decimal computation operations, and three period semantics. Focused contracts passed 12/12 and verification tests 38/38. The bounded retained native replay contributes 22 read-only CAS reads, 14 artifact replays, and projection re-admission with no provider or write.

Two genuine omissions were corrected: a display excerpt has an explicit contract regression proving it cannot substitute for a selector, and cumulative period/end-facet plus normalized-text/percentage/enum operations now have direct regressions. Runtime checks cover selector ambiguity, ellipsis and offset drift, HTML fallback disagreement, numeric/unit/date/identifier/checksum checks, exact decimal computation, source-bound metric facets, and invalid operand graphs. `SW-07-VR005-VR009-SUPPORTED-OPERATIONS-REVIEW-20260908.md` deliberately recommends no matrix change: this is not all VR-006 modalities, VR-007 gold evidence, or an exhaustive “effectively 100%” operation coverage map.

### VR-005 / VR-009 exact-row closure (2026-09-08)

Superseding machine receipt `internal/verification-vr005-vr009-supported-operation-audit-b44e1cdf-77eb-45ed-83f8-c32b7bfae2e4.json` passed, SHA-256 `d843ecb31f41fa4f93f6538c18fe84fc5050153d80bf038859f668449b49effc`. It confirms no engine path treats optional `displayExcerpt` as a selector; the added contract adversary rejects excerpt-only fragments. With ambiguity, offset-drift, multi-fragment ellipsis, and fallback-disagreement regressions, VR-005 is recommended proved for its exact selector/display-excerpt row. VR-006 modality breadth is explicitly separate.

For VR-009, the receipt has an owner-defined exhaustive map for exactly 11 comparison kinds, six exact-decimal calculations, and three period semantics. Every entry has a named runtime positive and boundary-rejection fixture: 11/11 plus 11/11, 6/6 plus 6/6, and 3/3 plus 3/3 respectively. Added tests exercise remaining scalar failures, all calculation operations with changed-result rejection, point timezone presence, and cumulative end binding. Focused contracts passed 12/12 and verification passed 40/40. Recommend VR-009 proved only for this declared inventory; no claim extends to undeclared inputs, VR-006, or VR-007. No provider, capture, DB, or storage write occurred.

### VR-009 validator-specific negative correction (2026-09-08)

The prior `b44e1cdf` receipt is retained as a weaker preparation: its new scalar negatives could reject on source/candidate inequality, and its calculation negatives retained evidence for the original result. Superseding receipt `internal/verification-vr005-vr009-supported-operation-audit-1b58a16a-50c4-4f58-ac81-2ecb1b639f0a.json` passed, SHA-256 `6e32771f3d861325898cf40f0ba9e217a88b80252779918409d4ba45e4d253e4`. Scalar controls now use matching malformed/disallowed source and candidate values and assert their specific `FIELD_*_MATCH` failures. Each calculation negative regenerates representation bytes, digest, and evidence for the changed result and asserts `CROSS_FIELD_TOTAL_REPLAY` failure. Focused verification remains 40/40; no provider or write occurred.

### VR-009 validator-specific negative correction (2026-09-08)

The prior `b44e1cdf` receipt is retained as a weaker preparation: its new scalar negatives could reject on source/candidate inequality, and its calculation negatives retained evidence for the original result. Superseding receipt `internal/verification-vr005-vr009-supported-operation-audit-1b58a16a-50c4-4f58-ac81-2ecb1b639f0a.json` passed, SHA-256 `6e32771f3d861325898cf40f0ba9e217a88b80252779918409d4ba45e4d253e4`. Scalar controls now use matching malformed/disallowed source and candidate values and assert their specific `FIELD_*_MATCH` failures. Each calculation negative regenerates representation bytes, digest, and evidence for the changed result and asserts `CROSS_FIELD_TOTAL_REPLAY` failure. Focused verification remains 40/40; no provider or write occurred.

### VR-006 selector-family closure (2026-09-08)

Added the meaningful missing runtime fixture for the image pixel-coordinate branch: a bounding-box selector succeeds only with the projection's exact pixel dimensions and rejects changed dimensions. Focused contracts passed 11/11 and selector/deterministic verification passed 26/26. Independent family audit `internal/verification-vr006-selector-family-audit-c43dd6b5-d3b2-494b-9d15-bc8ac6295119.json` passed, SHA-256 `eeb5dac31ef7c1b719439c35e840feddffef48a68b14ab8248b9416fbafc4fc0`; it maps all nine matrix families to 12 admitted selector kinds with named positive and adversarial controls, and binds the retained 22-read/14-artifact native replay with zero provider/writes. Recommend VR-006 proved for the exact selector-family row. VR-007 accepted-leaf/gold scope is not claimed.

### VR-045 immutable refresh/diff closure (2026-09-08)

Audited EV128 and added the missing local v1 immutability fixture: `benchmark-version-diff.test.ts` snapshots every baseline manifest file before proposal write/diff and verifies byte-for-byte equality after; focused CLI tests pass 6/6. Receipt `internal/verification-vr045-refresh-immutability-audit-5e224c29-d8b4-4b4c-9a90-5aee2f2e0680.json` passed, SHA-256 `34ffc7c9f89b9d4fad5342d859fdaa879460ee039913a2449ec839059b80ea0c`. It binds EV128's 16 attempts, 13 captures, 3 unavailable, 78 artifact byte closure, exact proposal recomputation, and installed `refresh_proposal` diff with no frozen successor or approval. Recommend VR-045 proved only for immutable refresh proposal/diff; no v2 freeze, source/license/gold/leakage review, or all-source claim.

### VR-012 orthogonal judgment separation (2026-09-08)

Machine audit `internal/verification-vr012-orthogonal-judgments-audit-11873a35-bc3e-49b5-8b13-4190ff640915.json` passed, SHA-256 `52a4733ba1e10afceefb46bb0c7a4d0fae3a02f1c33af286572c4bd60b2526d9`. It binds strict contract fields for evidence support, world correctness, attribution faithfulness, source authority, and provenance integrity; policy’s distinct correctness/provenance gates and authority withholding; and the dashboard’s separate deterministic semantic, sealed policy, and source-authority summaries. Focused contracts passed 2/2, policy passed 10/10, and dashboard passed 35 tests across 10 files. Review `SW-07-VR012-ORTHOGONAL-JUDGMENTS-REVIEW-20260908.md` recommends VR-012 proved only as an architectural separation row. It makes no human-gold, calibration, real-world truth, provider, capture, database, or storage claim.

### VR-039 generated-report conflict visibility (2026-09-08)

Added one renderer fixture that requires the four known conflict statements to remain independently present: TruDiagnostic about-page 2–4-week versus product-page 3–4-week turnaround wording, and Generation Lab article-body 19-system versus footer 21-system wording. Focused application validation passed 12/12. Independent retained-output audit `internal/verification-vr039-conflict-visibility-audit-33202040-9104-4368-b38d-4198518ac4ea.json` passed and binds each rendered comparison block to its selected field-ledger text, capture/source context, and local appendix anchor; the two relevant blocks also remain in each company report. Review `SW-07-VR039-CONFLICT-VISIBILITY-REVIEW-20260908.md` recommends VR-039 proved only for visible preservation of the conflict set. It does not resolve either conflict, infer a product transition, or claim human-gold/policy authority. EV130 was read only and not regenerated.

Focused-validation supplement `internal/verification-vr039-focused-validation-supplement-fd28d372-e0d3-4a66-bc51-7b5a1ea26a3e.json` binds the existing 12/12 execution log (`internal/verification-vr039-focused-20260908.log`, SHA-256 `67e91b3275c734b8a0a0683e7e02e1d608d1ae94ddb781d97bf99d6e7e367c6f`) and exact renderer-fixture source bytes (SHA-256 `46344d7adc1ec2d42f2e35de36d05d8ab681a8cf12cc263306d4fb3d2ef93235`). No test was rerun for this supplement.

### VR-018 receipt-derived operation failure projection (2026-09-08)

The generic operation read had a real structural gap: `OperationStatus` exposed state and receipt IDs but omitted the canonical failed-receipt classification, so API/dashboard operation views could not distinguish provider, harness, quality, and policy failure categories. Added an optional compact `failure` summary sourced only from the latest canonical `receiptKind=failure`/`outcome=failed` receipt. It retains receipt ID, exact error class, retryability, and quality flag; an exact allowlist maps recognized classes, while an unknown class is deliberately exposed as `harness_failure` rather than inferred from message text. No raw receipt body, message, or user-controlled category is projected.

Machine receipt `internal/verification-vr018-operation-failure-summary-5e03cd60-9734-4f01-b727-0e8cff248412.json` passed. Focused persistence validation passed 5/5 and dashboard validation passed 37 tests across 10 files. Root-owned API parity remains pending, so this entry makes no VR-018 completion claim and records no provider call or shared build.

The attempted persistence typecheck reached only stale dependency state: the installed contracts declaration has not yet been rebuilt with the new `OperationFailureSummary` export. It failed at that missing export before checking changed persistence code. Ordered contracts rebuild followed by persistence typecheck/build remains required; no lockfile or package edit was made.

### VR-018 corrected execution failure / sealed policy separation (2026-09-08)

The preceding VR-018 entry and its preliminary receipt are retained, but its semantic execution-failure example was incorrect: `SEMANTIC_DISPOSITION_REQUIRED` is not emitted by production code. The corrected R2 receipt is `internal/verification-vr018-operation-failure-projection-r2-20260908.json`, SHA-256 `4496cb381af158ee71d85573d0bf497bfcd98e7cc073ceb11b5b2c65f6fc46e6`.

`OperationStatus.failure` now covers only terminal failed execution receipts, with exact recognized provider/policy/harness mappings and fail-closed unknown-code handling. Recovered successful operations omit stale failure data. Semantic quality and completed policy withholding remain a separate signed terminal projection: the read hydrates a registered policy-decision artifact, verifies canonical bytes/digest/run/policy/outcome/override binding, and returns either bounded canonical reason codes or an explicit unavailable marker for legacy sealed terminals. The dashboard refuses malformed failure or policy summaries and keeps the two states separate.

Focused checks passed: contracts 3/3, application 5/5 plus build/typecheck, persistence 10/10 plus build/typecheck, dashboard 37 plus typecheck, and API 9/9 across three files. API verifies three actual execution categories, recovery omission, completed signed-policy fail/review reason projection, unknown-reason rejection, and the OpenAPI shape. The HTTP fixture is not native signature evidence.

Read-only retained-native follow-up receipt `internal/verification-vr018-retained-policy-read-20260908.json` SHA-256 `b6d382010fe7f680130499eecebc3f5dbda41171e2b65ca1f49c87c993f5b382` ran the current repository/application reader against the existing signed claims/report proof. It verified claims `review` / `SOURCE_AUTHORITY_WITHHELD` and report `fail` / `MECHANICAL_BUNDLE_FAILURE`, `SOURCE_AUTHORITY_WITHHELD`, retained all 13 hostile custody controls, used default-transaction-read-only PostgreSQL, and made zero provider/parser dispatches. The R2 review now recommends VR-018's typed-failure cross-surface boundary, while making no claim that every code was natively exercised or that the HTTP fixture performs signature crypto.

Final hardening adds a required equality invariant: a verified policy summary outcome must equal the sealed terminal `policyOutcome`; both the public contract and dashboard DTO reject a mismatch. Refreshed contracts and dashboard focused suites pass 3/3 and 37/37 respectively.
+
## 2026-09-08 — VR-022 terminal-parity inventory

Created `internal/audit-verification-vr022-terminal-parity.mjs` and executed it as `internal/verification-vr022-terminal-parity-66b3b670-8de9-4069-b846-4838c6deb095.json` (SHA-256 `6249d9ef04fc4463c0acce7b431ba0acc45ae985e150cad92ea71cb7f0560b87`).

The inventory reuses the twelve-mutation HTTP/client/CLI/MCP admission-and-lease receipt, then separates actual terminal result evidence from admission. Eight families have retained terminal cross-surface evidence; capture, extraction verification, and replay remain partial; parse is missing a typed public terminal reader across client/CLI/MCP. A new no-provider local sandboxed parser execution passed, plus six focused worker/application adapter tests. This proves parser behavior only, not durable/public parse terminal parity. No provider, capture, remote, or database operation occurred; VR-022 remains partial.
+
## 2026-09-08 — VR-022 actual parse terminal parity

Added `scripts/prove-verification-parse-terminal-parity.ts` (SHA-256 `538df3b149ce7fb43461effd07b535e9b14086ca3bd8ded88f2f80661cee867d`). It uses the verified local-only configuration, a registered local HTML fixture, Fastify HTTP, typed client, CLI dispatcher, MCP verification executor, a single idempotency key, and the canonical durable worker with the sandboxed parser.

The successful receipt is `internal/verification-parse-terminal-parity-be326c7d-a756-4446-90c6-7c38d4032d1e.json` (SHA-256 `766eca974b3ae19ba9b34524f1ca858913192f2f0e356f19c8605dd052baaf29`). HTTP/client/CLI/MCP resolved exactly one operation; the real parser worker produced one HTML projection, a fenced success receipt, and a canonical result artifact that was hydrated through the trusted resolver and byte-compared. Provider calls and remote writes were zero. Earlier failed local attempts were fixture-only and halted before parser terminal completion; the final receipt is the evidence for this slice.
