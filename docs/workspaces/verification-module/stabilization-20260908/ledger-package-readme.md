# Ledger: `packages/verification` README

**Date:** 2026-09-08  
**Scope:** Document `@aiengineer/knowledge-verification` from source. No `.ts` / test edits. No builds or tests run. No `.env` reads.

## Written

- `packages/verification/README.md` (new, 188 lines)
- `packages/verification/package.json` — added `description` only
- this ledger

## Files read

### Spec / workspace

- `docs/specifications/verification-module.md` (executive decision §1; governing model §5; architecture §6; contract model §8.3–8.6)
- `docs/workspaces/verification-module/work-items.yaml` (skim)

### Package facade and metadata

- `packages/verification/package.json`
- `packages/verification/tsconfig.json`
- `packages/verification/src/index.ts`
- `packages/verification/src/deterministic/index.ts`
- `packages/verification/src/selectors/index.ts`
- `packages/verification/src/extraction/index.ts`
- `packages/verification/src/provenance/index.ts`
- `packages/verification/src/claims/index.ts`
- `packages/verification/src/authority/index.ts`
- `packages/verification/src/semantic/index.ts`
- `packages/verification/src/providers/index.ts`
- `packages/verification/src/prototype-compat.ts`
- `packages/verification/src/prototype-bundle-compat.ts`

### Main modules (read or skim)

- `src/deterministic/canonical.ts`, `decimal.ts`, `engine.ts`, `selectors.ts`
- `src/deterministic/testing/prototype-parity.fixture.ts`
- `src/selectors/resolvers.ts`, `projections.ts`
- `src/extraction/verification.ts`, `evidence.ts`, `schema.ts`, `source-component.ts`
- `src/provenance/seal.ts`, `attestation.ts`, `model.ts`, `replay.ts`, `policy-inputs.ts` (signatures)
- `src/claims/decomposition.ts`, `report.ts`
- `src/authority/assessment.ts`
- `src/semantic/verification.ts`, `rescue.ts`, `attribution.ts`
- `src/providers/semantic-judge.ts`, `gateway.ts`, `registry.ts`, `bounds.ts`, `interfaze.ts` (partial)

### Tests skimmed

- `src/deterministic/deterministic.test.ts`
- `src/selectors/resolvers.test.ts`
- `src/semantic/verification.test.ts`, `diagnostics.test.ts`
- `src/extraction/extraction.test.ts`
- `src/provenance/provenance.test.ts`, `attestation.test.ts`

### Contracts (selector / judgment vocabulary)

- `packages/contracts/src/verification/selectors.ts`
- `packages/contracts/src/verification/model.ts` (`JudgmentSchema`)
- `packages/contracts/src/verification/index.ts`
- `packages/contracts/package.json`

### External path verification (`ls`)

Confirmed present:

- `packages/application/src/verification-metrics.ts`
- `packages/application/src/verification-benchmark.ts` and `verification-benchmark-*.ts`
- `packages/application/src/verification-diagnostics-*.ts`
- `packages/evaluation/src/verification-benchmark.ts`, `verification-benchmark-v1.ts`, `verification-benchmark-run-comparison.ts`, `verification-statistics.ts`, `verification-human-review.ts`
- `apps/cli/src/diagnostics-demo.ts`
- `packages/persistence/src/verification.ts` and `verification-*.ts`
- `packages/policy/src/verification-policy.ts`

## Inconsistencies noticed (not fixed)

1. **Spec topology vs package layout.** Spec §6.2 places `domain/`, `metrics/`, `experiments/`, `demos/`, and package-level `testing/` under `packages/verification`. Those directories do not exist here. Metrics, experiments, and demos live in application / evaluation / CLI.

2. **`Judgment` is a dead facade re-export.** `src/index.ts` re-exports type `Judgment` from contracts. No file under `src/**` constructs or consumes `Judgment`. Semantic output is `SemanticAssessmentRecord`. Spec §8.5 “append-only judgments / never overwrite” is not implemented as a ledger in this package; only sealed-manifest immutability applies.

3. **`sourceComponentValue` is not on the extraction public index.** `src/extraction/source-component.ts` exports it; `src/extraction/index.ts` does not re-export it (used internally by `verification.ts`).

4. **`verifyExtractionFieldsWithAcceptedSelections` is module-public but not package-public.** Exported from `verification.ts` with a comment “used by the evidence adapter only”; omitted from `extraction/index.ts`.

5. **Prototype bundle input type is not exported.** `verifyPrototypeBundle` takes an unexported `PrototypeBundle` and returns `unknown`. Callers cannot name the input type from the facade.

6. **No colocated tests for `claims/` or `authority/`.** Coverage is in `src/semantic/diagnostics.test.ts`.

7. **Provider adapters perform network I/O.** Spec/package boundary is “algorithm package, no I/O.” `GatewaySemanticJudgeAdapter`, `GatewayStructuredExtractionProvider`, and `InterfazeStructuredExtractionProvider` call injected `fetch` (`src/providers/gateway.ts`, `interfaze.ts`). No vendor SDK objects are exported.

8. **Gateway judge verdict subset vs contract lattice.** `gateway.ts` `semanticOutputSchema` admits `directly_supported`, `supported_with_qualification`, `partially_supported`, `context_only`, `contradicted`, `not_supported`, `insufficient_evidence`. Contract `SemanticVerdict` also includes `mixed_or_conflicting`, `unverifiable`, `source_unavailable`, `locator_error`, `parser_error`, `derived_verified`, `derived_failed`. Mechanical closure uses `locator_error` / `unverifiable` without going through that schema.

9. **JSON Pointer selected-content digest mismatch (KS vs prototype).** Built-in `resolveJsonPointer` hashes `canonicalizeJson(value)`. Prototype `resolvePrototypeJsonPointer` hashes `JSON.stringify(value)`. Compatibility path is intentional; native and prototype hashes for the same pointer can differ.

10. **`canonicalizeJson` is RFC 8785-compatible, not a full RFC 8785 library.** Comment in `canonical.ts`: schema-admitted JSON only; rejects non-finite numbers, lone surrogates, and non-plain objects. Number encoding uses `JSON.stringify`.

11. **Public facade includes live provider classes.** `export *` from `providers/` puts `Gateway*` / `Interfaze*` and `INTERFAZE_ENDPOINT` on `@aiengineer/knowledge-verification`. Cross-repo import is forbidden, but in-monorepo the algorithm package surface is wider than “pure core.”

12. **Policy question 5 is out of package.** Engine/seal record policy version and input artifacts; they do not compute `pass` / `review` / `fail` / `abstain`. Matches the intended split; conflicts with a reading of spec §1 that the module owns policy-controlled verification end-to-end inside this package.

13. **No package-local Vitest config.** Tests rely on default `vitest run` + colocated `*.test.ts`. Works; undocumented until this README.
