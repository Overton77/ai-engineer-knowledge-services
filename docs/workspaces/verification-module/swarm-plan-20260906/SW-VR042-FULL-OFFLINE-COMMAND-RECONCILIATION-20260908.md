# VR-042 full offline command reconciliation — 2026-09-08

## Scope and conclusion

This is a read-only reconciliation of the installed `knowledge demo diagnostics-companies`
command against specification §15.9.5. It makes no provider call, does not alter the frozen
`diagnostics-companies-v1` catalog, and does not treat engineering expectations as human gold.

VR-042 remains **partial**. The command is a real installed, credential-free, atomic offline
command and its report/ledger/manifest inventory is already independently verified. It still does
not perform the whole requested verification command. In particular, it does not invoke the native
claims/report application service over the generated artifacts, does not replay a verified report
and policy digest closure, and does not derive all ten required audit paths from executed results.

The canonical retained execution is
`internal/verification-installed-semantic-cohort-demo-033b5345-316e-4e39-8f46-e0685bf9a791.json`
and the independent aggregate is
`internal/verification-diagnostics-v1-semantic-pairs-EV132-20260908.json`
(`sha256:0ae07018f744353034ffae8806e41cbbc8765c8c4db8554669418f5082eedfee`).
It truthfully exits 2 with `verification_incomplete`.

## What the installed command actually executes

- `apps/cli/src/index.ts` selects the local command before constructing the HTTP client.
  `apps/cli/src/diagnostics-demo.ts` parses only the fixed v1 dataset/output/open surface, publishes
  through a lock plus staging rename, and opens only the audit HTML in an interactive terminal.
- The catalog and source-preparation manifests are authenticated. Forty selectors replay against
  retained projection bytes with zero mismatches.
- Forty single-field `/statement` checks execute the native extraction core with
  `normalized_text`; all 40 pass. This is a source-statement mechanics check, not the required
  structured company/product/algorithm/biomarker extraction coverage. No `exact` field check is
  executed by the command.
- The command executes 40 exact-source, corrupted-locator, and selected-digest-tamper observations
  and constructs 20 original/mutated pairs. The retained EV-131 review found names, biomarkers,
  institutions, and citations absent as mutation families.
- A sealed fixture replays 38 of 40 claim-level Luna evidence assessments with zero external
  requests. `gl-interested-comparison-mutated` and `gl-repeatability-mutated` are unavailable.
  The 38 dispositions are 20 `admit`, 13 `fail`, and 5 `review`; there is no semantic `abstain`
  disposition.
- The command generates all four report families, ledgers, audit artifacts, bundle, and manifest.
  Independent EV-130 evidence validates 29 displayed assertion links to exact retained fragments
  and run backlinks. That is citation custody. The command's generated claim ledger does not carry
  the 38 semantic assessments, and the report artifacts are not passed through
  `VerificationClaimsApplicationService.verifyReport`.
- The audit says deterministic stages replayed, but the typed gate remains unavailable because
  extraction, policy, and report digests are not replayed as one sealed closure. Three provider arms
  remain explicitly unavailable; this is truthful and is not itself a reason to invent offline
  provider results.

## Required §15.9.5 paths

| Required path | Current evidence | Current status | Minimal executed evidence needed |
| --- | --- | --- | --- |
| Exact field accepted | No command field uses `comparison: "exact"`. | absent | One catalog-bound structured field verified by the native extraction core with exact selected bytes. |
| Normalized field accepted | 40 `/statement` normalized-text checks pass. | measured, narrow | Retain one representative result and also run the declared structured-field plan rather than copying the whole selected statement. |
| Precise citation supported | EV-130 proves exact spans, selectors, digests, and navigation; EV-132 separately replays claim support. | mechanical only | A canonical report ledger must bind the displayed assertion range to its citation and pass native report verification with the corresponding replayed semantic result. |
| Partial support due to missing qualifier | `tru-turnaround-product-mutated` replays `partially_supported` with the omitted start-event facet. | measured | Carry the executed semantic assessment and exact fragment into the audit-path record. |
| Conflict detected | Both timeline and 19/21-system statements are displayed. No native report-wide conflict result is executed for them. | absent as verifier result | Construct the canonical report ledger's conflict group and retain the native report-wide conflict output. |
| Promotional claim withheld for authority | `gl-interested-comparison-source` is displayed, but its retained assessment does not assess authority; its mutated pair is unavailable. | absent | Execute a server-owned authority rule that limits the interested-party superlative to “company says,” producing review/withhold without claiming world truth. |
| Publication overextension rejected | `pace-definition-mutated` replays `not_supported` for commercial-feature overextension. | measured | Carry that result into the audit-path record and bind it to the publication fragment. |
| Corrupted locator rejected | All 40 corrupted-locator checks reject. | measured | Retain one exact failed check and its untampered control in the audit-path record. |
| Adversarial claim contradicted | Multiple retained mutated claims replay `contradicted`. | measured, incomplete families | Add the four missing mutation families in a separate immutable engineering-only derived fixture; do not rewrite v1. |
| Correct abstention | No semantic result has disposition `abstain`; provider-unavailable arm abstentions do not prove this path. | absent | Add an explicit ambiguous/insufficient-evidence case whose executed policy result is abstain and whose engineering expectation is clearly non-gold. |

## Minimal completion seam

The least disruptive change is an optional, sealed offline execution closure consumed by
`runDiagnosticsCompaniesDemo`; the CLI surface and its atomic output handling can remain unchanged.
The closure should contain exact registered handles for: prepared source/projection artifacts,
structured extraction candidates and rules, claim bundles plus retained semantic observations,
generated-report ledgers, runtime principal bindings, policy inputs/decisions, and the expected
replay/output manifest. Its manifest must bind the v1 dataset digest and every artifact digest and
parent, declare `engineering_expectations_only`, `humanGoldScoringEligible: false`, and zero external
requests, and reject undeclared or missing closure members.

The coordinator then runs one fixed sequence:

1. Authenticate catalog, source preparation, and the offline execution closure before staging.
2. Replay captures/projections and execute native structured extraction checks, including at least
   one `exact` and one `normalized_text` field, retaining typed results in the field ledger.
3. Compose `VerificationClaimsApplicationService` with the closure's exact artifact/capture resolver,
   server-owned runtime-principal binder, projection grants, and selector resolver. Invoke
   `verifyClaims`; replay only the retained semantic observations that match the exact authorized
   case. Missing observations remain unavailable.
4. Generate each canonical report, construct a strict `VerificationReportLedger`, and invoke
   `verifyReport`. Report-wide conflict, qualifier, citation, authority/applicability, and consistency
   results must come from the verifier output rather than caller-authored gate booleans.
5. Execute the immutable derived mutation fixture for the four absent families and a deliberate
   abstention case. Keep its identity separate from frozen v1 and preserve the no-gold boundary.
6. Build the ten audit-path records from exact typed extraction/claim/report/mutation results. Each
   record carries case ID, artifact IDs/digests, check or verdict, and report/fragment navigation.
7. Seal the complete result and run `replayVerificationAudit` with
   `replayCapturedSemanticAssessment` plus the offline policy replay. Assert capture, selector,
   extraction, policy, report, and final manifest digests, with zero fetch/provider requests.
8. Generate the existing reports and ledgers from those results, re-read every output, publish the
   staging directory atomically, and preserve exit mapping: complete pass 0, measured quality failure
   1, unavailable/malformed fixture 2.

No new paid call is needed for this wiring. The retained 38 semantic observations are reusable only
under their exact bundle/assertion/runtime identities; they must not be rebound to a different report
or operation. The two unavailable assessments, human annotation/adjudication, complete provider-arm
coverage, and a reviewed v2 refresh remain external evidence dependencies. They must stay explicit
and cannot be replaced with synthetic success. Terra's separate engineering-only derived fixture can
cover the missing mutation and abstention mechanics without changing v1 or creating human labels.

## Implemented native closure seam

`packages/application/src/verification-diagnostics-offline-claims-report.ts` now exports
`verifyDiagnosticsOfflineClaimsReportClosure`. It accepts authenticated operation context, exact
claims/report requests, and a factory for trusted `VerificationClaimsServiceDependencies` over an
already admitted frozen closure. It creates independent execution and replay service instances,
invokes the production `VerificationClaimsApplicationService.verifyClaims` and `verifyReport`
methods, and rejects any canonical result mismatch. Returned claim results include their exact
assertions handle and native deterministic result; report results additionally include the exact
report/claim-ledger handles, report-wide mechanical result, and producer-declared coverage scope.
Each result retains matching execution/replay digests. The module never constructs a semantic judge,
reports zero external requests, and explicitly records semantic assessments as unavailable pending
separate exact-identity replay.

Focused tests execute both production paths twice, verify matching digests and report custody, reject
duplicate logical identities, and propagate an altered artifact digest rejection. They pass 2/2;
the application package TypeScript check also passes. Source digests:

- module: `sha256:1e2ecec857bfafc4bd116af1567db5678b0e10618fdb83da5708adb9dfc4940a`;
- test: `sha256:69147853671127e74c26767afdff114b5d59bb8dd739d26143622e1818422bbd`.

The companion offline-ledger builder and `verification-benchmark.ts` integration are coordinator-owned.
The focused review found that their trusted artifact/capture/grant closure must be cloned and frozen,
must reject mixed tenants, duplicate/inconsistent source-capture identities and multiple projections
for one capture, must check the authorization purpose, and should include source, projection and
transformation parents in local claim/report ledger lineage before final proof execution.

The coordinator applied those builder controls. A separate regression file now exercises the builder
against a reduced view of the real sealed v1 catalog and its registered source preparation. It proves
that changed registered bytes fail integrity checks, cross-tenant and duplicate captures fail closed,
mutating the returned grant/capture copies cannot widen the private resolver dependencies, and a
report attempting to bind two projection IDs to one capture is rejected. The focused builder suite
passes 4/4; together with the native claims/report closure suite it passes 6/6, and the application
TypeScript check passes. No network or provider adapter is used.

- builder regression test: `packages/application/src/verification-diagnostics-offline-ledgers-security.test.ts`,
  `sha256:4285d6c76ae35aadf3e0e5bf8a3e896779c16df447bc7951f0eeb50d429d4569`;
- focused command: `node node_modules/vitest/vitest.mjs run packages/application/src/verification-diagnostics-offline-ledgers-security.test.ts packages/application/src/verification-diagnostics-offline-claims-report.test.ts`;
- typecheck: `node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit`.

The separate v4 extraction replay remains outside the default frozen-v1 command. Its current replay
does recompute the selected output and field-ledger result, but the retained fixture still needs its
complete source/capture/projection/selector, request/profile/raw-response/envelope, and provider/model
observation custody validated before it can be counted as exact provider-output replay. It must also
enforce the exact failure predicate and avoid importing the benchmark coordinator if the coordinator
later imports the replay module. These limits do not reduce the v1 native source reload, claim/report,
conflict, or engineering-mutation mechanics; they prevent an unsupported provider-replay claim.

## EV162 independent bounded audit

The retained EV162 receipt was independently audited without rerunning the command. Its exact SHA-256
is `015ed86422dc69a0f55f28f801eef012232f6dded5f8264d105abd6c8353982b`.
All 29 declared output files exist as ordinary files and match both recorded length and SHA-256; the
directory also retains the expected auxiliary `checkpoints` directory, which is outside the declared
output file set. The 28-entry inner manifest is an exact receipt subset and excludes its own file.

The audit directly parses the retained outputs and establishes:

- 40 native claim results and three native report results all have equal execution/replay digests and
  `replayMatched: true`;
- all 40 field records pass both normalized and exact mechanics and have equal execution/replay
  digests with `matched: true`;
- the four measured engineering mutation families are exactly biomarkers, citations, institutions,
  and names; every original passes, every real mutated input fails, and every record reports mechanical
  degradation with source, projection, and transformation custody;
- the native reports preserve the two expected consistency groups: the two TruDiagnostic turnaround
  statements and the two Generation Lab system-count statements; and
- the terminal outcome remains `unavailable` with exit code 2, zero provider dispatches, no admission
  change, no human-gold eligibility, `engineering_expectations_only`, and no acceptance promotion.

The independent audit is retained at
`../internal/verification-offline-demo-EV162-independent-audit-20260908.json`,
`sha256:7008677934d9d7597c4e6ce177076b7d2b3575156c31c464ee12e8688184c4d2`.
Its verdict is limited to the EV162 bounded engineering evidence and explicitly records
`fullVr042Accepted: false`; it does not close the unavailable semantic, provider-arm,
authority/applicability, or live-refresh requirements.

## Source integrity reviewed

- Specification: `docs/specifications/verification-module.md`,
  `sha256:4d21db8cb5efdf361d8f50b0459c493b12c5b5c301ee6f9e72660b85d6566fee`.
- Local CLI dispatcher: `apps/cli/src/index.ts`,
  `sha256:e3ad71167d7e22ccf721f91328f19706f5660cc0d810f383b2465efce7651af8`.
- Local command: `apps/cli/src/diagnostics-demo.ts`,
  `sha256:afa9668e67b6a0114206f82a1e0280280845790176c64440f43a2c3f8d4ee394`.
- Demo coordinator: `packages/application/src/verification-benchmark.ts`,
  `sha256:083d5ebb9a0a72b1ca426ea211dcfdf3c16c522188aaf9727d186b2af3ae5455`.
- Typed quality gate: `packages/application/src/verification-diagnostics-quality-gates.ts`,
  `sha256:cd63b19f6789428b5c64b0bc95fc7e6bc96daa80c5f545a260de4e8780abfae9`.
- Semantic fixture/replay:
  `sha256:cc362348085c7090a73a472c0d3eea9f4ef008c7a7150c6c94fdafefde7da69e` /
  `sha256:0f7063a3cd774caeb4004ab0d55fde325aa94b48b4e587fda004c9b993e09dcc`.
- Native claims/report service: `packages/application/src/verification-claims.ts`,
  `sha256:4c057964fccfb593db1ae6cb24aa14845222e3aaa1aa140c61b50ca53dfa18a6`.
- Offline audit/policy replay: `packages/application/src/verification-replay.ts`,
  `sha256:f7addcbb0251c9c7b15248ea39dc924f904094af81548b6dcbcf177817e3b039`.
