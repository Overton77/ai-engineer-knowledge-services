# SW-15.9.5 extraction replay implementation — 2026-09-08

## Scope

This bounded asset seals the retained pilot-v4 extraction checkpoints for offline, provider-neutral replay. It does not alter `benchmark.ts`, the v1 catalog, provider adapters, or any provider/cloud state. The asset is explicitly pilot-v4 evidence and must not be presented as the v1 benchmark.

## Sealed asset

- Manifest: `catalog/verification-benchmarks/diagnostics-companies-pilot-v4-extraction-replay-v1/manifest.json`
- Manifest schema: `diagnostics-extraction-offline-replay-manifest.v1`
- Fixture digest: `sha256:6124fac14ef6b3c320c4a00c6efa57f6027adad1cbc88038af1762e7dbe04101`
- Dataset manifest digest: `sha256:a6bc1cf3ecbb335e4f5ef49165798d29ce937a9324f2a1ba7d9768f23ad7feee`
- Records: 78 exact retained checkpoints: 39 Interfaze and 39 Luna.
- Each record retains the request, raw response, response envelope, observation, field ledger, and their byte/hash/parent relationships. The runner rechecks these closures before replay.

## Runner and result

`packages/application/src/verification-diagnostics-extraction-replay.ts` validates the fixture seal and record identities, verifies embedded artifact bytes and local parent custody, then invokes the existing `verifyDiagnosticsExtractionOutput` against the existing experiment cases. Successful records replayed: 72 (33 Interfaze and 39 Luna). Six retained Interfaze typed failure checkpoints remain explicitly `unavailable`; they are not converted into successful extraction results. No provider or network request is made (`externalRequests: 0`).

The fixture has both extractor arms for the retained cases. Four pilot-v4 case IDs remain unavailable because neither extractor checkpoint is locally retained: `tru-turnaround-product-mutated`, `tru-corrupted-locator`, `tru-pdf-graph-text-abstention`, and `gl-same-page-superlative-source`. The semantic judge arm is outside this extraction replay asset. The retained successful results preserve the existing field-mechanics outcome, including outputs whose recomputed field-mechanics check is false; the runner does not manufacture or repair that evidence.

## Validation

Focused validation passed: `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-diagnostics-extraction-replay.test.ts` — 3 tests passed, including a resealed engineering-copy artifact-byte tamper rejection. Package typecheck now passes cleanly.

The runner now schema-parses each success/failure checkpoint, checks checkpoint and run/dataset/experiment identity, enforces strict artifact handles and unique roles, confines real paths beneath the fixture root, verifies the request → raw response → envelope → observation → field-ledger parent chain, and reports each missing case/arm (`missingArms`) separately. It binds retained capture and selected-content metadata to the catalog evidence and checks every retained field-ledger artifact reference where present.

## Remaining boundary

This is a reusable offline closure for the locally retained pilot-v4 extraction subset. It does not provide missing case/arm artifacts, a live provider re-run, full 43-case coverage, human labels, or v1 benchmark acceptance evidence. The retained checkpoint source binding carries capture and selected-content identity; the catalog remains the authority for projection and selector metadata, while provider records do not embed a second projection-byte closure. The next implementation step for broader coverage is to obtain and seal the four missing case closures and any required arm checkpoints under the same manifest schema, with source custody, before extending the replay claim.

Root follow-up: added explicit manifest lstat/realpath validation after the agent's revision; current focused3tests passed. This pilot-v4 helper remains standalone and is not included as default v1 provider coverage in EV162. Projection/selector admission is catalog-authoritative, not a newly executed second native projection closure. No complete request/provider or full-spec acceptance promotion is made from this supplementary helper.

