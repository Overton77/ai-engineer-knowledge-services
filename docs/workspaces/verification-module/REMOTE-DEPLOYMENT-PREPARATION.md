# Remote deployment preparation

Status: read-only readiness audit; deployment is not accepted.

**Populated deployment blocker:** the follow-up aggregate preflight found 236 existing registered artifacts in `ai-engineer-cloud-bucket`, all failing the pending global verification CAS path/media/size conjunction. `20260905010000_verification_persistence_contract.sql` would therefore fail its global `verification_bucket_cas_path_ck`. Preserve existing metadata and physical object identities. Do not rename legacy bucket/path metadata without moving and verifying its real content, delete rows, or weaken new verification checks just to pass deployment. A reviewed migration compatibility strategy is required before remote application. Evidence: `internal/verification-remote-data-preflight-addendum-20260906.json`. Existing retrieval_run, retrieval_candidate, packet_member and eval_case tables have zero rows, so their named backfills are not the current blocker.

The configured target is Supabase project `wkythqbofmckbuoothhn` (`supabase-blue-ocean`, us-east-1, active, PostgreSQL 17.6.1.104). The other connected biotech project is outside this deployment target. No remote writes were performed by this audit.

## Observed migration gap

`internal/verification-remote-readiness-20260906.json` retains the remote migration ledger and three required-table absence checks. The latest remote migration is `20260902010655_research_starter_channels`. Remote tables `knowledge_service.operation`, `orchestration.verification_artifact_metadata` and `orchestration.verification_provider_budget` are absent.

`internal/verification-remote-migration-comparison-7e646205-1069-4f6a-b40e-c282b4ecc25e.json`, SHA-256 `33e15beb65989ccaeb3bd101ae13701f2029408e85297b9e6777260c77486b8f`, compares 89 active canonical SQL files: 42 share version and name, eight share a name at a different remote version, and 39 are absent from the remote ledger. Matching names are not proof of SQL equivalence. The pending series starts at `20260903010000_knowledge_content_contract.sql` and ends at `20260906018000_provider_precontext_envelope_artifact_type.sql`.

The remote ledger already includes `20260826000000_teardown_legacy_app`. Replaying that historical teardown or blindly pushing the entire local history would be inappropriate. Preserve historical remote versions; do not infer missing schema from timestamp differences alone.

## Prerequisites observed

`internal/verification-remote-prerequisites-20260906.json` records metadata-only queries. The seven required base tables in orchestration/evidence exist and have RLS enabled. Runtime roles `executor_service`, `verifier_agent`, `control_plane` and `app_reader` exist without superuser or BYPASSRLS privileges. Utilities `util.uuidv7()` and `util.default_tenant_id()` exist. Installed extension versions include pgcrypto 1.3, vector 0.8.0 and pg_trgm 1.6. There are zero ordinary/partitioned tables in content and knowledge_service. This is not a column, trigger, data-compatibility or grant-equivalence proof.

## Concrete rollout work remaining

Independent canonical-baseline comparison now exists: `internal/verification-remote-baseline-audit-remote-base-a5e3d772.json`, SHA-256 `92d4fe3e157b0c35afcab5cdaec9489cac7f5da75e6a2f3dede0367ec4d8a763`. An isolated local database applied the 50 canonical pre-service migrations and independently reported `50|20260902010518`. Both snapshots contain 4,742 metadata objects. All 4,702 shared objects match exactly, including column definitions, constraints, table RLS flags, policies, triggers, enum labels and application function definitions. The only missing/extra objects are 40 date-dependent observability partition objects on each side (remote July 2026 versus fresh local March 2027). The exact isolated container was stopped and its volume retained. Index definitions, owners and object grants are not included in this snapshot and still need review.

`internal/verification-remote-data-preflight-20260906.json` records aggregate compatibility checks: 31 source captures and 35 claims have zero mismatches in the checked capture/source/artifact, producer-attempt, atomization and supersession tenant relationships. Existing vector items and vector-space versions both have zero rows. No row contents were exported or changed.

1. Reconcile the eight renamed historical versions by comparing actual schema/constraints and applied SQL where available. Retain the original remote ledger and canonical migration hashes as evidence.
2. Review the 39 pending migrations against remote base columns, utility definitions, grants and existing-data constraints. Preflight compatibility with aggregate checks that do not expose record contents. The accepted empty fresh-chain replay proves ordering but not populated remote compatibility.
3. Apply only the reviewed missing series using the canonical SQL. Do not reset the database or repair historical ledger rows merely to satisfy CLI ordering. Record each successful remote migration and stop on errors.
4. Recheck types/schema, tenant isolation, private Storage, immutable artifact and policy replay, and accounting using isolated verification fixtures. Bind receipts to the actual project and migration series.
5. Deploy and validate the trusted service composition and authenticated routes before claiming remote worker/agent integration. Database availability alone is not service readiness.

The user has authorized necessary commands and migrations. This preparation does not add a new approval requirement; it identifies compatibility work necessary before a safe rollout. Supabase skill and current changelog were consulted. Current extension installation should not rely on an explicit VERSION override; this pending first migration uses `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions`.

## Index and access-grant comparison

`internal/verification-remote-security-compare-79492fa8-473e-40c3-9433-0a8c13a760cb.json`, SHA-256 `1541bc8a0a4cfad1d35ca6ebcf5e15748a50fc039d92cb81a0d13251ff188c57`, compares 1,012 index/owner/ACL objects on each baseline. All 1,000 shared objects match; the twelve missing/extra objects are the same monthly observability partition indexes and relation grants. ACL order was normalized by role/privilege content, not database-specific role OIDs. The exact isolated canonical-baseline container was restarted solely for this read, then stopped again with its volume retained. This closes the previously noted object-grant/index snapshot gap; role membership and populated data remain separate checks.

## Remote database boundary completed — 2026-09-05

EV-040 and EV-041 now accept the exact remote rollout through `20260906022000`, canonical schema/security parity, original-data preservation, and real remote private Storage/persistence plus no-dispatch accounting proofs. Earlier pending rollout instructions are retained as history and must not be rerun. API/worker deployment, dynamic authenticated operation ownership, full public-service inventory and end-to-end integration remain incomplete.
