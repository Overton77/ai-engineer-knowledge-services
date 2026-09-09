# WS-08 Case/Evidence Canonical Migration Handoff

**Status:** bounded schema and pgTAP contract test are ready for independent review. The migration has not been applied to a database, generated types have not been regenerated, and no vendor archive has been changed.

## Owned files

- `../../../../ai-engineer-db-contract/supabase/migrations/20260906023000_verification_case_evidence_reads.sql`
- `../../../../ai-engineer-db-contract/supabase/tests/verification_case_evidence_reads.sql`
- This handoff.

## Canonical identities

`evidence.verification_case_run.id` is the sole future public `caseRunId`. A row binds one stable `case_key` to a same-tenant `evidence.verification_run` plus exact input and result artifacts.

`evidence.verification_case_evidence.id` is the sole future public `evidenceId`. The first slice supports only an exact registered artifact reference. It deliberately creates no alias to `evaluation.eval_run`, `evaluation.eval_score`, `evaluation.eval_run_case_output`, `evidence.verification_finding`, `judgment_id`, `Judgment.evidenceId`, or `evidence.locator`.

## Constraints and validation

`verification_case_run` has:

- UUIDv7 default ID, tenant, verification-run ID, raw 1–255-character nonblank `case_key`, exact input/result artifact IDs and SHA-256 values, and creation time.
- Composite tenant foreign keys to `verification_run(tenant_id,id)` and both `artifact(tenant_id,id)` parents.
- Uniqueness on `(tenant_id,id)` and `(tenant_id,verification_run_id,case_key)`.
- An insert validator requiring a same-tenant parent with `contract_version='verification.v1'` and exact artifact SHA-256 matches.

`verification_case_evidence` has:

- UUIDv7 default ID, tenant, case-run ID, raw 1–255-character nonblank `evidence_key`, artifact ID/SHA-256, creation time, and ordinal constrained to `0..255`.
- Composite tenant foreign keys to the case run and artifact.
- Uniqueness on `(tenant_id,id)`, `(tenant_id,case_run_id,evidence_key)`, and `(tenant_id,case_run_id,ordinal)`. The ordinal bound and unique position cap a case at 256 ordered evidence references.
- An insert validator requiring an exact SHA-256 binding to an available, marked, metadata-backed same-tenant verification artifact.

Both tables reject update and delete through `util.reject_mutation`, use tenant RLS for the five bounded roles, revoke broad grants, allow trusted runtime roles to select/insert, and allow `app_reader` to select.

## Test coverage

The pgTAP transaction fixture has 23 checks for table/append-only trigger presence, a valid parent inserted through its ordinary validator, valid artifact-only evidence, input/evidence digest drift, legacy-parent rejection, unavailable and metadata-free artifact rejection, cross-tenant parent/artifact rejection, ordinal 256 rejection, raw-whitespace case/evidence key bounds, update/delete rejection, and actual `app_reader` tenant RLS/read-only checks. Its parent artifacts are marked, metadata-backed, available, tenant-bound, and typed; no existing integrity trigger is disabled.

Run after a disposable/local migration only:

```powershell
# Apply only through the repository's approved local migration workflow, then run its pgTAP suite.
# Do not apply to shared or remote databases from this handoff.
```

## Integration boundary

The next owner should regenerate the database contract only after applying this migration in the approved local environment, then add strict contracts, tenant-scoped persistence reads, application projections, API/client/CLI/MCP routes, and a real local proof. Reads must preserve parent run visibility gating and return compact artifact references only; no source/evaluation payload bodies, locator selector/content, or object storage paths belong in the public projection.

## Local migration and isolation proof

The approved follow-on migration `../../../../ai-engineer-db-contract/supabase/migrations/20260906024000_verification_case_reader_schema_access.sql` grants only `USAGE` on the `evidence` schema to `app_reader`. It is required because the case/evidence tables already grant `SELECT` to that role, but PostgreSQL also requires schema usage before RLS is evaluated. It does not grant `app_reader` use of `orchestration` or any insert privilege.

The migration was applied with `corepack pnpm exec supabase migration up --local` in the database-contract workspace. The rollback-only pgTAP fixture then passed **23/23** against local `supabase_db_aiengineer`; its retained output is `../../../../internal/verification-case-evidence-pgtap-20260905-164250.log`. It proves cross-tenant parent and evidence-artifact rejection, and under `SET LOCAL ROLE app_reader` plus `app.tenant_id`, own case/evidence visibility, foreign-row invisibility, and no case-run insert privilege.



