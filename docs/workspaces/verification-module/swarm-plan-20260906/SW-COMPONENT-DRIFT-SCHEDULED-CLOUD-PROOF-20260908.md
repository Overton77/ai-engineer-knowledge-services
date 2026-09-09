# Scheduled Temporal Cloud five-component drift proof — 2026-09-08

Status: **passed**

This successor checkpoint proves that a paused Temporal Cloud Schedule can trigger one production Mission Control `verificationDriftWorkflow`, run its production `consumeVerificationDrift` activity over the private Knowledge Services HTTP surface, and publish one durable five-component review alert.

## Retained evidence

- Proof source: `internal/prove-verification-component-drift-scheduled-cloud-20260908.mts`
  - SHA-256: `91daaa4b320bea883e2ef47168d6a76bcb70f8f251b59e8a7f4a73e6142b9eb7`
- Receipt: `internal/verification-component-drift-scheduled-cloud-0eae0bd3-6771-468b-a646-c70d4603cb2c.json`
  - SHA-256: `ff87467802306921b8cd971520ed4db1b9737efd694b0883917966b7fb8f1e14`
- Temporal history: `internal/verification-component-drift-scheduled-cloud-0eae0bd3-6771-468b-a646-c70d4603cb2c.history.json`
  - SHA-256: `efd2ce7aec37d02ae3af55d4a476f77c202aa193ad18d60944bc27526aefc363`
- Earlier local native proof remains immutable at `internal/verification-component-drift-native-74d53d12-5d83-4275-b026-c99355281498.json` with SHA-256 `2bc8e2946263a989250a230f6a4ca65005777f8835164ee1ff6d7fdf65b2a068`.

## Cloud execution

- Temporal namespace: `verification-cph-20260908.ih0e7`
- Task queue: `verification-drift-proof-1482d349-aa32-4337-b874-cfbe5456fdd7`
- Disposable schedule: `verification-drift-proof-663aa14a-16c6-4d12-af72-fbe18449c1c7`
- Configured workflow ID prefix: `verification-drift-proof-31739da0-d196-4d78-bb07-a2672832c4f3`
- Actual schedule execution: `verification-drift-proof-31739da0-d196-4d78-bb07-a2672832c4f3-2026-09-08T21:51:51Z`
- First execution run ID: `01a08301-8aec-7504-81cf-551921a38782`

The schedule description reported `paused=true` before the trigger and after workflow completion. It retained the production note `Verification drift review alerts; no provider dispatch`. The harness then deleted the owned disposable schedule, stopped the owned worker, and closed both Temporal connections and the local API server.

The fetched Cloud history replayed successfully against the production workflow source. The decoded history scan inspected six Temporal payloads and checked three in-memory credentials: the Temporal API key, private Knowledge Services bearer, and local Supabase service credential. None was present in history or the retained receipt.

## Canonical database lineage

- Tenant: `7376c30d-2d90-4929-af58-0c175a3fb671`
- Mission: `9a27e17c-81d8-5cd0-adb8-f0124c95ced0`
- Work item: `1ad02252-dfde-5ef5-aab2-a8800ab0f7e6`
- Baseline run / operation / signed manifest: `fbd5293a-238a-516c-a6fa-ec66a24a4401` / `cc293aca-bb3a-5274-a647-4b5d980089d5` / `185762af-32bb-5deb-a512-30643a928f5b`
- Candidate run / operation / signed manifest: `4ded3035-777e-5620-aece-e7476462e30c` / `aa5b0489-4ed1-56b6-af1f-163b872ca336` / `4199affa-b5c2-54e5-a0d1-faa9ad75dea3`
- Observation artifact: `35f97e52-6da6-58dd-ac5c-46d2f9b3a839`
- Published alert: `01a08301-8eec-7684-ac95-7d1a7a9f60f1`

The comparator derived changes to `provider`, `model`, `parser`, `grader`, and `policy` from the two Ed25519-signed manifest bytes. The database derived the alert source operation exactly as candidate operation `aa5b0489-4ed1-56b6-af1f-163b872ca336`.

The scheduled Cloud workflow returned `planned=1`, `alreadyPlanned=0`, `alertsPublished=1`, and `providerCalls=0`. A direct exact repeat through the same production activity returned `planned=0`, `alreadyPlanned=1`, `alertsPublished=0`, and `providerCalls=0`; the alert inbox still contained exactly one matching record.

## Attempt accounting and limits

The first scheduled attempt exposed the Temporal Schedule convention that appends its scheduled timestamp to a configured workflow ID prefix. Its disposable schedule was deleted and its launched workflow was explicitly cancelled. The following execution accepted the recorded schedule action identity. A subsequent successful execution strengthened the proof by scanning the serialized, base64-bearing Temporal history representation and is the canonical retained receipt above. All owned schedules were deleted and no recurring future work remains.

This is a `synthetic_engineering` proof with zero provider and external model calls. It makes no assertion-quality, source-authority, calibration, or promotion claim. Temporal Cloud reached a local private HTTP fixture while the harness was running; no public endpoint was part of this checkpoint.
