# Native five-component drift proof — 2026-09-08

Status: **passed**

This checkpoint proves the local production composition from two admitted, signed verification run manifests through component comparison, immutable observation custody, Mission Control consumption, and one durable `review_required` alert.

## Retained evidence

- Proof source: `internal/prove-verification-component-drift-native-20260908.mts`
  - SHA-256: `68e60c9c4dd5b371286d9886e8028d10f0ce98a680ae8b3d82f324e66ad4c7a9`
- Receipt: `internal/verification-component-drift-native-74d53d12-5d83-4275-b026-c99355281498.json`
  - SHA-256: `2bc8e2946263a989250a230f6a4ca65005777f8835164ee1ff6d7fdf65b2a068`
- Applied migration source: `ai-engineer-db-contract/supabase/migrations/20260908030000_verification_drift_revalidation_outbox.sql`
  - SHA-256: `5e9c8653389b150b87c19df9b18f08c908852a5fc848a433a5f2f8e914ba5697`
- Migration application receipt: `internal/verification-drift-local-migration-20260908.json`

## Canonical identities

- Tenant: `be32cf61-1df5-4d43-834d-cd8bb0e6f96c`
- Mission: `07f2caf5-0be3-5c7b-a3b3-a185b58ee05c`
- Work item: `67ff4150-19c3-5524-af5c-5c7e073b29f1`
- Baseline run: `fdfd364c-defb-55bc-a0fa-90f94359b7a7`
- Baseline operation: `038e4e74-4cd2-5373-ab48-c2bf6172c9b1`
- Baseline signed manifest artifact: `45cba00e-e19b-5cce-a668-d332ab70264e`
- Candidate run: `a7b97d8c-c983-5f7d-a964-e7f14ae0fe0b`
- Candidate operation: `373e9545-8c99-5c4e-a983-7b078ff9b045`
- Candidate signed manifest artifact: `1256f878-742f-5d63-a110-1661c0542a98`
- Component observation artifact: `ae5b6f30-67a2-58b8-ad1e-94cc8cb83f69`
- Published alert: `01a082f7-b211-7624-8646-9af3e27e784a`

## Demonstrated path

1. The harness retained the existing component-drift source fixture in local Supabase Storage and created two fresh mission-bound `verification_claims` operations.
2. Each operation registered its source, policy, bundle, deterministic result, recorded policy inputs, and Ed25519-signed audit bundle through `PostgresVerificationRepository`. Both operation steps reached canonical `succeeded`; both `evidence.verification_run` rows are terminal and bind their stored manifest artifacts.
3. The signed manifest bytes define all five monitored components. Baseline and candidate values differ for `provider`, `model`, `parser`, `grader`, and `policy`.
4. `compareVerifiedComponentVersions` authorized and hydrated both registered artifacts, verified both signatures, and derived the five changed dimensions from the signed bytes.
5. `PostgresVerificationComponentDriftPublisher` registered the immutable restricted observation with both manifests as parents. The database publisher derived `source_operation_id` from the candidate `evidence.verification_run` and atomically inserted custody plus a `review_required` outbox record.
6. The real Mission Control `consumeVerificationDrift` activity called the private Knowledge Services HTTP `scan`, `claim`, and `ack` routes. The first call returned `planned=1`, `alertsPublished=1`, and `providerCalls=0`.
7. The exact repeat returned `planned=0`, `alreadyPlanned=1`, and `alertsPublished=0`. The published alert inbox still contained exactly one matching alert.

The retained observation and alert preserve the canonical component order `provider`, `model`, `parser`, `grader`, `policy`. The alert source operation is exactly the candidate operation `373e9545-8c99-5c4e-a983-7b078ff9b045`.

Focused validation after the proof passed:

- Knowledge Services comparator, publisher, runtime, and private-route suites: 4 files, 21 tests.
- Mission Control drift consumer activity suite: 1 file, 4 tests.
- Independent receipt binding check: signed-run flag present, candidate/source-operation equality true, repeat alert count zero.

## Scope and limits

This is a `synthetic_engineering` proof using a retained deterministic source fixture. It makes no assertion-quality, source-authority, calibration, or promotion claim. It made zero provider and external model calls. It used local Supabase database and Storage plus private loopback HTTP. Temporal schedule execution is outside this checkpoint.

Two earlier harness attempts stopped before run publication while correcting the frozen fixture's representation-artifact binding. Their fresh tenant-scoped partial engineering rows were retained; no existing rows or stored objects were reset or deleted.
