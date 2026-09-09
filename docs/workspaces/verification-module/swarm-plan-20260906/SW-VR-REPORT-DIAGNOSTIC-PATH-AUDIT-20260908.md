# Diagnostic report semantic path audit — 2026-09-08

## Verdict

The diagnostic bypass is narrowly scoped to report-wide consistency failures. `VerificationClaimsApplicationService.prepareReportDiagnosticSemanticCases` first requires the original service-branded result and context, recomputes the report-wide gates, requires a passed base deterministic result with semantic eligibility, requires the final result to be failed and semantically ineligible, and rejects any pre-existing base failure. The only added failure codes accepted are `REPORT_INTERNAL_CONTRADICTION_FREE` and `REPORT_CROSS_SECTION_CONSISTENCY` (`packages/application/src/verification-claims.ts:144-154`). This does not bypass pointer, artifact custody, capture registration, projection admission, runtime identity, or ordinary claim admission: `verifyReport` hydrates exact report and ledger handles, binds the ledger report, hydrates and registers captures, admits native projections, binds runtime principals, and recomputes deterministic results before report-wide gates (`verification-claims.ts:202-228`, `:247-267`). The ordinary semantic path returns no cases for the failed diagnostic result, and a diagnostic assessment batch is rejected by the branded batch check; the focused tests cover this (`verification-claims.test.ts:153-166`).

## Dispatch controls

The generated-report plan is diagnostic-only, `dispatchAuthorized: false`, and records zero external requests until an exact grant is supplied (`packages/application/src/verification-diagnostics-generated-report-semantics.ts:34-45`, `:84-87`). Preparation re-verifies each report through the claims service and checks expected report/ledger artifact identity (`:64-73`). Execution binds once before the first await, requires exact plan digest, entry digests, Luna identity, call/cost limits, concurrency 1, retries 0, and stop-after-three values, journals each entry before adapter creation, and stops after three consecutive failures (`:96-119`). The focused tests passed 10/10 across the claims and generated-report suites.

## Concrete remaining gaps

1. The generated plan accepts caller-supplied `sourceBinding.sourceArtifact`, `projectionArtifact`, `transformationArtifactId`, `captureId`, and `selector` after checking only the report/assertion/fragment key, selected-content digest, exact-text digest, nonempty rights, and `goldStatus: not_labeled` (`verification-diagnostics-generated-report-semantics.ts:61-73`). It does not compare those source/projection/capture/selector identities to the already verified semantic case or context tenant. A diagnostic plan can therefore carry provenance metadata for a different capture while the underlying semantic case remains custody-valid. This is a plan-provenance defect, not a report-wide bypass; bind those fields to the service-derived evidence before using the plan as evidence.

2. `localLedgerHandles` and `reportHandles` are schema-parsed and cardinality-checked, but are not cross-bound to the per-report descriptor handles that `verifyReport` actually verified (`verification-diagnostics-generated-report-semantics.ts:58-67`, `:85`). A plan can advertise an unrelated 43-ledger/3-report local closure. Bind each descriptor's expected report and claim-ledger handles into the corresponding plan-level closure, or derive the closure from the verified results.

These gaps do not expand the allowed diagnostic failure set and do not make an ordinary batch admissible. They should be fixed before treating the generated plan's source or local-closure metadata as authoritative.

## Remediation disposition

Root subsequently added generic descriptor-handle tenant and expected-report/ledger cross-binding, plus source/projection tenant checks. The remaining source metadata fields (`sourceUri`, capture/source/projection/selector identity) are intentionally trusted engineering-composition inputs rather than HTTP admission data. The EV162 preparer authenticates the sealed catalog, capture registry, and exact input-file digests before composing the plan. The original limitation therefore remains as a qualified engineering-composition trust boundary; it is not claimed fully eliminated.
