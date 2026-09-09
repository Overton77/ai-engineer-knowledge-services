# SW-02 claims/report terminal reads independent review — R2

Reviewed current terminal-read core only; public transport composition is excluded.

## Sources

- `packages/contracts/src/verification/claims-report-reads.ts` — SHA-256 `da6373b138e2be375d60e3285dece2675e3ea36cc263d9b93ce805afb9e96c47`
- `packages/application/src/verification-claims-report-reads.ts` — SHA-256 `cba47832704fb24a37cf1b94b1b5dd313320b17154b5a58eeb8513f6406bb1bf`
- `packages/persistence/src/verification-claims-report-reads.ts` — SHA-256 `3d68432068bb1ae145f3d409c69d6093b79e01b8bfc0cf26577826eab85037cf`
- Native hostile receipt: `../internal/verification-claims-report-reads-r2-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json` — SHA-256 `b904c1d70453dea5bd9708601922100efda271dcc97fc8b6055861f2392732bf`.

## R1 remediation assessment

The reader now uses separate exact claims/report durable schemas, so operation kind, use case, and step cannot cross-match. It validates the full persisted operation context, including normalized correlation/causation IDs, ownership mode, and external-run ID. Result artifacts have fixed media type, producer/version, custody classes, parent closure, and transformation signature.

`evidence.verification_run` is read by the sealed run ID and bound to operation, mission/work context, producer and verifier attempts, contract version, bundle/result/policy/manifest artifacts and digests, policy version, and terminal status. This closes the R1 native-run reuse finding.

The signed-input closure compares request capture IDs with the signed bundle, requires exact source artifact set equality with signed content/projection handles, requires signed input membership, and enforces report ledger alias equality plus report/ledger binding. Deterministic result bytes are hydrated from the signed output and must equal the terminal verified result. Report gate custody requires exact three parents, metadata, provenance signature, and canonical body. This closes the R1 signed-input closure finding.

The public contract now projects report-wide values as metrics and counts. It excludes producer-defined assertion/citation/group identifiers. The deterministic projection is similarly allowlisted to status, eligibility, counts, and bounded codes/reasons. This closes the R1 public-shape finding.

## Native evidence

The v2 receipt records a database default transaction read-only proof and thirteen controls: genuine compact claims/report reads; locator/raw-bundle/report-ID absence; no operation creation on absence; and in-memory hostile rejection for run reuse, cross-kind rows, event fence, source/capture set, report-ledger alias, report-gate bytes, and signature tampering. It records zero parser and provider dispatches.

## Remaining limitations

No P1 or P2 source defect was found in this bounded review. The hostile proof mutates in-memory repository/resolver views, which is appropriate for retained-record integrity paths but does not prove concurrent database interleavings. The receipt does not claim an OS crash proof, new evidence admission, provider execution, or public transport behavior. Focused test counts reported by the receipt/progress ledger were accepted as implementation evidence but were not rerun during this independent read-only review.

## Conclusion

R1 P1/P2 findings are closed for the claims/report terminal-read core. Public transport, broader concurrency testing, and operational deployment remain outside this review.

## Independent execution

Executed from the KS workspace without rebuilding packages:

```powershell
corepack pnpm exec tsx scripts/prove-verification-claims-report-reads.ts ../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json ../internal/verification-claims-report-reads-independent-20260907-r2.json
```

Exit: `0`. Immutable independent receipt: `../internal/verification-claims-report-reads-independent-20260907-r2.json`; SHA-256 `b904c1d70453dea5bd9708601922100efda271dcc97fc8b6055861f2392732bf`.

The independently executed receipt reports all 13 controls true, including database `default_transaction_read_only`, native run/cross-kind/fence/source/capture/ledger/gate/signature hostile denials, compact claims/report reads, no private output fields, no operation creation on absence, and zero parser/provider dispatches.
