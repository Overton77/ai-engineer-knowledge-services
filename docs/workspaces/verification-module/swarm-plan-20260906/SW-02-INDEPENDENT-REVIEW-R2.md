# SW-02 independent review R2

Date: 2026-09-06  
Scope: read-only review of claims/report contracts, application composition, worker activity/sealer, persistence recovery binding, and API admission snapshot. This review did not use a database, Storage, provider, or environment secrets.

## Snapshot reviewed

| File | SHA-256 |
| --- | --- |
| `packages/contracts/src/verification/claims.ts` | `B8FBE206CEDABB2938FC0D7275C4BB4998CB64747B79572E6878701DE48D9640` |
| `packages/application/src/verification-claims.ts` | `223122FC3580493328641D3940B647198D6C3DE041F05B60DD7FA1321D9FCBDC` |
| `apps/worker/src/verification-claims-activity.ts` | `DDE85BBFF073487682DB96CE031AD79B019A2771D421B98AEFF5336B2D341999` |
| `apps/worker/src/verification-claims-sealer.ts` | `C5735481BA02EEBCDBB62DC3703885D9062A1A217F6C1F9D7A8F75AC078CDAB3` |
| `packages/persistence/src/verification.ts` | `09FF6615933D1F7E973B77BE8754749960F59C221F78E5A8849BE89B87166239` |
| `apps/api/src/index.ts` | `D2929CA8A271C5C6C99E7E12E806C33114C1F9BEF9D6C6463C11F67CCE9D0C46` |
| `apps/api/src/server.ts` | `46E80467F7D85D1BBE06E43AF8A644885957D2EFF3530E9DAE1F523B75385F26` |

## Findings

### P1 — API can admit a claims/report operation without a configured executable handler

`apps/api/src/index.ts:83-85,113` admits `verification_claims` and `verification_report` solely when `VERIFICATION_CLAIMS_ENABLED=1` and generic ownership context exists. The routes in `apps/api/src/server.ts:569-570` immediately return an accepted operation. The worker only registers these handlers when its separate `VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON` is present and valid (`apps/worker/src/index.ts:174-184`). There is no API-side input admission or configured-handler handshake in this snapshot.

A deployment with API claims enabled but no worker claims catalog therefore returns 202 for an operation that will never have a handler. This violates the no-unhandled-operation admission invariant. Require one server-owned claims runtime/admission configuration shared by API and worker, or have the route fail closed before enqueue when its exact ledger/assertions handle and capture/projection grants are not admitted by the executable runtime.

The implementation owner reported this path was being fixed while this review ran; re-run this finding against the final source and add a negative API test for the API-enabled/worker-unconfigured state.

### P1 — Final operation-result artifact is outside the lease-fenced native write

`apps/worker/src/verification-claims-sealer.ts:186-189` fences `recordVerificationRun` with the live operation lease. After that succeeds, `apps/worker/src/verification-claims-activity.ts:40-46` performs only a status read and calls generic `registerContentAddressedArtifact` for the terminal operation result. It supplies no lease, fencing token, step ID, or operation ID to the artifact registration API. A cancellation or lease expiry between the sealer's record and this registration can create a terminal-looking result artifact that has no native operation/step custody binding and is not an ancestor of the sealed manifest.

The post-write `active()` check cannot undo that registration. Bind the final operation result to the same live lease and operation/step in a guarded persistence transaction, or register it before the fenced sealed-run record and include it in the sealed manifest/record. Add expiry/cancellation tests at this checkpoint and assert no registered terminal result survives stale fencing.

## Verified properties in this snapshot

- Claim/report request contracts expose only artifact ID/digest references; verifier identity is not caller input.
- Report ledger validation requires exact assertion identity/content bijection, output range/report-artifact binding, and declared evidence-ID membership.
- Application composition hydrates registered artifacts, validates full registered capture/source objects, derives report pointer state from deterministic evidence, forces semantic support to `insufficient_evidence`, and holds authority/independence at `unknown`.
- The sealer rehydrates complete registered artifact parent closure, derives a deterministic run ID, records policy inputs and decision, refuses deterministic-only policy pass, and uses native `recordVerificationRun` recovery binding.
- The API success response is the existing strict accepted-operation DTO, not the internal full-handle sealed result. No completed claims/report read DTO was exposed in the reviewed surface.

## Focused command evidence

All commands used Corepack pnpm 10.34.5 and exited 0:

1. `corepack pnpm --filter @aiengineer/knowledge-contracts build`
2. `corepack pnpm --filter @aiengineer/knowledge-application build`
3. `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-claims.test.ts` — 1 file, 2 tests passed.
4. `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-claims-sealer.test.ts` — 1 file, 4 tests passed.

These are fixture/unit checks only. They do not prove native lease behavior, worker/API configuration coherence, Storage custody, or public deployment admission.
