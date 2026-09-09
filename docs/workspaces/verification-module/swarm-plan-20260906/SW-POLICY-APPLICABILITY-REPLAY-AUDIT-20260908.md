# Policy/applicability replay audit — 2026-09-08

## Decision

No new policy replay helper was added. The existing production APIs can replay deterministic and policy decisions only from a complete `VerificationAuditBundle` with authenticated policy bytes, recorded policy-input bytes, deterministic result, manifest, and retained artifact resolver. `packages/application/src/verification-replay.ts` composes `replayAuditBundle` with `replayVerificationPolicy`; `packages/verification/src/provenance/replay.ts:141-184` requires the policy artifact, recorded inputs, exact deterministic replay, and an injected semantic replay port before policy replay is meaningful.

The retained semantic evidence is therefore usable for exact semantic assessment replay, but it is insufficient by itself for a production policy/applicability call. The semantic service deliberately emits `sourceAuthority: "not_assessed"`, `worldCorrectness: "not_assessed"`, and does not infer product applicability (`packages/verification/src/semantic/verification.ts:224-234`). The 38 claim records and 29 report diagnostics do not supply the signed policy-input artifacts and source-assessment records required by the canonical policy replay path.

## Frozen v1 applicability scope

The frozen v1 catalog contains 40 cases: 28 `first_party`, 4 `first_party_marketing`, 2 `interested_party_comparison`, and 6 `publication` source classes. The promotional/publication cases are:

- `gl-historical-wording-source` and its mutation
- `gl-same-page-footer-source` and its mutation
- `pace-definition-source` and its mutation
- `pace-cohort-source` and its mutation
- `noise-method-source` and its mutation
- `gl-interested-comparison-source` and its mutation

These source classes alone do not establish independence or product applicability. The canonical `assessSourceAuthority` API requires structured `VerificationSourceAssessment` records with claim scope, evidence scope, publication relation, source organization/family, independence, directness, freshness, and applicability (`packages/verification/src/authority/assessment.ts:24-86`). The frozen catalog supplies evidence source class and excerpts, but no retained source-assessment artifact that can truthfully populate those dimensions.

The existing offline ledger builder intentionally marks this boundary: its generated evidence uses `applicability: "unknown"`, and its intent says semantic support remains unassessed (`packages/application/src/verification-diagnostics-offline-ledgers.ts:43-47`). The benchmark path likewise uses the lexical `sourceAuthority` baseline of `insufficient` and records the authority/applicability gate as unavailable (`packages/application/src/verification-benchmark.ts:354-359`, `:595-596`). A helper that called the policy evaluator with synthetic “sufficient” or product-applicability values would fabricate the missing evidence.

## Exact next input

To execute the canonical policy call, retain a source-assessment artifact per assertion (including independent source-family identity and applicability/publication relation), the signed policy artifact and policy-input artifact bound to the same run/deterministic-result digest, and the full audit bundle's artifact resolver closure. With those inputs, use `replayVerificationAudit` and `createOfflineVerificationPolicyReplayPort`; until then, report source support and lexical mechanics separately from authority, independence, and product applicability.

## Bounded native policy replay implementation (2026-09-08)

Implemented a new offline-only seam in `packages/application/src/verification-diagnostics-policy-replay.ts` with focused tests in `packages/application/src/verification-diagnostics-policy-replay.test.ts`. The helper calls the production `assessSourceAuthority`, `evaluateVerificationPolicy`, and byte-based `replayVerificationPolicy` APIs (source: `packages/verification/src/authority/assessment.ts:24-111`, `packages/policy/src/verification-policy.ts:36-172`). It emits canonical content-addressed policy bytes, recorded policy-input bytes, and an evidence-closure byte artifact binding each case digest, assertion, fragment, capture, source family/organization, source class, claim scope, evidence scope, and publication relation.

The source-class mapping is deliberately bounded: first-party ownership is retained as same-organization, marketing/comparison as promotional/interested-party, and publication ownership as unknown. Freshness, jurisdiction, license, and applicability remain false/unknown; no source class is promoted to independent product validation. `criticalFactsKnown` remains false, and metric results are rejected unless separate metric policy metadata is supplied (`DIAGNOSTICS_POLICY_REPLAY_METRIC_METADATA_REQUIRED`) rather than inventing risk/use labels. The helper requires one case per deterministic assertion, rejects duplicates/coverage drift, and proves evaluator/replay decision equality. Therefore the retained v1 semantic records can now be executed through policy for bounded diagnostic evidence, but the resulting `review`/`abstain` outcome remains an engineering replay and does not supply human gold, independent authority, or product applicability.

Validation: `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-diagnostics-policy-replay.test.ts` (3/3 passed); `corepack pnpm --filter @aiengineer/knowledge-application typecheck` (passed). No provider, cloud, database, catalog, or frozen-label mutation occurred. Remaining evidence gap is retained per-assertion source assessment/policy-input custody from the actual v1 run; the helper cannot infer those facts from lexical source class.

## Authenticated semantic-to-policy composition (2026-09-08 successor)

Extended `packages/application/src/verification-diagnostics-semantic-replay.ts` so each successful native semantic replay returns the authenticated original deterministic result plus bundle assertion/capture/edge identity, source family/class/key, capture/fragment IDs, selector, selected-content digest, and source/projection artifact handles. This metadata is emitted only after the existing exact bundle replay, selector resolution, and deterministic drift checks pass; legacy 38-case IDs remain unchanged.

Added `packages/application/src/verification-diagnostics-policy-composition.ts` and `packages/application/src/verification-diagnostics-policy-composition.test.ts`. `composeDiagnosticsPolicyReplay()` calls the canonical policy replay helper once per authenticated original case and emits JSON-safe canonical policy/input/closure bytes, digests, decision/replay equality, and provenance links. Its default is explicitly `diagnostics-policy-engineering-replay-v1`, not an approved historical policy. It uses a bounded descriptive `source_summary` scope, unknown evidence/publication relation, unknown source organization, low/internal-research engineering context, and retains `criticalFactsKnown:false`; it never copies catalog expectations or promotes source ownership to independence/product applicability.

Focused validation: policy replay + composition tests **4/4 passed**. Application typecheck showed no diagnostics for the new policy replay/composition or semantic replay files; the package still has pre-existing unrelated errors in `verification-diagnostics-company-fields.ts` and its tests. No provider, cloud, database, catalog, or frozen-label mutation occurred. This composition is ready for a benchmark-side caller to emit a policy-replay artifact, but it is not an acceptance promotion or human-gold result.

## Exact proposition scope correction (2026-09-08 successor)

Corrected `verification-diagnostics-policy-composition.ts` to bind high-risk scopes only under exact case-ID plus normalized proposition guards: `pace-definition-mutated` maps to `product_validation`; `noise-method-mutated` maps to `comparative_superiority`; `gl-interested-comparison-source` maps to `comparative_superiority`. All other propositions use the explicitly declared engineering fallback `source_summary`/low-risk scope and are not treated as truth labels. Company-owned evidence uses `company_statement` with `not_publication`; publication evidence uses unknown evidence scope and publication relation. Organization identity, applicability, freshness, and independence remain unproved.

Composition output now includes `claimScope`, `riskClass`, and canonical `sourceAssessmentStatus`, allowing withheld versus unknown policy state to be audited. Added tests for exact promotional/publication scope rejection, canonical input digest round-trip, and semantic identity mismatch. Focused policy replay/composition tests: **6/6 passed**. New files remain offline-only; benchmark and frozen labels were not edited.

## Final integration review (2026-09-08)

Reviewed the current benchmark integration in `packages/application/src/verification-benchmark.ts:488-490,633-670`, the exact scope-drift guards and source assessment projection in `packages/application/src/verification-diagnostics-policy-composition.ts:86-145`, and the read-only field renderer in `packages/application/src/verification-diagnostics-field-view.ts:1-15`.

No actionable provenance or bypass defect found. The benchmark passes authenticated semantic replay results into policy composition without renaming assertion/case identities; the output retains policy/input/closure digests and the audit text states the policy is engineering-only with independence and publication applicability unestablished. Known mapped propositions are guarded by case ID plus normalized exact proposition and throw on drift. Policy replay decisions are canonical re-evaluations, and the CLI assertions verify decision/replay equality, canonical input digest, non-pass outcomes, and semantic assertion identity. The field view only renders already verified leaves, escapes displayed values, includes source/lineage/derivation details, and links each case to the existing `evidence-appendix.html#fragment-<caseId>` anchors generated by the benchmark.

The output inventory count of 33 is consistent with the current conditional files: policy replay, semantic replay, report semantic replay, native/field/report ledgers, bundle, and manifest. No frozen labels or acceptance state are changed by this integration. No provider, cloud, database, or broad test execution performed for this review.

## HTML text-range selector compatibility review (2026-09-08)

Reviewed `packages/contracts/src/verification/selectors.ts:50-63`, `packages/verification/src/selectors/resolvers.ts:78-119`, and the focused resolver coverage in `packages/verification/src/selectors/resolvers.test.ts:15-27`.

No actionable compatibility or security defect found. `textRange` is optional, so existing HTML selectors retain their previous resolution behavior and selector digests change only when the new field is actually present. The resolver first requires a uniquely selected visible DOM node, validates projection digest and optional canonical fallback, then applies the half-open range. UTF-16 bounds are checked for length, safe integer values, and surrogate splitting; invalid/empty ranges resolve as invalid. Returned ranges identify the DOM-node UTF-16 coordinate space, while selected-content digest is recomputed from the sliced bytes. Existing canonical text fallback remains a whole-node check before slicing, so the range cannot bypass uniqueness or fallback agreement. No changes were made.
