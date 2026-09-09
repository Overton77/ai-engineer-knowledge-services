# WS-08 next Knowledge Services vertical-slice plan

Updated 2026-09-05. This is a read-only implementation assessment and a plan;
it does not claim a newly admitted route or capability.

## Recommendation

Build one authenticated, compact **verification result descriptor** read for the
four already admitted operations before adding another verification mutation:

```text
GET /v1/verification/operations/:operationId/result
```

The route should return a strict descriptor only after it has confirmed all of
the following under the caller's tenant:

1. the durable operation exists and its kind is one of `verification_capture`,
   `verification_extraction`, `verification_metric`, or
   `verification_replay`;
2. it is terminal and has a matching terminal receipt for its recorded step;
3. the receipt's `resultArtifact` handle parses strictly and its exact artifact
   registration exists, is available, and has the same tenant, ID, and digest.

The response should contain operation ID, kind, durable state, receipt ID/kind/
outcome/output digest, and bounded artifact metadata. It must not return the
receipt body, source bytes, artifact bytes, provider output, actor configuration,
or arbitrary result JSON. A missing owned resource is `404`; a broken terminal
binding is an internal consistency `409` or sanitized `503`, never a partial
success. This is the missing dashboard-friendly projection over facts that are
already durable. It does not duplicate verification logic or create a new
algorithm.

The existing generic reads remain the source APIs: `GET /v1/verification/
operations/:id` exposes status and receipt IDs, `GET /v1/receipts/:id` exposes a
full durable receipt to authorized callers, and `GET /v1/artifacts/:id` exposes
bounded artifact metadata. The proposed route composes those bindings server
side, so dashboard clients do not need to interpret receipt bodies or infer
authorization from a caller-supplied artifact ID.

## Current public inventory

The only complete, admitted verification mutations are:

| Public HTTP and client operation | Durable kind | Worker implementation |
| --- | --- | --- |
| `POST /v1/verification/captures` | `verification_capture` | `register_and_admit` |
| `POST /v1/verification/extractions:verify` | `verification_extraction` | `verify_and_register` |
| `POST /v1/verification/metrics:verify` | `verification_metric` | `verify_metric_and_register` |
| `POST /v1/verification/runs/:runId:replay` | `verification_replay` | `hydrate_and_recompute` |

The MCP catalog intentionally exposes the same four tools only. The public
client has matching submit methods plus operation and receipt reads. The service
does **not** presently expose `verifyClaims`, `verifyReport`, `runBenchmark`,
`compareBenchmarkRuns`, `requestAdjudication`, or the declared run/case/evidence
read schemas as admitted public routes. They must not be advertised as available.

Contracts contain schemas for the broader inventory, and reusable components
exist, but the vertical slices do not:

- `packages/verification/src/semantic/verification.ts` provides bounded semantic
  authorization and judgment functions, with calibration explicitly pending
  empirical labels.
- `packages/policy/src/verification-policy.ts` evaluates and replays versioned
  policy inputs.
- `packages/application/src/verification-benchmark.ts` provides the frozen
  diagnostics demo, checkpointing, deterministic report generation, recorded
  provider-output composition, and an offline mode.
- `packages/persistence/src/verification.ts` can register immutable artifacts,
  record an `evidence.verification_run`, and load/validate an audit bundle.

None of these facts alone authorizes a new command: there is no equivalent
trusted ownership resolver, admitted operation kind, worker handler, public
client method, or authenticated transport for the unadmitted mutations.

## Reuse and authority boundaries for the descriptor slice

Reuse the current `PostgresKnowledgeOperationService` tenant-scoped status,
`PostgresVerificationRepository` artifact registration/hydration checks, and
the existing route authentication pattern in `apps/api/src/server.ts`. The route
should derive tenant from the bearer identity and obtain the operation ID only
from the path. It must never accept a result artifact, receipt ID, actor, mission
grant, or source/capture reference from the request body or headers.

The trusted binding is the worker-written receipt: the four current worker paths
place a strict `resultArtifact` handle in their successful result. The endpoint
must check that handle against the registered artifact before projecting it. It
should preserve the operation's persisted mission/work-item/attempt context in
internal audit logs only; a later product decision may define which compact
routing fields the dashboard needs.

Focused tests should cover tenant isolation, no-result/nonterminal behavior,
wrong operation kind, receipt from another operation, result artifact tenant or
digest mismatch, unavailable artifact, and a response snapshot proving receipt
body and source/provider fields cannot leak. Reuse current API ownership and
verification-route fixtures plus persistence artifact registration tests.

The real local proof should use one fresh authorized metric operation through
the existing API and worker, wait for its durable terminal receipt, call the new
read with the same bearer/tenant, and validate the compact ID/digest binding.
Repeat with a foreign tenant token and require `404`. The proof must replay no
verification algorithm, dispatch no provider, and save only the compact response
and existing receipt/history references needed for custody.

## Why the offline benchmark is not the immediate next public slice

`runDiagnosticsCompaniesDemo` can execute a frozen local replay with
`networkPolicy: "offline"` and zero provider dispatches. It is useful as the
next **internal** validation target after the result descriptor: it reuses
registered projections and produces reports, ledgers, comparisons, and an audit
file without paid calls. Its provider arms are deliberately recorded as
unavailable offline, and its labels are engineering expectations, not human-gold
quality or calibration evidence.

It is not yet an authenticated durable `runBenchmark` product operation. The
demo writes a local output directory; it does not establish a public command,
trusted benchmark catalog admission, canonical evaluation persistence, or a
dashboard-safe resource. Publishing it first would blur those authority and
label boundaries. A later benchmark slice should persist a sealed, offline-only
result artifact and expose it through a separate read resource, while retaining
the stated limitations.

## Source-authority and run-identity gaps to close before semantic or benchmark commands

Semantic and policy code cannot trust caller labels such as source class,
authority, policy version, or adjudication identity. A future `verifyClaims` or
`verifyReport` command needs a server-owned catalog of admitted immutable
captures, selectors, policy artifacts, and reviewer/runtime identities. It must
reuse `VerificationAdmissionService`, semantic authorization, and policy replay;
it must not copy selector, semantic, or policy algorithms into API, worker, MCP,
or Mission Control. The verifier deployment must remain independently bound from
the producing deployment, and human adjudication must be an authenticated
workflow rather than a request field.

There are two different identifiers today that must not be silently reconciled:

- a durable operation ID identifies one queued/executed command. Current worker
  result artifacts are linked through the terminal receipt body. `replayRun`
  accepts a prior **operation ID** despite its `runId` parameter name.
- `evidence.verification_run.id` identifies a sealed audit-bundle run. The
  persistence adapter supports `recordVerificationRun` and `loadAuditBundle`,
  with an optional `operation_id` column, but the current four worker paths do
  not create that row. The offline diagnostics demo also does not establish that
  canonical mapping.

The descriptor slice should therefore expose an operation result artifact only;
it must not invent a verification-run ID. Before `inspectAuditBundle`, benchmark,
or semantic-report commands, define and enforce a one-way run-binding policy:
when a command actually seals an audit bundle, write one `verification_run` row
with its distinct run ID, exact operation ID, and all four registered artifacts
in the same durable completion boundary. Require uniqueness and tenant ownership
for the pair, then make audit reads resolve through that binding.
