# SW-00 local vocabulary preflight progress

Completed 2026-09-07 as a read-only preflight for `20260907010000_verification_claim_report_artifact_types.sql`.

- Reviewed the canonical draft and its artifact-type-only scope.
- Queried the local loopback PostgreSQL ledger under `BEGIN READ ONLY`; the canonical filesystem and database differ only by this pending migration.
- Confirmed all seven proposed codes are absent and `orchestration.artifact_type.code` is the existing primary-key vocabulary used by the artifact foreign key.
- Wrote the detailed result in `SW-00-LOCAL-VOCABULARY-PREFLIGHT-REVIEW.md`.

No migration or data change was executed. Remote state remains uninspected and unchanged.

## Direct local proof configuration review

Independent read-only review of the explicit direct loopback configuration is recorded in `SW-00-LOCAL-DIRECT-CONFIG-REVIEW.md`. The original `process.env` forwarding finding is remediated by an explicit, case-folded child allowlist; verified local DB/Storage overrides; mode-gated Gateway credentials; and strict endpoint validation for direct and status-derived configurations. Three native Node negative tests and an import-only combined loader/environment check pass without printing credentials. No proof, migration, reset, provider call, or database/storage mutation was performed by the reviewer.

## Audit inspection vocabulary preflight

Independent direct-loopback, read-only preflight for `20260907011000_verification_audit_inspection_result_type.sql` is recorded in `SW-00-AUDIT-INSPECTION-VOCABULARY-PREFLIGHT-REVIEW.md`. The local ledger has 136 versions through `20260907010000`; the single proposed `verification_audit_inspection_result` vocabulary row is absent; the canonical dry run lists only this migration. Application to that verified local database is recommended. The reviewer performed no mutation.

## Audit inspection vocabulary post-apply verification

After the coordinator's canonical CLI apply, independent direct-loopback read-only verification found an exact 137-version canonical/installed ledger set through `20260907011000`, 72 artifact vocabulary codes, and the one expected row with its exact description. The installed ledger statement sequence matches the canonical compact insert transaction. Receipt: `SW-00-AUDIT-INSPECTION-VOCABULARY-POSTAPPLY-REVIEW.md` and `internal/verification-local-audit-vocabulary-postapply-20260907.json`. The reviewer performed no mutation.

## Post-apply read-only verification

Root applied the reviewed local-only migration. A separate read-only transaction then confirmed 136 installed versions exactly match the 136 canonical files, the draft is latest, its ledger statements reflect the vocabulary-only canonical SQL, and the seven expected rows/descriptions are present while the previous 64-code remainder is unchanged. See `SW-00-LOCAL-VOCABULARY-POSTAPPLY-REVIEW.md` and `internal/verification-local-vocabulary-postapply-20260907.json`.
