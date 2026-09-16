---
name: knowledge-verification-recovery
description: >-
  Use after a Knowledge Services verification finishes unsuccessfully: read the durable recovery
  case, classify each original item by its earliest failed stage, probe a shared selector cause
  once, admit a bounded repair plan, dispatch per-member re-verification, reconcile the canonical
  results, and return one outcome per original item. Also use when a held result needs adjudication,
  an operator repair, or a checkpointed wait. Never use it to retry an unchanged input.
license: Proprietary
metadata:
  version: "1.0.0"
  contract: "verification.v1"
  recoveryContracts: "verification-failure-set.v1, verification-recovery-plan.v1, verification-recovery-receipt.v1"
  surfaces: "executor-cli, executor-mcp, platform-cli (adjudication only)"
---

# Knowledge verification recovery

Recover useful, correctly supported answers after verification fails. The original question set,
the failed items and every decision stay in the denominator. A rejection can be the right result:
the goal is not to make every assertion pass.

Design authority: [verification recovery](../../docs/verification/README.md) and the
[operator runbook](../../docs/verification/OPERATOR-RUNBOOK.md). Commands and tool names in this
skill and in [operations.md](operations.md) are the implemented executor catalog; request bodies are
in [examples.md](examples.md). If your pinned run does not install one of them, persist a diagnostic
handoff and stop — never substitute a command that is not on your pin.

## Surface

Recovery runs on the **verification executor** distribution (`knowledge` from
`@aiengineer/knowledge-verification-executor`, or `recovery_*` tools on its `/mcp`). It is host
configured: without `KNOWLEDGE_RECOVERY_CONFIG_JSON` plus remote artifact custody the operations
answer `RECOVERY_HOST_NOT_CONFIGURED` and nothing you send changes that. Adjudication lives on the
platform CLI (`knowledge adjudication request`). Two distributions ship a `knowledge` binary; use
the one your run pin names.

The host owns the original questions, requirements, budgets, verdicts and usage. You supply
selectors, bindings and reasons. `recovery_plan` re-authenticates every action against the current
case revision, so an optimistic `expectedRevision` is how you detect that someone else moved first.

## 1. Establish the case

```bash
knowledge recovery status                       # configured native runs and observer errors
knowledge recovery observe <runId> --out 40-observed.json   # authenticated result + settled usage
knowledge recovery read <caseId> --out 41-case.json         # full original denominator and routes
```

`recovery_observe` reads the authoritative canonical result, not an exit code, and retains a durable
case when the original was unsuccessful. `recovery_read` returns `state`, `revision`, the complete
`items[]` (`originalId`, `classification`, `route`, `family`, `earliestStage`,
`diagnosticArtifactIds`, `latestOutcome`), `limits` and the retained artifact references.

Read the case before deciding anything:

| What the case shows | What you do |
|---|---|
| `execution: pending` | Wait through caller policy; `recovery_wait` with a committed checkpoint if you must yield |
| `execution: unknown` | `recovery_reconcile` the existing operation; never resubmit under a new identity |
| `mechanical: review_required` or a review/abstain policy | Prepare authorized adjudication; do not retry around the hold |
| `execution: completed` with a terminal quality failure | Diagnose the `earliestStage` and consider changed-input repair |
| `family: authorization`, or a service/storage incident | Route to its owner (`operator`); never grant yourself access |

Counts must reconcile: `submitted = passed + failed + held + pending + unknown + cancelled`, and
`questionDenominator` equals the original question set. A member that disappears from the
denominator is a defect, not progress.

## 2. Diagnose from evidence, then choose one route per item

`family` and `earliestStage` come from the authenticated observation, not from your reading of the
prose. Map each original item to exactly one implemented route.

| Evidence in the failure | Route | Rerun stages |
|---|---|---|
| Wrong locator, missing header row, unit/date/arithmetic mismatch (`selector`, `mechanical`) | `repair` with a `newBinding` | `selector`, `mechanical`, then `semantic`, `policy` |
| Missing or corrupt capture, parser defect (`capture`, `parser`) | `repair` after an admitted re-acquisition, or `operator` when the adapter is broken | `capture` onward |
| Claim exceeds its evidence or fuses two assertions (`unsupported`, `context`) | `repair` with a split or qualified claim; keep the unmet part as `gap` | `semantic`, `policy` |
| Support is genuinely weak and no admitted source remains | `seek_evidence` while the bounded search lasts, then `gap` | as changed |
| Contradicted or disputed identities, dates, capabilities (`contradicted`, `disputed`) | `adjudicate`, or `reject` when the evidence settles it | none |
| Held policy outcome (`policy`) | `adjudicate` | none |
| Unresolved external operation (`execution: unknown`) | `reconcile` | none |
| Already admitted and unaffected | `preserve` | none |
| Limits reached or authority missing | `exhausted` / `operator` | none |

A fresh capture is never proof of what a historical page said: label it as new and keep the original
historical gap. Do not choose a friendlier judge, drop a required qualifier, lower assurance,
substitute an easier objective, or edit policy to obtain a pass. You author new inputs; independent
verification and deterministic admission judge them.

## 3. Group shared causes and probe once

Group by shared capture, representation, parser/profile incident, selector template or subject/time
scope — never merely by identical verdict. `limits.maxProbeRounds` is `1` per dependency: one probe
round per `dependencyId`, with a representative per distinct signature and an unaffected control
when one exists.

```bash
knowledge recovery probe 42-representatives.json \
  --case-id <caseId> --dependency-id <sharedCaptureOrParserId> --control-id <unaffectedOriginalId>
```

The probe is provider-free (`calls: 0`, `costMicros: 0`) and runs against retained bytes under a
durable reservation, so a crash retry repeats the same bytes instead of buying a second round. A
passing probe is evidence **about the fix**, not a pass for any group member: every affected member
is still re-verified individually in step 5.

## 4. Admit a bounded plan

```bash
knowledge recovery plan 43-actions.json \
  --case-id <caseId> --expected-revision <n> --probes 44-probes.json --reservation 45-reservation.json
knowledge recovery claim <caseId> <planDigest> --lease-ms 30000
```

`recovery_plan` requires an action for **every** original item, validates each against the current
authority, limits and revision, and retains the admitted plan. `recovery_claim` takes the durable
original/dependency leases under the host identity, so duplicate notifications and a second worker
cannot open a parallel repair of the same member.

Limits are implemented, not advisory: `maxRoundsPerOriginal` is at most `2`, `maxProbeRounds` at
most `1`, plus `remainingCalls`, `remainingCostMicros` and `deadline`. A shared repair consumes each
affected member's round allowance. Splitting, regrouping or delegating to a child never resets a
counter, and the plan's `stopRules` are fixed: `no_new_information`, `repeated_input`,
`limits_exhausted`.

## 5. Execute, then reconcile the authoritative results

```bash
knowledge recovery execute 46-claim.json --original-id <originalId> --reservation 47-reservation.json
knowledge recovery reconcile <caseId> <planDigest> --out 48-case.json
```

`recovery_execute` reserves one admitted member repair and dispatches its exact canonical
verification operation; a replay keeps the same operation identity instead of creating a new one.
`recovery_reconcile` reads the existing operations, authenticated usage and dependency closure. It
does not trust a producer-reported verdict and does not resubmit.

Rerun the earliest affected check and every dependent one. A mechanical failure cannot be overridden
by a semantic judge. Changed captures or parsers may invalidate other claims; changed claim text or
context needs a new semantic assessment; changed components follow the invalidation contract. Never
erase or overwrite a failed receipt — new immutable versions link back to the ones they replace.

## 6. Wait, resume, or stop

```bash
knowledge recovery wait <caseId> <checkpointId> --expected-revision <n> --reason "awaiting adjudication"
knowledge recovery resume 49-authority.json --case-id <caseId> --expected-revision <n>
```

A wait is entered only after the checkpoint owner verifies the case scope and artifact custody, so a
review or operator hold persists without an agent polling forever. `recovery_resume` requires
independently authorized new evidence: unchanged or self-authored authority is rejected and budgets
never reset. Stop on a repeated input or repair digest, an exhausted limit, missing authority, or a
round that produced no new diagnostic information and resolved no prerequisite.

## 7. Return an accountable result

The receipt maps every original item to exactly one implemented outcome:

`preserved_admitted`, `recovered_admitted`, `partial_support`, `resolved_rejected`, `review_required`,
`operator_required`, `exhausted`, `cancelled`, `reconciliation_unresolved`, `unresolved_gap`.

Report the original→new claim/evidence lineage, the new verification refs, unresolved causes, the
original-question coverage delta, affected downstream outputs, usage and remaining limits, and the
checkpoint/owner references. Held and missing members stay in the denominator.

Recovery ends at the authority boundary. An admitted repaired claim does not by itself verify a
report, update canonical facts, activate vectors or complete a mission; rebind affected report
citations and promotion candidates through their owners (`knowledge report assess`,
`knowledge content plan`, `knowledge ingest plan`). Report registration and structural sealing are
custody, and a seal is never admission — check the report assessment separately.

## Preserve, never cite, untrusted receipts

Discovery and re-acquisition output is preserved, not suppressed: record external provider attempts
with `knowledge source import` and lead decisions with `knowledge source select`, so a failed or
rejected search stays accountable. Imported metadata is self-reported and never becomes evidence;
only executor captures back a quote.

## Exit codes

`0` the operation succeeded (read the returned case state, not the exit code). `1` a domain outcome:
`RECOVERY_PROBE_NOT_AVAILABLE`, `RECOVERY_PROBE_ROUND_ALREADY_RESERVED`, a revision conflict, or an
exhausted limit — re-read the case and change the plan. `2` configuration, custody or authority:
`RECOVERY_HOST_NOT_CONFIGURED`, `RECOVERY_HOST_REMOTE_CUSTODY_REQUIRED`, `DB_UNAVAILABLE` — stop and
report; nothing you author fixes it.

## References

- [operations.md](operations.md) — exact CLI invocations and MCP tool names
- [examples.md](examples.md) — request bodies built from the implemented schemas
