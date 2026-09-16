---
type: concept
title: Verification and admission
description: How Knowledge Services verifies evidence and admits it to knowledge effects.
tags: [verification, evidence, admission, ingestion, policy]
owner: ai-engineer-knowledge-services
okf_target: "0.2"
sources:
  - id: verification-guide
    resource: ../docs/verification/README.md
    title: Verification Module Guide
  - id: admission-implementation
    resource: ../packages/ingestion/src/evidence-admission.ts
    title: Evidence admission implementation
  - id: verification-transport
    resource: ../packages/application/src/verification/operations/verification-transport.ts
    title: Verification context and admission ports
  - id: verification-ownership
    resource: ../packages/application/src/verification/operations/verification-ownership.ts
    title: Ownership resolver and read authorizer
  - id: verification-host
    resource: ../packages/persistence/src/verification-host-runtime.ts
    title: Shared verification host runtime
---

# Verification and admission

**Concept ID:** `verification-and-admission`

**OKF target:** v0.2. This concept has no human-review attestation.

Knowledge Services treats verification as evidence compilation followed by a
policy decision. It does not turn a model confidence score or caller-supplied
claim text into authority. A claim can support a knowledge effect only after
the service hydrates it from registered, sealed artifacts and the intended
downstream use is admitted.

## Route a request

| Need | Use | Result |
| --- | --- | --- |
| Check a source, extraction, assertion, report, metric, or replay | `verification.v1` use case through the API, CLI, MCP, or worker | A versioned verification result and audit artifacts |
| Inspect an already-created run or audit bundle | Read-only verification surfaces | Evidence and decision inspection; no new admission |
| Turn verified claims into corpus changes | `knowledge-ingestion-intent.v1` plan and apply through the verification executor | Deterministic admitted, held, or rejected proposal receipts |
| Stage uncertain material for people | `candidate.stage` | A candidate only; no canonical knowledge effect |
| Deal with changed or failed verification inputs | Durable recovery | A custody-bound recovery case; see [durable execution and recovery](durable-execution-and-recovery.md) |

The transport is not an algorithm authority. API and MCP compose the same
application ports:
[`verification-transport.ts`](../packages/application/src/verification/operations/verification-transport.ts)
(`ResolveVerificationContext`, catalog/SQL admission factories, static context
resolver) and
[`verification-ownership.ts`](../packages/application/src/verification/operations/verification-ownership.ts)
(ownership resolver and read authorizer). Persistence
[`createVerificationHostRuntime`](../packages/persistence/src/verification-host-runtime.ts)
wires those ports for both servers.

MCP verification mutations, operation/status, and `retrieval.plan_validate`
call application in-process. MCP does not always proxy HTTP. Remaining
retrieval-evidence-eval reads, most verification reads, provider
reconciliation, and record-decision without `isAdjudicationDecisionAdmitted`
still do. Decision and most read runtimes remain API-local composition; that
remainder is observed, not an accepted redesign.

Cross-service consumers use the published HTTP, CLI, or MCP contract rather
than importing verification internals. The current operation and use-case
catalog is in the authoritative
[verification module guide](../docs/verification/README.md#operation-kinds-and-use-cases).

## Ordered verification decision

The as-built pipeline asks these questions in order:

1. Are captured bytes or a canonical representation preserved?
2. Does the stored selector deterministically resolve the cited evidence?
3. Do mechanical checks for identity, type, value, units, time, normalization,
   and arithmetic pass?
4. Does the selected evidence support the complete atomic claim?
5. Does the applicable policy admit the result for this use?

Later stages can add restrictions. Semantic judgment and policy cannot reverse
an earlier deterministic failure. The service records support, world
correctness, attribution faithfulness, source authority, and provenance
integrity independently; an aggregate score cannot replace any one of them.
The full verdict lattice and policy outcomes are defined in the
[verification guide](../docs/verification/README.md#verdict-lattice-and-policy-outcomes),
while algorithm entry points live in
[`packages/verification`](../packages/verification/README.md).

## Admission invariants

- A non-staging proposal needs at least one eligible, run-qualified claim.
- The authoritative claim is hydrated from trusted registered and sealed bytes;
  a boolean eligibility flag or inline prose is insufficient.
- The policy must permit the exact downstream use. For example, a claim allowed
  for `source_attributed_report` is not thereby allowed for
  `knowledge_ingestion:fact.assert_state`.
- Inline claim text, verdict, qualifiers, and subject bindings must match the
  hydrated claim. A planned effect is also compared with a canonical encoding,
  so paraphrased evidence cannot authorize a changed SQL effect.
- New subjects use the deterministic identity the apply step will create; the
  verified binding must name that identity. Claim bindings may only use known
  subject, object, or context roles.
- `record.materialize` additionally requires direct support and a verified
  subject binding. Report publication needs its complete verified report
  binding; the current planner rejects legacy report publication.
- Held dependencies hold their downstream closure, while independent proposals
  can still be admitted. The receipt distinguishes admitted, held, rejected,
  superseded, and duplicate/no-op effects.

These controls are implemented by
[`evidence-admission.ts`](../packages/ingestion/src/evidence-admission.ts) and
the deterministic [planner](../packages/ingestion/src/plan.ts), before the
[apply path](../packages/ingestion/src/apply.ts) writes through the pinned
database contract. Admission does not grant schema ownership to this service.

## Examples

### A fact change with sealed evidence

An intake sends a `fact.assert_state` proposal with `{ runId, claimId }`. The
planner resolves that reference from plan facts. It admits the fact only when
the hydrated claim is eligible, authoritative, intended for
`knowledge_ingestion:fact.assert_state`, has identical statement and
qualifiers, and its canonical value equals the proposed normalized effect.
Changing `status` after verification yields
`PROPOSAL_REVERIFICATION_REQUIRED`; it must be verified again.

### A safe partial result

A `candidate.stage` proposal may be planned without canonical evidence because
it creates review work, not canonical knowledge. If a dependent materialization
cannot be admitted, it is held. An independent materialization with valid
evidence can proceed. This prevents a single ambiguity from becoming either an
unreviewed write or an unnecessary batch-wide failure.

## Failure behavior

Admission is fail-closed. Typical outcomes are `EVIDENCE_REQUIRED`,
`EVIDENCE_NOT_ELIGIBLE`, `AUTHORITATIVE_CLAIM_REQUIRED`,
`EVIDENCE_INTENDED_USE_MISMATCH`, `INLINE_CLAIM_MISMATCH`,
`CLAIM_SUBJECT_REVERIFICATION_REQUIRED`,
`PROPOSAL_REVERIFICATION_REQUIRED`, and `REPORT_BINDING_REQUIRED`. These are
planning decisions, not a signal to synthesize replacement evidence.

The focused [admission tests](../packages/ingestion/src/evidence-admission.test.ts)
cover empty evidence, intended-use mismatches, altered inline fields, new
subject identity bindings, effect changes, report bindings, and independent
closures. The [integration guide](../docs/verification/INTEGRATION-GUIDE.md)
defines the cross-service boundary; Mission Control dispatches and classifies
retry/cancellation, while Knowledge Services owns verification algorithms and
policy admission.

## Current limits

This is an implementation description, not a quality certification. The
verification guide records partial and missing acceptance evidence, including
human-labelled calibration, citation-completeness, and sealed quality
benchmark work. It also documents surface deviations from the design
specification. Read [current acceptance state](../docs/verification/README.md#current-acceptance-state)
before treating a passing service result as proof of those broader claims.

Most verification and retrieval-evidence-eval read ports are still composed
only in the API. MCP still HTTP-shims those reads. That is an observed
remainder, not a claim that MCP is HTTP-only for verification writes.

For recovery, deployment, and operator actions, use the authoritative
[operator runbook](../docs/verification/OPERATOR-RUNBOOK.md) and
[durable execution and recovery](durable-execution-and-recovery.md), rather
than this concept note.
