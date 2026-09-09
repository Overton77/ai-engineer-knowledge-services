# SW-14 service terminal parity ledger

## Native proof — 2026-09-08

`scripts/prove-verification-service-terminal-parity.ts` completed a local native proof using only `internal/verification-local-direct-config.mjs`. It read the retained parse operation `a8fc9889-82bc-5d27-ab00-86c6a7dbd47f` and receipt in tenant `571b6244-57f9-4951-86e9-0abb4b37d9bd`, then used their exact retained capture, source-artifact, projection, and transformation bindings. It registered the deterministic local profile and candidate needed for the proof; it did not create a capture, invoke a parser, dispatch a provider, access a remote endpoint, or clean up retained rows.

The actual local canonical worker completed both operations after four submissions with one idempotency key per operation: direct loopback HTTP, the typed TypeScript client, CLI command dispatch, and the MCP executor. Each set resolved to the same durable operation. The proof hydrated each terminal result artifact and checked its bytes equal the canonical receipt result payload, and checked exactly one successful receipt per operation.

| Use case | Durable operation | Terminal receipt | Terminal result artifact |
| --- | --- | --- | --- |
| `verifyExtraction` | `a886d85a-9936-52f6-a0df-962df8ceb180` | `2ce58e11-4988-54d6-a268-d711d3dcc40b` | `d19abd82-166e-52a8-ab3f-a2406dc0f566` |
| `replayRun` | `045ed1ae-39c4-56f3-a043-0571d92943f6` | `c9ec69c8-d1a4-564b-a5b7-a546b6f9eefc` | `a648182f-fed6-5e54-a6eb-73a714d4cf62` |

The immutable machine receipt is `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-service-terminal-parity-72c4c09d-3bec-4101-afd2-8a96bbaa87d5.json`, SHA-256 `f1b781e2ada321ca6234730c04d631b11e48c5b87e1ee40b90bdcc19d91fe4fa`. Its scope records mission `e72c225b-ec57-4e31-bc1a-5d1d58a9ff1d`, work item `a4fe43dd-909a-4150-9a58-9b94ab5f93ed`, attempt `343113d2-8cae-4ba3-9099-f127c93c66a1`, and zero provider calls, parser calls, and remote writes.

Tested command:

```powershell
node_modules\.bin\tsx.cmd scripts\prove-verification-service-terminal-parity.ts
```

It exited `0` and emitted the receipt path above. A bare `tsc --noEmit` has no root `tsconfig.json` in this workspace and only printed compiler help, so it is not recorded as a typecheck.

## VR-014 isolated synthetic review capability — 2026-09-08

The worker registry now implements the already-declared `review_decision:decide` production step. It accepts only a bearer-bound `human` actor or a `service` actor whose identity is exactly `human_reviewer`, and it records a decision only for an existing guarded review subject with an eligible role. It does not modify the verification adjudication contract: adjudication packets still produce pending subjects only, and their contract fixes human decisions and policy overrides as disabled.

`scripts/prove-verification-vr014-review-capability.ts` ran against a fresh local tenant using only the verified loopback configuration. It confirmed policy routing for a mixed/ambiguous synthetic assertion (`review`) and unknown critical clinical input (`abstain`); executed a real canonical worker transition for a synthetic `human_reviewer` service actor; and verified the persisted decision. A `knowledge_worker` actor was rejected with `REVIEW_AUTHORITY_REQUIRED`, and an ineligible reviewer role was rejected by the real persistence guard. The synthetic decision has no human label, creates no production authority grant, and leaves policy admission unchanged. Provider calls and remote writes were zero.

Machine receipt: `C:\Users\Pinda\Proyectos\aiengineer\internal\vr014-synthetic-review-19fc0463-fe21-44e8-a3f5-b6531c1d5f86.json`; SHA-256 `f54649f127f7769a919748bf523dbf0460520716bfd3a9b574971391391d05d6`.

Tested commands:

```powershell
corepack pnpm --filter @aiengineer/knowledge-application build
node_modules\.bin\vitest.cmd run apps/worker/src/activity-registry.test.ts packages/application/src/verification-vr014-capability.test.ts --reporter=dot
node_modules\.bin\tsx.cmd scripts\prove-verification-vr014-review-capability.ts
```

The package build exited `0`; focused tests passed 18/18; the native proof exited `0`.

### Scope correction

This is generic review-subject capability evidence only, not VR-014 verification-review completion. The verification adjudication bridge still creates a `pending_human_adjudication` subject and its public contract explicitly keeps `humanDecisionsEnabled` and `policyOverridesEnabled` false. No generic review decision is bound to a verification adjudication packet, review quorum, verification result, or policy-admission transition. VR-014 therefore remains partial/missing until a separately designed and authorized verification-specific review bridge exists.

The historical synthetic receipt above is retained unchanged. The production generic result no longer carries the unsupported `syntheticCapability` field: runtime output cannot determine whether a caller is synthetic. Worker typecheck passed, and `apps/worker/src/activity-registry.test.ts` plus `apps/worker/src/worker.test.ts` passed 19 tests with 5 explicitly skipped control-plane/runtime cases.


2026-09-08 review bridge progress: corrected unapplied DDL grant-reader permissions and replaced no-op quorum with an invoker-security view. PostgreSQL DDL, role access, tenantless isolation and actual view expression over temporary engineering fixtures pass; rollback confirmed. No canonical human-origin decisions/grants, no migration application, no provider calls. Native insertion and bridge implementation remain open. Receipt internal/verification-review-draft-progress-20260908.json SHA256 5dd6341c1444af9a34cd1b77f8656fb74080d809c22a8f80f7071135c00f2749. Matrix unchanged21 proved/16 partial/9 missing; goal active.
