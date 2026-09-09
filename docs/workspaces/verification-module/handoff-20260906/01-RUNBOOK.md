# Safe operating runbook

## Start-of-session checks

Use explicit working directories. Read applicable AGENTS.md files and the workspace ledger. Inspect git status in each repository before edits. Do not interpret untracked files as disposable. The parent is not itself the KS Git repository. See generated snapshot for current status, which is a point-in-time observation, not a future guarantee.

PowerShell examples below assume the Knowledge Services working directory:

~~~powershell
Set-Location C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services
git status --short
node --version
corepack pnpm --version
~~~

**KS .env contains remote Supabase configuration. Do not load it for local proofs.** The package script prove:verification-persistence uses --env-file=.env and is therefore not the safe local entry point. The parent helper internal/verification-run-local-proof.mjs asks the local Supabase CLI for credentials, injects them in memory and invokes the selected proof. It currently references the Supabase executable at C:/Users/Pinda/scoop/shims/supabase.exe. On a different machine inspect/adapt that path deliberately. Do not print the JSON status payload: it contains keys.

Local proofs check localhost/127.0.0.1 Postgres54322 and API54321. Use the helper, not copied credentials. Do not run reset to fix missing state. A historical local reset lost evidence and has its own incident/recovery record. Read ../LOCAL-RESET-RECOVERY.md before any database recovery operation. Some pre-reset live proof modes are intentionally retired by the helper; do not remove that guard to rerun them.

## Build and verification

~~~powershell
corepack pnpm exec turbo run typecheck test build --concurrency=1 *> ../internal/verification-resume-workspace.log
~~~

Inspect the exit code and final summary. Latest EV-097 run:72 successful/72,66 cached,10.648s. Earlier EV-096 full uncached run:72 successful in2m7.704s. These are package task counts, not unit-test counts or 72 fulfilled acceptance requirements. Some test suites deliberately skip live/environment tests. Read failures and skips rather than equating a green build to full acceptance.

Package consumers import dist exports. After changing contracts, build contracts first; after application changes build application before persistence/runtime proofs. A script may otherwise execute stale compiled code while a source typecheck passes. Dedicated proof configs live under scripts/tsconfig.verification-*.json. The latest transport proof sets exactOptionalPropertyTypes:false to match the MCP package's compilation context.

~~~powershell
corepack pnpm --filter @aiengineer/knowledge-contracts build
corepack pnpm --filter @aiengineer/knowledge-application build
corepack pnpm --filter @aiengineer/knowledge-persistence build
corepack pnpm --filter @aiengineer/knowledge-client build
corepack pnpm --filter @aiengineer/knowledge-cli build
corepack pnpm exec tsc -p scripts/tsconfig.verification-provider-reconciliation-transports.json --noEmit
~~~

Do not chain these blindly after an error. Verify each result. The full turbo build orders package dependencies. Repeat broad testing after meaningful changes/failures, not just to accumulate green logs.

## Latest complete reconciliation proof

~~~powershell
node ../internal/verification-run-local-proof.mjs provider-reconciliation-publications-prepare
# Copy the newly emitted preparation filename, not a historical settled cohort.
$env:VERIFICATION_RECONCILIATION_PREPARATION = 'verification-provider-reconciliation-publications-preparation-<fresh-uuid>.json'
node ../internal/verification-run-local-proof.mjs provider-reconciliation-transports
# Copy the newly emitted proof filename.
$env:VERIFICATION_EXTRACTION_WORKER_RECEIPT = 'verification-provider-reconciliation-transports-<fresh-uuid>.json'
node ../internal/verification-run-local-proof.mjs provider-reconciliation-transports-audit
~~~

Preparation creates four fresh real local operations using synthetic fetches, isolated budget400, and uncertain cost. Settlement consumes the cohort. Do not rerun first-time settlement against already settled attempts: the decision timestamps/operator key/artifact change, and the immutable ledger must reject a different decision. Exact same decision retries are intentionally idempotent, subject to a still-valid admission window. A final report is written only after all proof assertions pass; inspect DB state after a failed run before deciding whether preparation is reusable.

Other supported recent modes: provider-reconciliation-prepare (failed/cancelled missing-response pair); provider-reconciliation (settlement/overrun); provider-reconciliation-admission; provider-reconciliation-publications; provider-reconciliation-http; provider-reconciliation-reads; corresponding audit modes where present. The historical reads proof expects an EV-094 publications proof, not an arbitrary HTTP/transports file. It verifies at appliedAt while injecting a clock after expiry; it does not issue mutation authority. Read each script's filename regex and prerequisites first. The complete current helper mode inventory is generated in 07-CURRENT-INVENTORY.md; its presence is not a recommendation to run every mode, especially live/mutating ones.

Recent crash modes: structured-extraction-process-recovery and structured-extraction-dispatch-recovery, with audits. These use actual child processes and natural lease expiry. Do not replace them with a caught exception and claim equivalent process-death coverage. Parent waits for child exit; do not start duplicate workers after a tool observation timeout without checking the existing handle.

## Canonical database changes

Only ai-engineer-db-contract owns migrations. Applied migrations are immutable; add a follow-up. Do not copy schema ownership into KS. Latest files327–330 concern reconciliation; see architecture notes.

From the DB-contract working directory, after reviewing the intended local migration:

~~~powershell
corepack pnpm db:migrate
corepack pnpm types:generate
corepack pnpm typecheck
corepack pnpm types:check
corepack pnpm pack --pack-destination ../ai-engineer-knowledge-services/packages/persistence/vendor
~~~

db:migrate is currently supabase migration up --local. Confirm package scripts before using them. Bump DB-contract version for consumer package changes, update KS persistence's exact vendored dependency and refresh both lockfile and installation:

~~~powershell
corepack pnpm install --lockfile-only --offline --ignore-scripts
corepack pnpm install --offline --ignore-scripts --frozen-lockfile
~~~

Then run an updated canonical/vendor/installed parity audit. Latest runner is parent internal/verification-contract-0229-audit.mjs; inspect it before adapting to a new version. File parity and generated-type checks are separate from live installed SQL-body equality. Do both for native guard changes. Do not claim remote application from a local migration or package version bump.

## Runtime configuration boundaries

Extraction worker: VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON, signing key ID/private PEM, tenant, DB/Storage, reviewed parser image, fixed provider credentials for live mode. Runtime parser and native grants bind capture, representation/schema/profile IDs and hashes, code/runtime identity, mode and provider. The public API extraction admission requires configured live mode in production bootstrap; synthetic fetch is an explicit in-process proof port.

Extraction reads: VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON is an array of keyId/publicKeyPem; runtime trustedPublicKeys is a map. Do not interchange these shapes. VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON binds actor,tenant,mission,deployment,capability and optional external execution. Actual attempt/work-item/mission joins establish ownership.

Reconciliation: VERIFICATION_PROVIDER_RECONCILIATION_GRANTS_JSON is a bounded strict array of tenantId,actor,providerId,keyId,operatorId,basis. VERIFICATION_PROVIDER_RECONCILIATION_PUBLIC_KEYS_JSON is a trusted Ed25519 key array. Requires ownership grants and DB/Storage. Missing reconciliation grants leave capability unavailable; partially configured dependencies fail startup. The runtime never signs an operator decision. A registered signed artifact must already exist. Synthetic_fixture and supplier_statement grants are distinct. Never turn an arbitrary caller key into trust.

HTTP: POST/GET /v1/verification/extractions/:operationId/provider-attempts/:providerAttemptId/reconciliation. POST body is {artifact:<full registered handle>}; response200 is the compact accounting result. POST needs operation.submit and narrower runtime grants; GET needs knowledge.read and narrower runtime grants. Native control_plane transaction privileges are required. CLI: reconciliation apply/show with strict input. MCP: knowledge_apply_provider_reconciliation / knowledge_get_provider_reconciliation. Neither transport can create grants or authorize redispatch.

## Evidence and operational hygiene

Retain exact command, exit status, fixture/preparation ID, output path, SHA256, source hashes, native artifact IDs and limitations. Signed immutable publications are historical snapshots, not live budget dashboards. Expiring decisions remain inspectable through the historical read boundary; expiry is still enforced for new mutation admission. Do not edit old signatures, receipt bodies or captured response artifacts to reflect later accounting.

Keep logs outside secret-bearing configuration. Avoid printing environment values, local Supabase status JSON, private signing keys or bearer credentials. Do not run unbounded paid pilots; prior decisions and recorded reservations still apply. Unknown billed amounts are liabilities, not zero. Do not recreate an old exhausted/lost budget to force a passing run.
