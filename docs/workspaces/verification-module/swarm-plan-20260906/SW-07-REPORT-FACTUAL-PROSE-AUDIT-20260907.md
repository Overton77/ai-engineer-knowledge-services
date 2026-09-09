# SW-07 report factual-prose audit — 2026-09-07

## Scope and source snapshot

Read-only review of the offline Diagnostics Companies mini-report generator against
specification §15.9.4 and acceptance row VR-043. No report source was changed.

- Generator: `packages/application/src/verification-benchmark.ts`, SHA-256
  `d26b7c3a389fac812fc35e57b7e17bf0b62d544c4b713ec27abe3a082fc79ab2`.
- Existing application coverage test: `packages/application/src/verification-benchmark.test.ts`, SHA-256
  `beb6dcfa8ed4c5b87654b71c1b823e8a19f9e88eeb2ff35ca98bf1bb38402ccd`.
- Existing local-file browser proof: `internal/prove-offline-report-navigation-browser.ts`, SHA-256
  `2056dffa9b3562221be5c04d75b9de406d5d38b77224e5a2c2bf5fbae176ac1a`.
- Existing installed-CLI harness: `apps/cli/src/diagnostics-demo.test.ts`, SHA-256
  `7dec97057757b899be8af6e17378c8fd1c74a6ea5f211a45c2246da34be6b76b`.

Section 15.9.4 requires the two company reports, comparison report, audit report,
and machine ledgers. Its required content includes contradictions, unanswered
questions, company versus research versus reviewer distinctions, and a claim-by-claim
appendix. Section 15.9.6 further requires no uncited material factual claims and
navigation from *every displayed verdict* to the captured fragment and back to the run
manifest. VR-043 therefore is not met by escaped citation labels alone.

## Current exact-linked material

`factual(caseId)` at generator line 451 emits the immutable case assertion plus its
catalog-owned citation label. The captured-statement lists at line 459 are the only
company-report prose constructed that way. `renderDiagnosticsOfflineReport` at lines
22–28 converts only those known labels into local appendix anchors. This protects HTML
escaping and avoids arbitrary link replacement, but does not cover paraphrases or
computed findings.

## Factual prose outside `factual(caseId)`

| Generator location | Current factual material | Required replacement/block |
| --- | --- | --- |
| 459 company-report limitations | The two timing values and lab-receipt event; 19-versus-21 conflict; interpretation of triplicate as repeated one-sample evidence. | A fixed `Conflict and qualification` notice followed by the exact existing `factual` assertions for each named case. Keep a fixed operational notice: “No population-accuracy inference is made by this report.” Do not paraphrase or introduce a clinical/population conclusion. |
| 461 comparison bullets | Five source/policy propositions: timing conflict, count conflict, triplicate scope, DunedinPACE publication scope, and interested-party promotional status. | Use canonical comparison blocks that contain one or more exact existing assertions (`factual` / immutable case IDs) and a separately labeled scope decision. The source propositions must not be rendered as new prose merely followed by a citation label. The non-recommendation/no-medical-advice sentence is a fixed report-scope notice. |
| 468 audit mode paragraph | Dataset/run execution mode, zero dispatches, unavailable provider arms, engineering-only scoring and human-gold ineligibility. | Treat as an explicit `Run operational notice`, linked to the run ledger / quality-gates artifact, not as source evidence. It is not a company or research claim. |
| 472–480 observed paths | Per-case mechanics, support, authority, policy, and abstention results. These are measured verdict facts. | Canonical verdict blocks need the exact case ID, exact result fields, local appendix anchor, and run/field-ledger reference. A case citation alone is insufficient when the appendix only exposes the baseline fields and not all reported result provenance. |
| 512 quality-gate summary and mutation results | Gate outcomes, exit disposition, and exact-source/corrupted-locator/digest-tamper outcomes. | Fixed `Operational quality-gate notice` blocks, linked to `quality-gates.json`, `adversarial-checks.json`, and run manifest. Preserve the statement that no policy/human authority changes, but classify it as an operational notice. Do not invent case evidence for gate state. |
| 516 replay scope prose | Fixture identity, zero new provider calls, scope limitation, and unavailable four-arm comparison. | Fixed replay-status notice with fixture/run references. It must remain separate from source evidence and retain its explicit unavailable state. |
| 518 semantic replay verdict lines | Dynamic semantic assessment verdict per case. | Add the semantic assessment to the appendix/coverage model and link each verdict block to that exact entry plus the underlying case fragment; until then render an explicit “semantic assessment navigation unavailable” operational notice rather than a bare verdict. |
| 492 appendix verdict and resolution text | Baseline support/policy/locator verdict and resolved/unavailable fragment state. | The selected fragment itself is the evidence target, but each rendered verdict must also have a run-manifest/ledger relationship in the canonical coverage output. `Back to run manifest` exists; add machine-audited report-span-to-case/result mapping rather than assuming the visible article is sufficient. |

Headings, report titles, fixed section labels, dataset/run digests, and static
non-advice/engineering-boundary language can remain explicit operational notices. They
must not be represented as source claims or given fabricated case citations.

## Concrete coverage-audit design

The coverage artifact should enumerate every HTML/Markdown/JSON report span as either:

1. `source_assertion`: exact case ID, immutable assertion text, one exact
   capture/fragment/projection/transformation identity, and matching appendix anchor;
2. `measured_verdict`: case ID, exact result fields, result/run ledger binding, appendix
   anchor, and run-manifest back-link; or
3. `operational_notice`: fixed allowed notice ID with its run/gate/replay artifact link.

Reject any emitted prose span absent from this inventory. This preserves conflict and
qualification content by retaining both exact source assertions rather than collapsing
them into a newly written summary. It also makes missing semantic-verdict navigation
visible instead of treating the source fragment as proof of the verdict.

## Reusable proof entrypoints

- `internal/prove-offline-report-navigation-browser.ts` already uses the dashboard’s
  installed Playwright package through `createRequire`, opens a generated local
  `verification-audit.html`, follows an appendix anchor, verifies an unavailable
  selector display, follows the run-manifest anchor to `run-ledger.json`, and rejects
  non-`file:` requests. Extend it to iterate the coverage artifact’s cited report spans
  and to assert every `source_assertion`/`measured_verdict` anchor resolves, then return
  via `#run-manifest` and verify the recorded run ID.
- `packages/application/src/verification-benchmark.test.ts:38-45` checks rendered
  anchors and local target existence. It should consume the same coverage artifact for
  all three report HTML files, their Markdown/JSON counterparts, and the appendix.
- `apps/cli/src/diagnostics-demo.test.ts:25-50` runs the built CLI outside the repository
  with network disabled, verifies the output inventory and hashes, and is the installed
  offline proof boundary for a browser extension.

No browser proof was run for this review. The existing proof only checks one audit
anchor and does not establish VR-043 coverage for all rendered factual material.
