# SW-03 Eve corrupted-locator independent audit — 2026-09-08

## Result

The retained `corrupted_locator` child is valid bounded negative evidence. The composite launcher is correctly **not** accepted as passing because its separate `same_deployment` child exited 1. This review makes no acceptance claim for that case.

The read-only auditor `internal/audit-verification-eve-negative-corrupted-locator.mjs` produced `internal/verification-eve-negative-corrupted-locator-independent-audit-f2c4a725-8ff5-4b79-a5a8-7ec3ce244d93.json` and passed. It verified all 25 retained source snapshot bytes/bytes hashes, the domain-separated Ed25519 Eve attestation, exact tenant/request/operation/runtime lineage, the effective authored catalog, the selector mutation, signed manifest, local CAS closure, policy outcome, provider accounting, and cleanup.

## Exact mutation and outcome

The original registered retained report ledgers use HTML selector `1/0/2/2/0/0/0/1/0/0/1/1` and digest `sha256:97136a704fae978b4e6a88251181eae720c3828e79fe9736f98bdd629ecffebd`. The submitted ledger independently resolves to selector `999/999/999` in both duplicated canonical evidence locations and digest `sha256:4747649bd5e88a3855beb75c4ac2f7f9dfe3330309bf3ef378b34d0c7b33a3d3`. The request digest is `sha256:75069536605cf4dab596c2a705c7fb103b5a67722337daf04becc0c55222247b`.

The native operation succeeded operationally while its deterministic verification result failed with `LOCATOR_UNIQUE` among the retained failure codes, semantic eligibility false, signed sealed-run policy `fail`, and compact Eve disposition `fail`. This distinction is correct: transport/worker completion did not convert a failed deterministic verdict into acceptance.

The Eve attestation binds operation `e1f72e99-b5eb-583b-a667-7c6eb1170176` to actual mock-runtime IDs `wrun_01M1ZKQNY8MHZVQG3B83Z6QR69:turn_0` / `mock-tool-call-1-0-1`. The effective authored catalog contains only `verify_evidence_bundle`, with no skills, connections or subagents. The audit verified 14 signed artifacts with 17 read-only local CAS reads and a verified manifest signature.

## Network and custody boundary

Canonical provider custody is exactly zero attempts, zero observations and zero response captures. The harness source installs a non-loopback fetch trap and supplies a dummy Gateway token; no retained counter records how many calls reached that direct trap. Therefore the defensible claim is **zero native provider attempts**, plus source evidence that a trap was installed. It is not a measured zero direct-trap invocation claim.

The selected disposable database and dump directory are absent after cleanup. The audit performed local CAS reads only and made no database mutation, provider call, worker invocation, Eve invocation or remote fetch. The 25 copied sources are a selected snapshot set, not a complete transitive executed-code closure. One live-tree built verification file changed after the run, while its retained executed snapshot still matches the launch hash; this audit relies on the retained snapshot for run custody.

## Post-run worker guard review

The worker now rejects any verification result whose `deploymentSeparation.status` is not `established` before calling the sealer or registering the operation result. The focused tests cover both claims and report activity, assert non-retryable `PRODUCER_VERIFIER_INDEPENDENT`, and assert zero seal/result-registration calls. The supplied verification log records 20 workspace tasks successful and the worker test suite passing, including the three activity tests.

This is the correct fail-closed placement for the earlier same-deployment defect: it prevents even a deterministic failure from being sealed as a verifier run when independence is absent. Its evidence is post-run source/tests, not part of the retained corrupted-locator execution, and it does not retroactively make the failed same-deployment child accepted. A fresh isolated native same-deployment negative remains necessary if that negative is to be claimed.

## Scope

This proves one local mockModel Eve negative through real KS HTTP, PostgreSQL, worker and Storage. It does not prove live Eve inference, Mission Control/Temporal, parser behavior, human review, policy admission, cancellation/recovery, or broad VR-024/VR-003 completion.
