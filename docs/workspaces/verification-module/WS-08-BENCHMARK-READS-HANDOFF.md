# WS-08 benchmark reads handoff

New compact contracts, application projection, and repository read path expose only a completed signed offline benchmark's identity, dataset/experiment references, canonical lifecycle, all-false engineering claims, and mapped arm IDs/statuses/digests.  They omit artifact object paths, retained bytes, checkpoints, runner reports, detached seal fields, signatures, and keys.

`PostgresVerificationBenchmarkReadRepository(database, verificationRepository, { verifier })` requires a server-owned Ed25519 verifier.  It creates a fresh trusted artifact resolver per read and authorizes the publication artifact with `verification_replay`; unsigned/request-supplied keys are not accepted.

Visibility is limited to a sealed benchmark whose canonical operation succeeded and whose exact successful `replay_recorded_and_register` receipt binds the run, result artifact, payload digest, and mapped eval IDs.  A missing/cancelled/incomplete lifecycle is hidden as not found.  Missing artifact, invalid signature, receipt mismatch, plan drift, mapping/eval/context/attempt/time/dataset/version/experiment drift are integrity failures.

The repository validates database timestamp equality between eval runs and the persisted benchmark before comparing the benchmark's canonical millisecond rendering to the signed manifest.  It also checks canonical plan digest, complete planned arm set, full artifact IDs/digests, eval dataset/version/experiment/context fields, and hydrated byte digest.

Focused unit-only checks passed:

```text
contracts build
application benchmark-read tests: 112 passed
persistence benchmark-read tests: 50 passed, 14 skipped
application and persistence typecheck
```

The transport/runtime keyring and real local proof are owned by the root integration task.

## Coordinator acceptance — EV-070, 2026-09-06 UTC

Root corrected the JSON-helper/byte-input mismatch after owner handoff and added independent byte/tamper/tenant/key/label tests. Final persistence52 pass/14 existing skips; app112 pass; affected54 tasks pass. Actual read-only proof passes11 checks through real HTTP, built CLI and actual MCP HTTP. Independent SQL/Storage/Ed25519 projection audit matches three signed publications and nine scoped source snapshots. See EV-070 for exact evidence and limits. Initial owner-only checks do not establish acceptance of the superseded byte helper.

