# EV162 generated-report semantic preparation — 2026-09-08

## Scope and boundary

This checkpoint prepares diagnostic-only semantic verification for the three exact generated EV162
reports. It does not dispatch a provider request, reuse or attach the prior 38 v1 semantic records,
alter any EV162 artifact, change the failed report-wide consistency disposition, create human labels,
or promote acceptance.

`VerificationClaimsApplicationService.prepareReportDiagnosticSemanticCases` uses a privately retained
pre-report-wide deterministic result. It releases branded assertion cases only when that base result
fully passed and the final result was changed to failed solely by
`REPORT_INTERNAL_CONTRADICTION_FREE` and/or `REPORT_CROSS_SECTION_CONSISTENCY`. It recomputes the final
result from the exact report-wide result, context, and private base. Ordinary `prepareSemanticCases`
and `gradePreparedSemantics` retain their fail-closed behavior. Diagnostic cases cannot be asserted as
an ordinary service-issued semantic batch.

The preparer reloaded the sealed v1 catalog and source preparation, reconstructed the native ledger
builder with its production projection admission and selector resolver, and matched all 46 local EV162
artifacts byte-for-byte: 40 claims artifacts, three report claim ledgers, and three report artifacts.
It then reverified each report and derived 29 diagnostic wires from the service-branded cases:
11 TruDiagnostic, nine Generation Lab, and nine comparison assertions.

Each entry binds its report and claim-ledger handles, assertion and fragment, source/capture/projection/
transformation identities, selector and selected-content digest, source class, URI, restricted custody
rights, and `not_labeled` status. Only one assertion and its single necessary public fragment enter the
wire. The largest authorized content is 1,476 UTF-16 characters and the largest prepared Gateway
request is 4,042 bytes; full reports are excluded. The exact Luna profile fixes temperature 0,
900 output tokens, no tools, and the adapter's redirect-denying transport. Execution is serial, has no
automatic retry, stops after three consecutive failures, and requires a durable per-call journal hook.

## Retained plan

- preparation receipt:
  `../internal/verification-EV162-generated-report-semantic-plan-20260908.json`;
- receipt SHA-256:
  `57cf1e26e48dcaef65a851be8e9b7b0b49fe64ed6a896ff1a2d9a7f1a9b93045`;
- exact plan digest:
  `sha256:4476f27ca81a0b5416c215dcb6284d6353ea96eb4347778ee5338bf9bfa68b3b`;
- entries: 29;
- maximum liability: 200,000 micros;
- per-call reservation: 5,000 micros; maximum planned reservations: 145,000 micros;
- retained state: `dispatchAuthorized: false`, `externalRequests: 0`.

An executor must receive a separate grant matching the plan digest, the ordered 29 entry digests,
model, call count, ceiling, reservation, concurrency, retry, and failure-stop fields exactly. It must
journal each entry before creating the `GatewaySemanticJudgeAdapter`. Offline replay accepts only the
same recreated branded cases and the observation custody captured for the exact entry digests through
`replayCapturedSemanticAssessment`; the old v1 fixture is not a compatible source.

## Verification

- `node node_modules/vitest/vitest.mjs run packages/application/src/verification-claims.test.ts`:
  6/6 pass, including valid inconsistent-report diagnostics, ordinary-path closure, forged-result
  rejection, and invalid pointer rejection.
- `node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit`: pass.
- `node node_modules/tsx/dist/cli.mjs scripts/prepare-verification-ev162-report-semantics.ts`: pass,
  zero external requests.

The prepared plan is Luna-only engineering evidence. It cannot establish human-gold quality,
authority/applicability, cross-family agreement, report admission, or complete VR042 acceptance.

## Live execution and sealed offline replay

The separately authorized runner executed the exact prepared plan once. Its immutable cross-process
plan lock and startup reservation preceded dispatch; each request was journaled before the call, and
request, raw response, judge output, observation, and assessment bytes were retained per entry. The
run completed 29/29 diagnostic assessments with zero failures, 9,572 known micro-USD, zero unknown
cost records, and matched the requested Luna model for every observation. The live receipt is
`../internal/verification-EV162-report-semantics-live-20260908/receipt.json`, SHA-256
`6d38d6a74c28f848823ecde39002d5d1db3bf95ead4a4a5acf4b73564f524b8b`.

An offline replay pinned that receipt by caller-supplied digest, rebuilt every request from the sealed
plan, checked every artifact path, byte length, and digest, reinterpreted all retained raw Gateway
responses through the production response interpreter, recomputed observations, and matched all 29
semantic assessments with `externalRequests: 0`. Its receipt is
`../internal/verification-EV162-report-semantics-replay-20260908/receipt.json`, SHA-256
`24c5894db8331d1f164e5834fac05db0e4fda0faf0d9459ac2c744134db69585`. Independent live evidence
inspection is retained at `../internal/verification-report-semantics-independent-audit-20260908.json`,
SHA-256 `b5ad680bab644396c7923ea500f157f1f4a0b37b438e1220bd8d84a67677c233`.

The 29 observations are also sealed as a reusable repository fixture at
`catalog/verification-semantic-fixtures/e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d`.
Its canonical fixture digest is
`sha256:e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d` and it contains 77 unique
content-addressed files referenced by the 29 records. The loader bounds the manifest, checks each
artifact's filesystem size against its declared bounded size before reading it, and authenticates the fixture before it
exposes only immutable summary identities. Replay then requires a freshly prepared plan matching the
original plan and original run-manifest digest exactly; current offline runs may record their own run
digest separately while proving that their generated report and ledger handles equal the sealed
handles. The replay result returns entry, report, assertion, and assessment identities and remains
diagnostic-only.

Focused verification:

- generated-report fixture load and retained-response tamper rejection: 2/2 pass;
- application TypeScript check: pass;
- preparation/live/replay/sealer script TypeScript check: pass.

These provider assessments do not change the three reports' failed report-wide consistency status and
do not create human labels or an acceptance promotion.
