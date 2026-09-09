# Local vocabulary migration preflight review

Independent read-only preflight completed 2026-09-07 for canonical migration `ai-engineer-db-contract/supabase/migrations/20260907010000_verification_claim_report_artifact_types.sql`.

## Recommendation

The draft is safe to apply to the specified loopback local database only. It is the sole migration present on disk and absent from the installed local ledger. It adds seven previously absent codes to the existing artifact-type vocabulary using a primary-key conflict no-op; it does not alter existing data, tables, grants, RLS, functions, triggers, or operation state.

This review authorizes neither remote application nor any database mutation by this reviewer. The planned command must retain the explicit `127.0.0.1:54322` loopback database target.

## Draft inspection

The migration uses one transaction with `lock_timeout = '10s'` and `statement_timeout = '120s'`, then inserts only:

- `verification_claims_artifact`
- `verification_report_ledger`
- `verification_report_result`
- `verification_parse_result`
- `verification_audit_bundle`
- `verification_adjudication_packet`
- `verification_adjudication_decision`

`ON CONFLICT (code) DO NOTHING` makes an already-installed identical vocabulary entry a no-op. The descriptions do not grant authority or change policy; each makes the intended non-admission/custody meaning explicit.

## Read-only local PostgreSQL evidence

Connection used by the repository's local-development convention: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, inside an explicit `BEGIN READ ONLY` transaction, followed by `ROLLBACK`.

| Check | Observed result |
| --- | --- |
| Installed migration ledger | 135 rows; latest `20260906033000` |
| Canonical migration files | 136 files; latest `20260907010000` |
| Set comparison | `20260907010000` is the only filesystem version missing in DB; no installed version is absent on disk |
| Proposed artifact codes already installed | 0 of 7 |
| `orchestration.artifact_type` | 64 rows, columns `code`, `description`, `created_at`; primary key `artifact_type_pkey (code)` |
| Dependency | `orchestration.artifact.artifact_type` has a foreign key to `orchestration.artifact_type(code)` |

The direct inspection agrees with the earlier local health receipt: PostgreSQL at `127.0.0.1:54322` was reachable and reports latest migration `20260906033000`.

## Command evidence

The read-only query was executed from `ai-engineer-knowledge-services` with the already-installed persistence `pg` package:

```text
corepack pnpm --filter @aiengineer/knowledge-persistence exec node --input-type=module
```

It exited 0. The script began a `READ ONLY` transaction, selected the Supabase migration ledger, artifact-type constraints, foreign-key references, and the seven proposed codes, then rolled back.

## Source snapshot

| File | SHA-256 |
| --- | --- |
| `ai-engineer-db-contract/supabase/migrations/20260907010000_verification_claim_report_artifact_types.sql` | `557F35E3B25C551DB333E0944F622D98E2806F803ED54866520B3A9E4947E8DD` |

## Limits

This proves only the local schema/ledger precondition and the migration's limited DDL/DML shape. It does not prove post-apply behavior, remote parity, application runtime wiring, storage behavior, tenant authorization, or verification correctness. No migration, data mutation, database reset, storage action, provider call, or environment-file load was performed.
