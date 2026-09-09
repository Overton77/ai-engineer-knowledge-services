# Offline report diagnostics — EV163

The native offline verifier now passes all 40 claim mechanics, and 29 captured Luna assessments cover the assertions in the three generated reports. The reports retain their consistency failures. This is engineering evidence, not human-gold quality acceptance or report admission.

## Correction to EV162

EV162 executed and replayed the native claim requests, but its offline dependency factory omitted the projection selector resolver. All 40 native claims consequently replayed failures. The factory now includes the admitted resolver; the rebuilt installed CLI passes all 40 claim results with credentials removed and fetch disabled. The old receipt and sealed artifacts remain unchanged.

The correction preserves all 46 generated artifact registrations and bytes exactly: 40 claim artifacts, three report ledgers and three reports. Fresh verification reproduces the deterministic results. The known turnaround and system-count source wording conflicts continue to fail report-wide consistency gates.

## Captured report assertions

The exact prepared plan contains 11 TruDiagnostic assertions, nine Generation Lab assertions and nine comparison assertions. Each request contains one assertion and one necessary selected public excerpt. The maximum combined proposition/excerpt length is 1,476 characters and maximum serialized request is 4,042 bytes. The run uses Luna, 900 output tokens, serial execution, no automatic retries and a stop after three consecutive failures.

All 29 requests completed with matching model identity and a directly_supported judgment. Reported cost was **USD0.009572**, with no unpriced requests. The USD0.20 startup reservation remains conservatively recorded against the cohort cap. The immutable plan lock and startup reservation prohibit automatic redispatch.

These assessments come from a diagnostic preparation path over privately retained, mechanically valid report assertions. Only the two report-wide consistency gates may prevent ordinary admission while allowing diagnostics. Pointer, source custody, projection admission, runtime identity and other mechanical failures still close this diagnostic path. Diagnostic results cannot form an ordinary service-issued semantic batch.

## Evidence

Paths below are relative to the parent workspace:

| Evidence | SHA256 |
| --- | --- |
| `internal/verification-offline-demo-EV163-20260908.json` | `3cb0b7118b693ea69f8f1439e82f971c400f040b6050b6869359dda9fdbfaaef` |
| `internal/verification-EV162-generated-report-semantic-plan-20260908.json` | `57cf1e26e48dcaef65a851be8e9b7b0b49fe64ed6a896ff1a2d9a7f1a9b93045` |
| `internal/verification-EV162-report-semantics-live-20260908/receipt.json` | `6d38d6a74c28f848823ecde39002d5d1db3bf95ead4a4a5acf4b73564f524b8b` |
| `internal/verification-EV162-report-semantics-replay-20260908/receipt.json` | `24c5894db8331d1f164e5834fac05db0e4fda0faf0d9459ac2c744134db69585` |
| `internal/verification-report-semantics-independent-audit-20260908.json` | `b5ad680bab644396c7923ea500f157f1f4a0b37b438e1220bd8d84a67677c233` |
| `internal/verification-offline-demo-EV163-report-semantics-20260908.json` | `bf9c2a73701a981fec6d2f00ba33f712edae9b0955ef0ca5b5b1ad222c14efab` |

The independent live audit verifies approved request wires, 87 artifact references covering 77 unique files, byte lengths/digests, raw response/output equality, model/input identity, serial journaling and costs. The separate replay reproduces all 29 assessments with the Gateway credential removed and global fetch disabled.

## Remaining scope

Acceptance remains **31 proved, 8 partial, 7 missing**. No requirement is promoted solely by these diagnostic observations. Full provider/extraction coverage, remaining semantic mutation and claim coverage, authenticated human annotations, source rights/vendor approval, the sealed quality benchmark and final acceptance audit remain distinct requirements. Human review is still deferred as requested.

The portable fixture is sealed as `sha256:e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d` under `catalog/verification-semantic-fixtures`. It contains 29 records and 77 unique retained request/response/output files. Its loader authenticates file paths, sizes, digests, regenerated requests, recomputed observations and semantic assessments. Source/projection custody comes from the demo's separately authenticated preparation and native verifier; the response fixture alone does not replace that custody proof.

The installed demo retains 30 hash-checked output files, including `report-semantic-replay.json`, and displays assertion diagnostics in the audit report. Its captured integration proof completed in 47,171 ms with credentials removed, fetch disabled and expected exit 2. The original captured run identity remains unchanged; each new demo records its own run identity separately and matches the exact report/ledger artifacts before reuse.
