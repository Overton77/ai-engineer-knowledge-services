# WS-08 Case and Evidence Read Plan

**Status:** assessment only; no implementation or migration in this handoff.

## Requested surface and current coverage

The verification service specification names these reads:

- `GET /v1/verification/runs/{runId}/cases`
- `GET /v1/verification/cases/{caseRunId}`
- `GET /v1/verification/evidence/{evidenceId}`

The delivered verification read surface currently has only `GET /v1/verification/runs/{runId}` and `GET /v1/verification/runs/{runId}/manifest`. The application `VerificationRunReadService` loads a sealed `VerificationAuditBundle`; it has no case or evidence port methods. There are no corresponding public response schemas, API routes, Knowledge client methods, CLI commands, MCP tools, or persistence read methods. The request contracts already declare `ListVerificationRunCasesRequestSchema`, `GetVerificationCaseRequestSchema`, and `GetVerificationEvidenceRequestSchema`, but all accept the broad `VerificationIdSchema` and have no writer or reader behind them.

The existing evaluation service has separate routes/resources for `evaluation.eval_run` reports and failures. They must remain separately named (`/v1/eval-runs/...`) until an explicit cross-domain binding exists.

## Authoritative identities available today

| Candidate ID | Authority and scope | Why it does not implement the requested route |
| --- | --- | --- |
| `evidence.verification_run.id` | The sealed verification run. Tenant-scoped uniqueness, and (for v1) explicit producer/verifier attempts, mission/work item/operation, bundle/result/policy/manifest artifacts and terminal lifecycle. | This is the only valid `{runId}` for the verification-run routes. It has no case child relation. |
| `evaluation.eval_run.id` | An independently created evaluation run over a dataset/target. It can be v1 artifact-backed. | No FK, unique pair, or writer connects it to `evidence.verification_run`. Equal UUIDs or matching artifacts are not evidence of identity. |
| `evaluation.eval_score.id` | One score for one `(evaluation.eval_run, evaluation.eval_case)` pair, with metrics/pass flags and optional result artifact. | Plausible *future* evaluation-case result identity, but it is not a verification case run and has no verification-run relation. |
| `evaluation.eval_run_case_output.id` | Retrieval-specific output for one `(eval_run, eval_case)` pair, containing plan/candidates/packets/answer. | It is not present for every score and has no relation to a verification run. It also contains details unsuitable for a compact verification read by default. |
| `evidence.verification_finding.id` | Canonical immutable finding row, scoped by `(tenant, run, claim)` and later individual `judgment_id`. | It is a finding, not a generic evidence resource. It carries no case-run relation. Its `evidence_id` column is unchecked text supplied from `Judgment.evidenceId`; it is not a foreign key or canonical durable evidence identity. |
| `evidence.claim_evidence_link.id` | Canonical link from a claim to an `evidence.locator`, possibly stamped `verified_by_run_id`. | It can provide provenance after a dedicated relation is chosen, but it is not a generic evidence resource and cannot stand in for arbitrary supplied `Judgment.evidenceId`. |
| `evidence.locator.id` | Source-location identity bound to a capture and, for v1, a representation artifact and resolution metadata. | A locator is not synonymous with the requested evidence resource. It can be unresolved or ambiguous, and returning it as evidence would silently create a false alias. |
| `evidence.claim_evidence_assessment.id` | Immutable assessment of a claim-evidence link in a verification run. | It is scoped to a link and run, but no case-run mapping or public evidence contract declares it as `{evidenceId}`. |

The current verification persistence writer makes the separation concrete. `recordVerificationRun` inserts `evidence.verification_run`; `appendJudgment` inserts `evidence.verification_finding`, persisting caller-shaped `judgment_id` and `evidence_id` text without an evidence-resource FK. The persistence proof then independently inserts `evaluation.eval_dataset`, `eval_dataset_version`, `eval_case`, `eval_run`, and `eval_score`. No existing writer performs a cross-link.

## Schema facts that matter

- `evidence.verification_run` is safe for the already delivered summary/manifest reads. Its v1 validator binds tenant, attempts, mission/work item, canonical operation, and registered artifact identities; the lifecycle is append-only with one terminal transition.
- `evaluation.eval_score` has `id`, `tenant_id`, `run_id`, `case_id`, `metrics`, pass/failure flags, and optional v1 `result_artifact_id/result_sha256`. Its `run_id` is an FK to `evaluation.eval_run`, never `evidence.verification_run`.
- `evaluation.eval_run_case_output` has its own ID plus `tenant_id`, `eval_run_id`, `eval_case_id`, `output_sha256`, and retrieval output payloads. It is one possible evaluation output, not a universal case outcome.
- `evidence.verification_finding` has an internal UUID primary key and tenant/run/claim FKs. The v1 append-only migration adds textual `judgment_id`, textual `evidence_id`, and `observed_at`, with uniqueness only on `(tenant_id, run_id, judgment_id)`.
- `evidence.claim_evidence_link` has an explicit locator FK and optional `verified_by_run_id`; `evidence.claim_evidence_assessment` binds a link to a verification run. These are provenance records, not a public evidence locator registry.

This means `evidence.verification_run` versus `evaluation.eval_run`/`eval_score` is an intentional source-authority gap, not a missing join in an application query.

## Minimal canonical addition before the three routes

Add an explicit, immutable verification case/read graph. It should be written only by the service that composes a verification run with cases; it must not be backfilled or inferred from UUID equality, digest equality, a locator, `Judgment.evidenceId`, or a result artifact.

### Proposed tables

1. `evidence.verification_case_run`
   - `id uuid` is the sole public `{caseRunId}`.
   - Required `tenant_id`, `verification_run_id`, and a bounded stable case key or immutable case-input artifact reference.
   - Composite tenant FK to `evidence.verification_run(tenant_id,id)` and uniqueness scoped to the run and stable case key.
   - Optional, explicitly authored evaluation links only: `evaluation_run_id`, `evaluation_case_id`, and (when the relation is a scored evaluation) `evaluation_score_id`. Each must have same-tenant composite FKs and a check that the score, when present, matches those evaluation IDs. Do not require these fields for non-evaluation verification cases.
   - Append-only v1 rows and RLS matching the verification reader roles.

2. `evidence.verification_case_evidence`
   - `id uuid` is the sole public `{evidenceId}`.
   - Required `tenant_id`, `case_run_id`, presentation-safe `kind`, ordering, and immutable registered artifact reference/digest where bytes are referenced.
   - Add a discriminated, checked provenance target. Initial supported kinds should be deliberately small: a same-tenant `claim_evidence_link_id`, a same-tenant `verification_finding_id`, or a registered immutable artifact/fragment reference. Each variant requires its matching FK and forbids the unrelated targets.
   - Do not add `locator_id` as a generic evidence target. If a future public evidence kind needs a locator, make it an explicit locator-backed variant with its resolution-state and artifact-binding requirements, and project no source bytes.
   - Unique `(tenant_id, case_run_id, ordinal)` plus an immutable-row trigger/RLS.

The two tables are the minimal migration because they create one durable identity for each public route and precisely bind the domains that are currently disconnected. A narrower migration that merely adds `verification_run_id` to `eval_score` would incorrectly require all verification work to be evaluation scoring, would not define `{evidenceId}`, and would still leave retrieval-output-only cases ambiguous.

## Write path and transaction rules

1. The evaluation/verification composer validates the target sealed run and creates the case rows in the same transaction as its authoritative case result. It chooses a fresh canonical `case_run_id`; it never reuses `eval_score.id` or `eval_run_case_output.id` as an alias.
2. If evaluation is involved, the writer verifies that score/output rows have the declared tenant, evaluation run, and evaluation case before inserting the optional relation. The evaluation row is not considered linked until the new case row exists.
3. The writer creates each evidence row only from a resolved canonical source. For finding/link variants, it verifies the referenced row belongs to the same tenant and, where appropriate, the same verification run. For artifact variants, it verifies artifact ID, digest, type, custody, and fragment metadata.
4. A repeat writer uses the case's immutable key and compares every immutable field; identical retry returns it, drift is rejected. Parent verification-run lifecycle visibility remains in force: operation-linked runs are not public until their canonical operation has succeeded.
5. Existing sealed metric runs have no case rows. Do not manufacture them. Once the schema exists, `GET .../runs/{runId}/cases` may return an empty bounded list for a valid run with no authored cases; `GET .../cases/{caseRunId}` and `GET .../evidence/{evidenceId}` return 404 for absent or other-tenant IDs.

## Read design after the migration

Add a narrow repository port with three tenant-scoped methods: list case summaries by verification run, load one case by `caseRunId`, and load one evidence resource by `evidenceId`. Each query must bind both table tenant and every joined parent tenant; the application must still verify returned run/case/evidence ownership before projection.

Public projections should contain only IDs, bounded status/verdict fields, safe timestamps, score flags/metric summaries, digest-bearing compact artifact references (`artifactId`, `digest`, `mediaType`, `sizeBytes`), and explicit source kind. Omit raw case input/expected data, evaluator output JSON, source bytes, object paths, signed URLs, provider payloads, private rationale, prompts, tokens, and raw locator selectors/content. Tighten the existing route request schemas to UUID-compatible public identities and retain strict unknown-field rejection.

Focused proof should create one real sealed run plus a deliberately linked evaluation case and two explicit evidence variants; verify tenant isolation, wrong-parent joins, immutable retry, drift rejection, missing IDs, body/secret stripping, and that a locator or textual `Judgment.evidenceId` alone cannot resolve the evidence endpoint. A separate fixture must prove an unlinked eval run/score remains unreachable through the verification routes.

## Sources inspected

- `docs/workspaces/verification-module/verification-module.md` (specified route inventory).
- `packages/contracts/src/verification/requests.ts` and `reads.ts` (current public request/read inventory).
- `packages/application/src/verification-reads.ts` (current run and manifest-only application port).
- `packages/persistence/src/verification.ts` and `src/postgres.ts` (current writers and evaluation-only read resources).
- Canonical DB migrations `20260826000300_evidence_core.sql`, `20260826001100_evaluation.sql`, `20260903010100_knowledge_retrieval_contract.sql`, `20260905010000_verification_persistence_contract.sql`, and `20260905015000_append_only_verification_judgments.sql`.
- `scripts/prove-verification-persistence.ts` (independent sealed-run and evaluation-row writes).

