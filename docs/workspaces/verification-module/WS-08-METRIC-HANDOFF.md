# WS-08 metric verification application service handoff

**State:** bounded application-composition component complete; no production admission claim.

## Delivered files

- `packages/application/src/verification-metrics.ts`
- `packages/application/src/verification-metrics.test.ts`

The new `VerificationMetricApplicationService` accepts the public
`VerifyMetricObservationRequest` (`captureIds` and `observations` artifact
reference) plus an authenticated `OperationContext`. It returns
`admissionState: "mechanical_only"`, a deterministic result, the exact
hydrated observations/profile registrations, and the deduplicated capture
artifact IDs. It does not call semantic policy, persist an admission result,
or claim that a metric is production-admitted.

## Trusted composition boundary

The constructor requires server-owned dependencies:

```ts
new VerificationMetricApplicationService({
  artifactResolver,
  captures,
  profiles,
  runtimePrincipals,
  nativeProjectionAdmission?,
  selectorResolvers?,
})
```

`profiles` is a `VerificationMetricProfileCatalog`, created from immutable
grants that bind an observations artifact to a separately registered immutable
`verification-metric-profile.v1` artifact. The profile repeats the exact
observations reference, permits the exact capture-ID set, and maps a native
`{captureId, projectionArtifactId}` pair to its transformation-envelope
artifact ID. A caller can choose only an existing grant; it cannot provide a
profile, source authority, policy result, deployment identity, principal
digest, selector resolver, or native envelope ID.

Before the deterministic engine is called, the service:

1. strictly parses the request and authenticated operation context;
2. authorizes and hydrates the registered profile and observations bytes,
   verifies registration tenant/ID/digest/byte length/content digest, and
   parses the full `VerificationBundle` from the observations artifact;
3. requires metric-only input (`assertions` is empty), exact profile/request/
   bundle capture-set agreement, and exact registered source/capture records;
4. hydrates every declared source/projection handle and verifies each capture
   binding before deduplicating identical CAS handles. Conflicting whole-handle
   or byte bindings fail closed;
5. asks `hydrateAdmittedProjection` to validate every native projection using
   the trusted profile envelope mapping. A database capture that has no
   `canonicalProjectionArtifact` is valid only when the declared projection is
   separately envelope-admitted; the service never writes it back onto the
   capture record;
6. accepts a native receipt only when its capture ID and complete source and
   projection handles canonically equal the hydrated bundle declarations;
7. closes the exact successful receipts over the deterministic engine's trusted
   `isProjectionLineageAdmitted` option. The engine still verifies projection
   bytes, byte length, digest and selector replay itself. Historical direct
   parent/signature lineage remains an independent engine path.

`runtimePrincipals.bind` produces the producer/verifier runtime binding after
artifact hydration. The input bundle can declare deployments, but cannot make
them independent: the deterministic engine compares those declarations to the
runtime binding and requires distinct principal digests and deployment IDs.
The existing engine therefore still evaluates selector lineage, metric facet
bindings, direct observations, calculation DAG acyclicity, operand binding,
operand verification, decimal replay, rounding and tolerance.

## Native-projection interface resolved during integration

The observations model supplies a representation artifact ID but no
transformation-envelope ID. The trusted profile mapping above is therefore
required. `VerificationAdmissionService.hydrateAdmittedProjection` requires:

```ts
{ tenantId, captureId, expectedSourceArtifact, transformationArtifactId,
  projectionArtifactId }
```

Its return value must expose the validated receipt's `captureId`,
`sourceArtifact`, and `projectionArtifact` full handles. The deterministic
engine's application-only `isProjectionLineageAdmitted(binding)` hook must
receive a closure over only those exact receipts. It is not a serialized
request flag. This preserves parentless native CAS representations and their
capture-specific envelope lineage without manufacturing a direct parent on the
projection handle.

## Focused evidence

Executed from `C:\Users\Pinda\Proyectos\aiengineer\ai-engineer-knowledge-services`:

```text
corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-metrics.test.ts
```

Result: exit 0; 1 file, 4 tests passed. The tests cover registered artifact
hydration, source selector and arithmetic-DAG replay, strict rejection of a
caller-provided trust field, runtime-derived self-verification failure,
envelope-admitted parentless native projection with a stored capture lacking a
projection field, and two independently registered captures sharing one CAS
source artifact.

```text
corepack pnpm --filter @aiengineer/knowledge-application typecheck
corepack pnpm --filter @aiengineer/knowledge-application build
```

Both commands exit 0.

Source SHA-256 after the checks:

- `verification-metrics.ts`: `0cccc14e86d6bb677122b5580ba199da240575de045c8b52ed2936bb47eb4637`
- `verification-metrics.test.ts`: `3e630bd3bcf5973b0123a3cc94b0db6e7b52ae161e6c038fe7198a8eb97bcb55`

## Durable runtime-principal adapter

`PostgresVerificationMetricRuntimePrincipals` is the production persistence
adapter for `VerificationMetricRuntimePrincipalPort`. Its constructor accepts a
`PostgresCanonicalRepository` transaction port and is exported from
`@aiengineer/knowledge-persistence` for authenticated worker composition.

It receives the already-hydrated observations registration and authenticated
operation context, but no bundle producer/verifier declarations. In one
tenant-scoped transaction it requires an available `verification.v1` artifact
whose stored ID, tenant, and SHA-256 equal that registration; it derives the
producer attempt only from `orchestration.artifact.producer_attempt_id`. It
joins that attempt and the authenticated verifier attempt through their own
tenant-scoped work items and missions. The artifact mission, producer mission,
verifier mission, and authenticated context mission must agree; the verifier
attempt and work item must equal the authenticated context. Missing joins,
missing producer metadata, unavailable artifacts, tenant/digest mismatches,
and ownership mismatches all fail closed.

The returned deployment IDs are database values. Canonical principal digests
include the role, tenant, bound attempt, work item, mission, deployment, and
for the producer the observations artifact ID. This adapter intentionally
returns a binding when producer and verifier use the same deployment; the
deterministic engine then produces the `PRODUCER_VERIFIER_INDEPENDENT` quality
failure. It never converts caller bundle declarations into authority.

Focused evidence:

```text
corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-metric-principals.test.ts
corepack pnpm --filter @aiengineer/knowledge-persistence typecheck
corepack pnpm --filter @aiengineer/knowledge-persistence build
```

All commands exit 0. The eight focused tests cover SQL-derived canonical
binding, same-deployment pass-through for engine quality evaluation, missing
context ownership before SQL, absent durable joins, and artifact/mission/
verifier-work-item mismatches.

Source SHA-256 after those checks:

- `verification-metric-principals.ts`: `7710c8baa5bbcc91ceffaa73003ad0e343fe68834157ac2f1e66d13556e45d9a`
- `verification-metric-principals.test.ts`: `aa45190e60430f9398c1bcd819684babd5c074243aeb5a082a450ebb06800f65`

## Guarded local durable proof — 2026-09-05

`scripts/prove-verification-metric-service.ts` proves this component through a
new `verification_metric` operation and the canonical durable worker, using a
manually constructed registry containing only the new
`verificationMetricActivityHandler`. That local registration is proof-only;
the operation remains outside the global production worker admission map.

The proof gets its credentials only from the existing
`../internal/verification-run-local-proof.mjs metric-service` wrapper. The
script refuses non-loopback Postgres/Storage targets and requires ports 54322
and 54321 before creating a fresh tenant, mission, work item and attempts. It
does not reset any database, delete records, read a remote `.env`, invoke a
provider, or write remotely. All artifacts, operations and the receipt remain
in local shared state for review.

The accepted run uses actual SQL-bound producer and verifier attempts with
different `agent_deployment_id` values; `PostgresVerificationMetricRuntimePrincipals`
derives its binding from the registered observations artifact and those durable
attempt/work-item/mission rows. It registers a source capture
and uses the installed sandbox parser image
`sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37`
to produce a parentless native HTML projection and a capture-specific
transformation envelope. The persisted capture remains projection-free; the
metric bundle declares the projection, and the service admits it only using
the exact envelope receipt.

The proof records thirteen passing checks:

- distinct SQL-bound producer/verifier deployments;
- parentless native HTML projection and no fabricated projection on the stored
  capture;
- completed durable source-bound metric result plus persisted verifier-attempt
  and mission ownership on the result artifact;
- completed quality rejection when the observation says `43` but the selected
  HTML source value is `42`;
- completed quality rejection for a verifier attempt with the producer's
  deployment identity;
- fail-closed missing and wrong transformation-envelope cases.
- configured API and worker completion using the exported persistence adapter;
- stable HTTP idempotency, CLI dispatcher completion, and MCP HTTP completion.

Command:

```text
node internal/verification-run-local-proof.mjs metric-service
```

Result: exit 0. Receipt:
`C:\Users\Pinda\Proyectos\aiengineer\internal\verification-metric-service-5859429d-8a2d-4cbd-bc29-a3cdb969b787.json`.
The receipt records fresh tenant `8b51d326-992e-41d7-aff1-c7613a07a0a3`, three
durable operation IDs, zero provider dispatches, zero remote writes, the parser
image digest, and source hashes. Its source hashes include:

- `scripts/prove-verification-metric-service.ts`:
  `a8e77aa99913607d69128dfa1efe1627fdc3697403b260289164f526c81ca7b0`
- `packages/application/src/verification-metrics.ts`:
  `0cccc14e86d6bb677122b5580ba199da240575de045c8b52ed2936bb47eb4637`
- `packages/persistence/src/verification-metric-principals.ts`:
  `7710c8baa5bbcc91ceffaa73003ad0e343fe68834157ac2f1e66d13556e45d9a`
- `scripts/verification-metric-runtime-proof.ts`:
  `3a1139ecb45d67bf795500e1d3511e554801186005eefddfe01ad024485736a4`
- `apps/worker/src/verification-metric-activity.ts`:
  `1c89f55d613474b18c06ae05ce3cb9e0341f8cd2446f7be47623197bc1f54385`
- `packages/verification/src/deterministic/engine.ts`:
  `f46a6b0e4a8703eb42d4f33091bb80b0bca9a19e59f681f05c7de1e8d7b7bc22`

The initial proof invocation exposed a proof-script-only digest API mismatch
before a successful worker completion; its fresh records were retained. The
script was corrected, then the current proof replaced that closure with the
durable persistence adapter and separately exercised configured API, worker,
HTTP, CLI, and MCP composition with a fresh tenant.

## Integration still required

The service is intentionally not exported or routed by this work item. The
coordinator must provide authenticated artifact/capture/profile/principal/
native-admission adapters, durable result registration, operation/capability
mapping, transport parity and policy admission. Persist only a new immutable
run/result after those boundaries are complete. This component does not
authorize a tenant, acquire sources, call providers, alter captures, attach
native projections to stored captures, or publish/admit a metric.
