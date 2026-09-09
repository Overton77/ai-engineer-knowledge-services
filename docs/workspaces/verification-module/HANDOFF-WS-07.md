# WS-07 benchmark, experiment, and report handoff

**State:** owner implementation complete; bounded machine/source audits accepted, coordinator browser review and formal acceptance remain open.  
**Owner:** verification-benchmarks-agent.  
**Date:** 2026-09-05.

## Delivered boundary

WS-07 now has strict benchmark contracts, immutable Pilot dataset versions, authenticated provider-input grants, annotation/adjudication and human-gold promotion gates, provenance-grouped split tooling, checkpointed experiment execution, clustered statistics, exact offline response replay, local Postgres/private Storage custody, structured field ledgers, and JSON/Markdown/HTML reports. The delivered Pilot is a 43-case agent-reviewed engineering diagnostic. Forty cases were eligible for the bounded D013 provider-input grant; the prior V3 smoke case remains separate protocol evidence, and 39 V4 cases formed the fresh extraction matrix.

This work does not establish provider quality, clinical validity, population accuracy, or production readiness. The Pilot has zero human-gold cases, one repetition, four source clusters, no admitted probability calibration, no production shadow traffic, and incomplete source-content coverage. Human identity authentication, two blinded annotations, expert adjudication, calibration, production promotion, and cross-surface service admission remain WS-08/11/12 work.

## Frozen Pilot and canonical custody

The accepted V4 catalog is `catalog/verification-benchmarks/diagnostics-companies-pilot-v4`. It preserves the V3 provider-visible assertion, exact fragment, qualifiers, source and license fields while adding exact case-input and explicitly agent-generated engineering-expectation artifact bytes. The machine-readable `v3-to-v4-diff.json` records the successor. Dataset version `292cdfbf-21c5-5109-aabe-e681106db717` is persisted with semantic manifest digest `sha256:a6bc1cf3ecbb335e4f5ef49165798d29ce937a9324f2a1ba7d9768f23ad7feee`; the raw manifest-artifact digest is stored separately.

Coordinator review hydrated all 87 registered V4 artifacts and compared every persisted case row, including inline input, expected and metadata JSON. Receipt `internal/verification-benchmark-v4-persistence-review-f89a1d05-5f82-473f-825c-32988174c391.json`, SHA-256 `2cca8d2f9963f81193f344faced641817bb6c17eaee030bb87ac5c7e1eeccce5`, accepts the dataset bytes and persistence. The earlier materialization review is `internal/verification-benchmark-v4-review-b4b84a37-fb2b-4509-af6d-102ba09f0006.json`, SHA-256 `a81a2109edc9ae1cc50b3f0d6749a903c31d5d627909efb396cce3e986401c0e`.

The D013 grant permits one atomic assertion, one necessary public exact fragment and minimal qualifiers per case, with a combined 2,000 UTF-16-unit case-content cap and a 10,000-byte complete-wire cap. It excludes full pages, PDFs, archives, restricted handles, tools and unrelated prompt/schema content. Provider-visible identifiers are opaque. The runtime binds the sealed dataset, case and grant digests, exact trusted system prompt, output-schema digest, provider/model, token cap and payload. The independently reviewed 117-request fake-fetch matrix stayed below 3,878 bytes and rejected all unauthorized-content variants.

## Paid extraction experiment

The sealed experiment manifest is `catalog/verification-benchmarks/diagnostics-companies-pilot-v4/experiments/extraction-v1/manifest.json`, digest `sha256:c7d1588f870bbae4f1b5dd1ae590ad547ea85bfc6ca48f798c6f6b40700707c4`. Its fresh call plan is fixed at 39 cases by three roles, concurrency one, no automatic retry:

- Luna extraction plus actual deterministic selector/field mechanics;
- Interfaze extraction plus the same mechanics;
- Haiku semantic judgment used by the Interfaze cascade and Luna/Interfaze consensus-abstention composition.

The runner is `scripts/prove-verification-benchmark-extraction-live.ts`. It requires loopback Postgres and Supabase, the exact admitted V4 handles, the existing successor budget and the immutable dispatch review receipt before credentials. It exports complete request/raw/envelope/precontext/observation/field-ledger bytes and registered handles plus accounting state before advancing. Resume replays captured responses through the actual adapters with fake fetch and rechecks field mechanics, observation and ledger cross-bindings. Captured schema-quality failures continue in the denominator; custody, accounting, budget or infrastructure failures stop the run.

Run `feeb824c-e4d0-597f-abd7-7667fa080869` has identity `sha256:9a1efd987f517f1cf2a9bfe3e7b3c4df9895d1847b86ed9ed9f2c215bcc5cef5`. Its immutable pack is `internal/verification-benchmark-extraction-live-feeb824c-e4d0-597f-abd7-7667fa080869/run-replay-pack.json`, file SHA-256 `dde2bc50d64680ed1d768e662544cfb665985bdbd6d544481c2ee5244040d0e9`, replay digest `sha256:9cff215cb598971a1b777cf7bc4d5f0e3ddce6e220bf2b37f50cdd616699bdb1`. A full resume performed zero extra provider calls.

The run made 117 calls: 110 returned admitted structured output and seven retained typed response-schema failures. Six failures were Interfaze and one was Haiku on `gl-repeatability-mutated`; all seven were HTTP 200 `PROVIDER_RESPONSE_SCHEMA_INVALID`, with no HTTP transport failure. Actual Gateway cost was 99,754 microUSD. All 39 Interfaze calls retain unknown billing state and 1,950,000 microUSD of reservations. Sum of recorded call latencies, including failures, was 490,923 ms.

Coordinator replay `internal/verification-extraction-independent-replay-588da3f2-4d4e-4a84-826e-09104e3fa84a.json`, SHA-256 `fbd6904fd5d55f413700945e22b6ba172deeff46dc29f760c0f447ac82b5fd0a`, re-executed the actual adapters for all 117 raw responses with zero network and verified 709 unique exported artifacts. Canonical read-only audit `internal/verification-extraction-custody-review-afa72941-8e8a-4bf8-8868-594bdc8d6e58.json`, SHA-256 `d464b181f13e763529fa43fa08707b9c4a2bd2415faa35e89bd66d1f35884064`, hydrated all 709 Postgres/Storage registrations, matched the 117 attempt rows and confirmed the succeeded mission and exact successor budget balances.

I independently source-reviewed the coordinator-authored replay scripts at final source hashes `0ab3e06be5ed982bfda8cdd73ac69680a22987ebbac5da8b2a72f0cce589cbf0` (`internal/verification-extraction-independent-replay.mts`) and `874a9e0c5dac60eb2fcd1094c3739d8f76b9ba2277f17fa1e045f98620cd4ec1` (`internal/verification-extraction-custody-review.mts`). The first replaces global fetch with a hard failure, feeds saved HTTP status/body bytes through the original adapters and exact wire guard, checks precontext and field ledgers, and reports zero external requests. The second obtains only local Supabase status, rejects non-loopback endpoints, uses a trusted resolver for full-handle/byte hydration and executes its SQL transaction read-only. The offline script does not itself prove canonical DB/Storage custody, and the custody script does not replay provider adapters; their accepted receipts cover those complementary boundaries.

## Reports and measured results

`scripts/report-verification-benchmark-extraction-live.ts` generates the final owner V5 pack at `internal/verification-benchmark-extraction-reports-v5-feeb824c-e4d0-597f-abd7-7667fa080869`. The manifest file SHA-256 is `b5eb9dc6d3fd3bff6d76da41708891f958359d6792c48786389dc705e1e75596`; its semantic manifest digest is `sha256:6f01666e188f8692cc3d5307cff66be0b84c82a882e171d47d6eb3f8844c7987`. Nineteen listed files plus the manifest contain TruDiagnostic, Generation Lab, comparison and verification-audit reports in JSON/Markdown/HTML, along with claim, field, source, provider-call, arm-result, run and metric ledgers. V4 remains immutable; V5 changes only safe HTML rendering of Markdown strong markers.

Coordinator artifact audit `internal/verification-report-artifact-review-fd2402de-2802-421a-ad65-753c064bd1b4.json`, SHA-256 `a2cc870c60eebabab41701cef73cb085e53134816625eb2f8a447dd8e4613eeb`, accepted V4's complete data and navigation. The unchanged audit harness passes V5 with 20 files, 140 resolved HTML anchors, 38 literal narrative occurrences, 16 labelled adversarial inputs, 117 call attributions and exact typed failure/cost material: `internal/verification-report-artifact-review-23819c8b-3838-4205-aa97-ce975e278dc1.json`, SHA-256 `7f52db35634dc4ad2225ec3dd457e662228732fdc85b01b4bb4bc42070feea4b`. Browser visual review of the V5 cosmetic successor remains a separate coordinator check.

Only literal non-adversarial source assertions are rendered as company facts. Mutations appear explicitly as adversarial test inputs with arm outcomes. Each factual narrative assertion ID links to an exact evidence anchor containing a compact excerpt, selector, capture ID, fragment ID and selected-content digest. `narrativeCitationCoverage` counts distinct cited factual narrative assertion IDs; repeated rendering of the same assertion in topical sections is not a new denominator. Every rendered occurrence also includes its evidence link, but occurrence-weighted coverage is not separately reported. Source-content recall and claim-selection completeness remain unmeasured.

The field ledger retains candidate value, provider evidence quote, comparison rule, derived selector, capture/fragment and artifact handles, checkpoint and verification checks. The live extraction plans used exact leaf comparisons. A separate zero-network deterministic fixture proves a value-changing whitespace normalization through the real `verifyExtractionFields` implementation: `internal/verification-benchmark-normalization-618673e3-ced6-4cf5-ab58-25d415af1395.json`, SHA-256 `a4228a4963d38fd9223b17d720cc253150ffbc4b35aa387a8a2bc31ee8eb2149`. Its hardcoded UUIDs and bytes are test-fixture identities with no registered CAS/DB custody; full admission is pending WS-08.

Arm metrics use all 39 cases and Wilson intervals. Luna schema validity was 39/39 and field mechanics 33/39. Interfaze schema validity was 33/39 and field mechanics 29/39. The cascade inherits 33/39 and 29/39; consensus field mechanics was 23/39. These are engineering-expectation diagnostics, not accuracy. All arms have a human-gold denominator of zero and `qualityClaimEligible:false`. Four source clusters give an exact 16-assignment sign-flip test; Holm adjustment covers the three prespecified arm hypotheses. The cluster bootstrap is case-weighted while sign-flip is equal-cluster-weighted. Case-level McNemar is nominal/exploratory because its independence assumption is unfulfilled. Calibration is explicitly not computable.

The audit report validates ten named paths against actual result/checkpoint material: exact field, synthetic normalized field control, precise citation, qualifier omission, conflict, promotional authority, publication overextension, corrupted locator auxiliary replay, contradicted mutation and clean consensus abstention. The corrupted-locator and normalization paths are clearly separate deterministic auxiliary fixtures; they are not silently counted as paid live calls.

## Benchmark V1 preparation

The catalog already contains 180 unique source-bound candidates in `benchmark-v1-candidate-pool.json`. New strict contracts admit only 150–300 unlabeled, unfrozen, non-independent candidates and reject duplicate candidate/fragment IDs, count inflation, label promotion and unknown fields. `packages/evaluation/src/verification-benchmark-v1.ts` adds strict import, a case-specific curation queue, provenance-connected split planning and structural readiness assessment. It never promotes human gold; authenticated reviewer admission remains an application boundary.

The sealed preparation pack is `catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-preparation-v3`. Its manifest file SHA-256 is `46d9696e1de3b8dc487489210cc5d6dd0db0ecbe1edcb7dd1907586f3fd3ab76`, with semantic digest `sha256:a0c1dbfc0fd08053cde2fb6209598a19c8c2c797f5929ddeb164553dcabaab4e`. The successor real-pool proof is `internal/verification-benchmark-v1-tooling-fc3f6d69-0cf1-4c83-9ae7-681af058de75.json`, file SHA-256 `2ea4e1a04aadaae18f8eeb97a600ee2e49a2090bc465db639c9b0beabfddd367`, semantic digest `sha256:3d435254e30e50c3b51db4fafc617c2a3801c96a965b3b1f05ff46561ee9c4b2`. V1/V2 predecessor packs and earlier proofs remain immutable. The V3 proof rehashes the frozen source-preparation manifest (`sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e`), rehashes the 1,186-row selector registry (`sha256:d1781f1c5b32dff5fff3a27251c9072386f1673e98d4fb9210090fc4ef6b9831`) and matches all 180 candidates by capture, projection, selector, selected-content digest, source class and source key. The pack emits 180 review items and a deterministic no-leakage split over six indivisible company/publication-study components. The provisional 90/14/76 partition is structurally valid but materially imbalanced because two company clusters dominate; curators must add independent provenance components or accept and document this limitation before freezing Benchmark V1. Candidate atomization, two blinded human annotations, expert adjudication and registered case artifacts remain pending.

`assertFrozenVerificationBenchmarkDataset` proves internal hashes and successor structure only. It does not authenticate human identity or persistence admission. Any service metric or promotion flow accepting caller-supplied resealed datasets must first require the admitted persisted dataset and trusted reviewer authorization in WS-08/11.

## Reset incident and recovery boundary

During dataset migration work, an unnecessary local `db reset` destroyed the then-current local database metadata. The incident, exact command/timing and preservation/recovery custody are recorded in `LOCAL-RESET-RECOVERY.md`; old live entrypoints were retired. No historical provider-attempt rows were fabricated. The coordinator preserved the Storage volume and independently accepted eight registered recovery wrappers with the original three smoke request/raw/envelope bytes, explicit new custody, actual recovery lifecycle timestamps and a single successor budget reduced by all pre-reset settled/held liability. Receipt `internal/verification-recovery-independent-review-225e9af4-6a76-4376-8749-8db9077b210e.json`, SHA-256 `438ae9b9baade4f0d126755e329ce59727425e10e329f27eda70b6016eb49799`. The original database registrations remain lost and are not described as restored.

## Commands and next integration

Focused owner checks use the installed toolchain directly while the shared package graph is converging:

```powershell
node_modules/.bin/tsc.CMD -p packages/contracts/tsconfig.json --noEmit
node_modules/.bin/vitest.CMD run packages/contracts/src/verification/benchmark-v1.test.ts packages/contracts/src/verification/verification.test.ts
node_modules/.bin/tsc.CMD -p packages/evaluation/tsconfig.json --noEmit
node_modules/.bin/vitest.CMD run packages/evaluation/src/verification-benchmark-v1.test.ts
node_modules/.bin/tsx.CMD scripts/prove-verification-benchmark-v1-tooling.ts
node_modules/.bin/tsx.CMD scripts/prove-verification-benchmark-normalization.ts
node_modules/.bin/tsx.CMD scripts/report-verification-benchmark-extraction-live.ts
```

The application exports `runDiagnosticsCompaniesDemo` for WS-08 composition and exports the benchmark/grant/experiment/replay helpers used by the runner. WS-08 still needs the one-command CLI/API/MCP/worker route over the same application behavior. Report registration should occur only through the canonical artifact-consumer boundary; the V4 report pack is currently immutable local evidence.

Final `corepack pnpm verify` exits zero after the 92-migration convergence: 43/43 typecheck tasks, 43/43 test tasks and 24/24 build tasks. Contracts have 27 passing tests, evaluation 32, application 28, verification 67 and MCP 10 with one documented DB integration skip. Immutable log `internal/verification-ws07-final-verify-6b726f7d-74e0-4fc4-b879-95a23f61a243.log`, SHA-256 `ba4f3f10c8810b5f1d58e0b0551c60c218546afab09175555e051a266941d1d8`.
