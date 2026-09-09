# Coordinator WS-05 review ledger

Early source review while implementation is active. These findings were sent to the owner before handoff; acceptance requires reviewed fixes and targeted regressions. This table records the initially inspected behavior, not a claim that it remains in the final source.

| ID | Finding | Required proof | Status |
| --- | --- | --- | --- |
| SP-01 | Override guard blocks only pass, allowing pass_with_warnings to bypass a hard mechanical or unknown-critical failure. | Neither accepted outcome can override the non-overridable gate. | source reviewed; targeted regression passed |
| SP-02 | Recorded sufficient authority/conflict booleans can disagree with underlying source assessments. | Policy derives or verifies the authority decision, population/sample and publication applicability, conflict state and matching claim scope. | source reviewed; targeted regression passed |
| SP-03 | Judge input capacity omits entity bindings and IDs; output stringify precedes resource bounds. | Complete request budget and bounded pre-serialization walk reject oversized/deep outputs before allocation. | source reviewed; targeted regression passed |
| SP-04 | Exported semantic verifier accepts a structurally fabricated AuthorizedSemanticCase and declares provenance satisfied. | Opaque runtime admission or private helper; trusted composition must recompute and bind mechanics. | source reviewed; targeted regression passed |
| SP-05 | Policy introduces a localeCompare canonicalizer instead of the authoritative JCS implementation. | Reuse one locale-independent canonical implementation and test digest parity. | source reviewed; targeted regression passed |
| SP-06 | Report's independent-source count includes all distinct families, including first-party/promotional ones. | Separate distinct family count from independently assessed sources. | source reviewed; targeted regression passed |
| SP-07 | Citation precision excludes invalid/misplaced pointers; high-severity support ignores pointer validity. | False citations lower total-citation correctness and cannot cover critical assertions; any conditional metric is explicitly named. | source reviewed; targeted regression passed |
| SP-08 | Report arrays are unbounded and repeated group-array copies are quadratic. | Bounded reports/assertions/citations/qualifiers and linear grouping. | source reviewed; targeted regression passed |
| SP-09 | Qualified support can coexist with a contradicted NLI label or conflicting fragment declarations. | Consistent verdict/rubric field truth table rejects the contradiction. | source reviewed; targeted regression passed |
| SP-10 | A failed metric-only bundle with zero assertions reduces to policy pass. | Overall hard mechanical failure fails regardless of assertion count; valid metric-only behavior is explicit. | source reviewed; targeted regression passed |

General parser-admission enforcement in bundle replay remains the separate integration gate described in ADMISSION-REVIEW.md. Human labels, real NLI/model execution, calibration, policy promotion and production shadow evidence cannot be inferred from synthetic tests.

## Coordinator bounded acceptance

SP-01–10 are resolved for the bounded core. SP-02 also requires population/product applicability on the same qualifying independent source; a mixed independent-study/company-claim regression passes. The application trust boundary must still recompute mechanics, validate assessment provenance and enforce parser admission, as specified in SERVICE-COMPOSITION-BRIEF.md. Opaque semantic-case admission is process-local admission within trusted composition, not authentication of public callers.

Independent focused tests: verification 60/60 and policy 11/11. Log internal/verification-coordinator-ws05-focused-a98d383e-0aa2-4a8b-a8b1-69369add36a7.log SHA-256 9a0a1d116aee0d6d718e8d964348bd3930e21adb1d0809a5d754f0974ecb841d. Independent real Postgres/Storage proof: 26/26 checks, including shared application policy recomputation and recorded-input tamper rejection. Catalog receipt verification-proofs/verification-persistence-4a35e7da-11e9-4a7a-b61a-d17e3447e3b6.json SHA-256 3f75b961eff44e01c6546d7a209dd9cc8864b3df4ee6fc8900abe468cec1d9ff; log internal/verification-coordinator-ws05-persistence-b917dae5-d646-4bb7-b0c6-1e285f02dbde.log SHA-256 cb42495e5c987ed9323da148959fc0ae0b64f360619dfa099f8a9eff77c7065e.

The initial independent proof failed because the main local database lacked migration 20260905022000; its immutable failure log 9f070077-7472-412f-8d3e-11c075f4669e is retained. After the owner applied the canonical pending local migration without reset, the fresh independent run above passed. EV-028 separately proves all 80 migrations on an empty isolated database. Vendor 0.2.1 parity passed for 80 migrations and five TypeScript sources; receipt internal/verification-policy-vendor-parity-20260906.json SHA-256 e3c7088f361809b913b90404a4e0d9acb2d147963fcc5d8e830c2e7d6dd10597.

Coordinator matched authoritative full verify log internal/verification-ws05-authoritative-full-verify-20260906-40e1ba56-9e80-4483-b782-31590e1c8329.log SHA-256 1cae515507eddd9c839b59dd0e07190b1f66097e3adb1dd81fef09d119409aad: 43/43 typechecks, 43/43 test tasks, 24/24 builds. Whole WS-05 remains partial for live judge execution, semantic decomposition quality, bias/calibration, human gold and service integration; no synthetic fixture establishes those claims.
