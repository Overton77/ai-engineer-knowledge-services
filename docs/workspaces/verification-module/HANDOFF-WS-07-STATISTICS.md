# Verification statistics preparation

Coordinator-authored bounded preparation; independent review and WS-07 experiment integration remain open.

`packages/evaluation/src/verification-statistics.ts` exports fixed 95% Wilson intervals, exact two-sided binomial McNemar p-values (including finite log-p when a floating p-value underflows), reproducible paired source/report-cluster bootstrap percentile intervals, Brier/ECE reliability bins, tied-score risk–coverage curves and Holm family-wise adjustment. Seeds, resample counts, sample/cluster denominators and zero-sample/one-cluster limitations are explicit. No threshold is tuned here; the future harness must select it using calibration data only.

Statistical meaning and provenance are distinct. These functions do not grant human gold status to labels, establish source independence, choose appropriate clusters, imply population representativeness, or turn an uncalibrated model confidence into an accepted probability. The report must state the sampling/labeling limitations. The exact McNemar test assumes independent paired units; source-correlated claim rows require clustered inference, and an unadjusted case-level p-value must not silently be presented as cluster-adjusted. Fewer than two clusters produces no bootstrap interval. Small nonzero cluster counts still require caution. The whole hypothesis family must be declared before Holm adjustment.

The bootstrap estimates the case-weighted mean candidate-minus-baseline difference, samples entire clusters with replacement and retains each sampled cluster's full case mass. It uses a versioned deterministic 32-bit generator and linear percentile interpolation. Input case order does not affect results. Work is capped at five million cluster draws. Tied confidence scores are admitted as a group when constructing risk–coverage curves.

Primary references: [NIST confidence intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm) for the Wilson score interval and [statsmodels McNemar API](https://www.statsmodels.org/stable/generated/statsmodels.stats.contingency_tables.mcnemar.html) for the exact binomial paired test. These references support method definitions; they do not validate this implementation or the future experiment.

Package tests pass 21/21 (five new statistical tests plus existing evaluation tests); typecheck passes. Tests cover zero-event uncertainty, invalid denominators, exact McNemar value/symmetry/underflow, duplicated paired cases, cluster-vs-row resampling behavior, seed/order/arm-swap invariants, empty calibration sets, tied-score admission, and duplicate hypothesis rejection. A deliberately imbalanced two-cluster case ensures that row-wise resampling cannot masquerade as cluster resampling. An independent reviewer and real frozen-Pilot report remain required.

WS-07 still needs the full 30–50-case paired experiment, provider/extraction/semantic metrics and failures, continuous paired tests where appropriate, drift, license/label gates, reports and promotion decisions. These helpers are not a benchmark completion claim.

## Sign-flip test review — 2026-09-05

WS-07 added a cluster-level sign-flip comparison. Coordinator review found two numerical defects: an absolute epsilon made tiny nonzero effects return p=1, and strict floating comparisons after normalization excluded mathematical ties. Both were corrected with normalized summation and an explicit conservative forward-error bound. Up to 16 units are enumerated exactly; larger samples use seeded Monte Carlo with the +1 numerator/denominator correction. Reports expose the method and sign-exchangeability null, and must state whether the estimand weights clusters equally or weights their cases.

The independent coordinator probe uses integer-exact BigInt enumeration on 400 input arrays and compares production results at three scales. The preserved failure receipt is `internal/verification-signflip-independent-review-15b5bbfd-5c1c-42a7-a920-944bfe7911ec.json` (SHA-256 `0e32246b492ac1cbfe43c4cb5e7eb83522985a067ff656e0b34067b832bd00a7`). After correction, the coordinator's rerun passed all 1,200 comparisons: `internal/verification-signflip-independent-review-269f8f12-76de-4874-b311-fceb68808205.json` (SHA-256 `e123d7b9c8067d571cffe8cca89a4d126580a6765d36521c09cfe80dec2a99ab`). This validates the bounded numerical cases; it does not establish source independence or human-gold labels.

The paired sign-change construction and Monte Carlo correction follow the method described in the [SciPy permutation-test documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.permutation_test.html). With four source clusters, the exact reference has only 16 assignments; the apparent number of claim rows must not be substituted for independent units.

## Evidence hashes

- `../internal/verification-statistics-tests-20260906-r2.log`: `f24a2f4d0606f06bb5a3ae26fdc3f9dd589e27b43669e8c193a2777023537550`.
- `../internal/verification-statistics-typecheck-20260906.log`: `56e8db346f66d205a565f1d6ce86d2ba3c8462ceb97e81469db459f480eb40c7`.
- `packages/evaluation/src/verification-statistics.ts`: `753899871da6dd85e59d02611ff18ace1f05c9daac7c60582ce5e45ad986681c`.
- `packages/evaluation/src/verification-statistics.test.ts`: `6fec0275243f72bd8c4bf1e60af1b7849a75645c0dcc9736630739a2f52fe407`.

## Separate arbitrary-precision numerical reference

A Python integer-binomial/80-digit Decimal reference independently checked 444 McNemar tables (including numerical underflow) and 299 Wilson intervals. Maximum absolute log-p error was 1.82e-12; maximum interval endpoint error was 2.23e-16. This numerical cross-check is distinct from independent human/code review and does not validate cluster choice or experimental assumptions.

- `../internal/verification-statistics-reference-20260906.json`: `884bf59b53a8caeea320d677d10e42a9c75276d2a2bbbcddc1bf4cf3dd7b63e3`.
- `../internal/verification-statistics-reference-proof-20260906.json`: `cecb389f23271cefbf9770458dc00423e34115f845c634952bfdc8a71d7c726d`.
# Reproducible numeric reference check

The coordinator added `internal/verification-statistics-reference-review.py` on 2026-09-06. Running it recomputes all 444 McNemar and 299 Wilson frozen reference cases with Python arbitrary-precision integer binomial sums and 80-digit Decimal arithmetic; all pass. It reads the frozen case inputs and compares independently computed outputs, without overwriting the existing hashed receipts. This numeric check does not replace independent statistical-method review or real benchmark evidence.
