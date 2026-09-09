# WS-08 metric audit sealer handoff

Updated 2026-09-05.

## Delivered worker composition

`apps/worker/src/verification-metric-sealer.ts` exports:

```ts
createVerificationMetricAuditSealer({ repository, policyCatalog, storageBucket, runtime, now? })
  .seal({ verified, context, lease, startedAt })
```

It returns only `{ runId, manifestDigest, policyOutcome }`. The activity owns the
operation result artifact; the sealer writes the sealed internal audit trail.

The sealer hydrates the registered observations artifact through a fresh trusted
resolver, parses its exact `VerificationBundle`, and resolves the tenant's
configured immutable policy at that bundle's exact policy version. It requires a
nonempty metric-only bundle, a trusted producer attempt from the application
result, mission/work-item operation context, a live lease passed to
`recordVerificationRun`, and established runtime deployment separation. The
runtime deployment is compared with both the mechanically bound verifier
principal and the bundle verifier deployment. Missing separation is explicitly
`VERIFICATION_METRIC_SEALING_INELIGIBLE_DEPLOYMENT`.

Metric policy inputs contain no invented semantic or source assessment. Every
metric is recorded as `riskClass: "critical"`, downstream use `"verification"`,
and `criticalFactsKnown: false`. Therefore a mechanical result cannot become a
policy pass: the policy's configured unknown-critical disposition determines
review, abstention, or failure; a mechanical failure remains failure. An empty
metric set is rejected before it could reduce to a vacuous policy pass.

The sealer CAS-registers the deterministic result, recorded policy inputs,
policy decision, and audit bundle. The reusable mechanical result has only the
admitted observations bundle as its direct parent and has no operation, profile,
or policy identity in its transformation signature. This permits equivalent
mechanical output to reuse safely across API/CLI/MCP operations. Profile and
policy remain explicit immutable manifest inputs and are checked during recovery.

The manifest contains the exact observation bundle, profile, captured source or
projection handles, policy, policy inputs, result, and decision. Existing
registered-handle parent edges retain their own producer activity/version; the
untrusted bundle's descriptive lineage is not copied. Only sealer-created
artifact edges are labelled `sealMetricAudit`; an unknown parent closes the
bounded operation with `VERIFICATION_METRIC_SEAL_LINEAGE_INCOMPLETE` instead of
hydrating or inventing a lineage edge. The sealing stage makes no provider call;
its storage access is declared `allowlisted`.

The metric profile artifact is recorded as an immutable causal input. Its
optional projection-envelope IDs are already validated by the metric
application admission bridge but are not separately hydrated into this bounded
sealer manifest. A later profile-envelope replay projection should add those
registered handles when the profile contract exposes their exact bindings;
this sealer does not claim that additional closure.

`recordVerificationRun` receives the canonical operation and lease. Audit
policy disposition maps to run status as `fail -> failed`, `review -> review`,
`abstain -> abstained`, and `pass/pass_with_warnings -> succeeded`; canonical
operation completion remains a separate worker transition.

## Retry recovery

The stable run ID is `deterministicUuid("verification-metric-run", operationId)`.
Before registering a new audit, the adapter invokes the internal-only
`loadAuditBundleForOperationRecovery({ tenantId, runId, operationId,
verifierAttemptId })`. The repository checks the row's canonical operation,
attempt, mission/work item, and running/succeeded state. A recovered audit must
match the current exact bundle, deterministic result digest, policy artifact and
version, and profile/observations handles in its manifest. On success it returns
the stored compact reference without new timestamps, writes, or changed handles;
a mismatch is `VERIFICATION_METRIC_SEAL_RECOVERY_DRIFT`.

## Focused unit-only validation

`apps/worker/src/verification-metric-sealer.test.ts` uses an injected in-memory
repository and policy catalog. It covers conservative policy inputs and lease
binding, exact recovery reuse, profile drift rejection, result CAS reuse across
distinct operations, empty-metric rejection, and ineligible deployment
separation. These are unit-only controls; they do not substitute for the root
worker/API/Postgres custody proof.

```text
node_modules/.bin/tsc.cmd --noEmit -p apps/worker/tsconfig.json
node_modules/.bin/vitest.cmd run apps/worker/src/verification-metric-sealer.test.ts
# 6 passed
```

The ordinary `pnpm --filter @aiengineer/knowledge-worker typecheck` preflight
attempted an install and stopped at the existing ignored `esbuild` build-script
approval prompt; it made no dependency or lockfile change.

## Coordinator integration acceptance

EV-052 records the final 21-check live worker/runtime/API proof, independent 15-source/DB custody, and full 72/72 repository verification. Root's normal corepack pnpm verification succeeded. The bounded provenance followup and process-death proof remain open; consult EVIDENCE-LOG.md for exact receipts.

## Provenance followup resolved

EV-053 supersedes the earlier profile-envelope limitation: immutable profile references and registered parent closure are now hydrated under authorization and explicit count/byte bounds, retained in the manifest, and checked on recovery. Native replay and process-death validation remain pending.
