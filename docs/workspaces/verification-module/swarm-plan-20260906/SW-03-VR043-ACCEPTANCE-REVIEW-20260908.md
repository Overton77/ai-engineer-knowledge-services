# VR-043 mini-report evidence-path acceptance review

## Scope

This is a read-only review of VR-043 only: “Every factual statement in generated mini reports has an inspectable assertion-to-fragment evidence path.” In specification §15.9.4, the two company reports and the comparison report are the mini reports; `verification-audit.html` is separately named as the audit report. This review therefore does not treat audit-report verdict/metric prose as satisfying, or defeating, the mini-report-only row.

It does not promote the broader §15.9.5/§15.9.6 requirements for semantic claim/report verification, clinical correctness, all displayed verdict navigation, conflict gates, or report-digest replay.

## Retained output and execution evidence

The installed output is `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-installed-offline-demo-3d2b5f0a-e6bd-4a9e-97ca-f81736f06604`. Its canonical coverage record is `report-coverage.json` (SHA-256 `770538f820b4ec1f516ea49978a06e18d8e8b22963bd137468806b857c305ed6`) and its evidence appendix JSON is SHA-256 `8ce9a240fe8bbe6b4e0e186875ab8833db4e97e94281b823fbf0e50d5cb0eb34`.

Two identical successful read-only browser-audit receipts exist:

- `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-offline-report-coverage-audit-28175a91-a8bf-4ee4-a235-390b4229404a.json`
- `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-offline-report-coverage-audit-48545314-cf5e-4873-a54a-ef53d22ece54.json`

Each receipt has SHA-256 `3bc02a56505d941e339e3e6d3f46624d33e33ecc988358f6eddbf20b4be0c678`. The audit rebuilt every report coverage object from the pinned v1 dataset and `field-ledger.json`; compared its canonical JSON, Markdown, and rendered HTML; checked every assertion link to the matching appendix case/capture/fragment/projection/projection-digest/transformation/selected-digest tuple; followed every link and the appendix’s run-manifest backlink in Playwright; and observed only `file:` requests.

The evidence counts were:

| Mini report | Factual assertion blocks | Mechanical resolutions |
| --- | ---: | ---: |
| TruDiagnostic research report | 11 | 11 |
| Generation Lab research report | 9 | 9 |
| Diagnostics comparison report | 9 | 9 |

Each canonical factual block is generated only from a frozen case ID. It records the exact assertion text, capture ID, fragment ID, projection artifact and digest, transformation artifact, selected-content digest, source class, Markdown UTF-16 span and text digest. Its HTML anchor targets `evidence-appendix.html#fragment-<caseId>`; the appendix exposes the resolved fragment and returns to `#run-manifest` / `run-ledger.json`. Fixed headings and notices are separately typed and cannot carry caller-supplied prose.

## Conclusion

**VR-043 is proved for its stated mini-report scope.** The successful artifact-level and browser-level audits establish an inspectable assertion-to-fragment path for every factual block emitted by all three generated mini reports. Repeated facts in the comparison report are independently represented and navigated; dataset cases omitted from a given report are recorded as unmapped rather than silently represented.

This conclusion is deliberately narrow. It does not establish that those source assertions are semantically supported, independently corroborated, clinically correct, or policy-admissible. It also does not promote the separate `report_generation_and_citations` or `verdict_fragment_navigation` quality gates, which cover wider material including the verification audit’s measured verdicts and other §15.9.6 requirements. The present mini reports avoid that scope by rendering only fixed operational context plus exact dataset-derived assertion blocks.

Reviewed current source hashes: `packages/application/src/verification-benchmark.ts` `062b6396171a1e31c8b3d461152f9aea420fd1ba2e970f74fd1611282cb890d3`; `packages/application/src/verification-diagnostics-report-coverage.ts` `1cb74e51fae41454371302e80a56454ff2f3d298b1964cb0543c10db99e3ce3e`.
