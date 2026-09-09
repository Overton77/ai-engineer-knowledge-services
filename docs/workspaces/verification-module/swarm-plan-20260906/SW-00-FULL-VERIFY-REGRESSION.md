# SW-00 full-verify regression diagnosis

Date: 2026-09-07

## Failure examined

The full parallel KS verification log `../internal/verification-knowledge-full-verify-20260907.log` failed at `packages/testkit/src/broad-evaluation-corpus.test.ts:37`: the test expected the broad hybrid control gate to pass but received `false`. The failed control-arm test completed in 9.534 seconds while Turbo was running the repository suites concurrently. The same log contains independent application fixture tests that failed around their 5-second per-test thresholds, which supports host contention rather than a single deterministic retrieval output change.

Reviewed source hashes:

- `packages/testkit/src/broad-evaluation-corpus.ts`: `5493894CBBD0D5834DD922FF40CFEA5218AB719524C27BB5C94073226ADCCB07`
- `packages/testkit/src/broad-evaluation-corpus.test.ts`: `C04AD5740AB696EF25F0D9DCD52CEFC9A5AC3E845F96C58F483A57B4B2CE87BE`
- `scripts/evaluate-broad-corpus.ts`: `8968CC624FD1B4A9B81A28D4F387281CF47946D799EF06919845A1F2370E34B6`
- Full verification log: `0C87B542E584337699E2DB699D52C03F917152965557AF320D69C0FDBBA05B12`

## Independent reproduction

`corepack pnpm --filter @aiengineer/knowledge-testkit exec vitest run src/broad-evaluation-corpus.test.ts` exited 0: 3/3 tests passed in 8.33 seconds.

`corepack pnpm evaluate:broad` exited 0 and wrote an untracked exploratory receipt at `catalog/broad-heldout-evaluation.json`. Its control gate passed with no hard, quality, or regression failures; zero false acceptances; and these control metrics:

- recall@K `1`
- MRR `0.868055555556`
- NDCG@K `0.89491221806`
- filter satisfaction `1`
- abstention accuracy `1`
- citation correctness `1`
- p95 latency `676.7723 ms`, below the hard `1500 ms` cap

The receipt’s control report digest is `sha256:f31f959dffad43c7b88c8f2f6c476626f68110a0750d243ec537c1cf65b18da9`; its gate digest is `sha256:f00c949c453320d4be5edb38bd6d5bbb0da557893b744c64a52977700b77f88e`.

## Classification

This is a wall-clock flaky test under parallel resource pressure. The gate computes `latencyMs` from `performance.now()` around in-process retrieval and applies the 1.5-second p95 hard threshold. The focused test and deterministic broad-evaluation script both reproduce passing quality, safety, and latency outputs. There is no evidence of a deterministic product regression.

No threshold, gate, test, or source was changed. The untracked exploratory receipt should be retained or removed only by the coordinator under the workspace’s normal artifact decision; it is not acceptance evidence. Root may continue serial application verification without overlap.
