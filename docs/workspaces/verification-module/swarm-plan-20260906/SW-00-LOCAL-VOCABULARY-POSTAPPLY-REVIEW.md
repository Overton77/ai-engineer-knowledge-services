# Local vocabulary migration post-apply review

Independent read-only verification completed 2026-09-07 after the local-only application of `20260907010000_verification_claim_report_artifact_types.sql`.

The installed local migration ledger now has 136 versions through `20260907010000` and exactly equals the 136 canonical migration versions on disk. The ledger row is named `verification_claim_report_artifact_types`; its recorded statements contain the expected artifact-type insert, all seven canonical codes, and `ON CONFLICT (code) DO NOTHING`. They contain no table DDL, grant/revoke, policy, function, or trigger statement.

`orchestration.artifact_type` now has 71 codes: the prior 64-code remainder plus exactly the seven expected vocabulary rows. Each row's description exactly matches the canonical draft.

The structured receipt is [verification-local-vocabulary-postapply-20260907.json](C:/Users/Pinda/Proyectos/aiengineer/internal/verification-local-vocabulary-postapply-20260907.json). It contains no credentials.

The PostgreSQL connection was loopback `127.0.0.1:54322`, executed inside `BEGIN READ ONLY` and rolled back. No mutation was made by this verification. This does not establish remote parity or application/runtime behavior.
