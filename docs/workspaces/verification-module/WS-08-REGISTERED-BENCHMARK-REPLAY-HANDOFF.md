# WS-08 Registered Benchmark Replay Handoff

`RegisteredBenchmarkReplayAdmission` admits successful V4 live checkpoints
only through a trusted exact tenant/dataset/offline-experiment pair grant. Each
checkpoint reference also pins its expected original run identity. The
admission returns only typed observations, compact checkpoint references,
memory-only replay proof, and recomputed extractor mechanics. It never returns
checkpoint or provider bytes and always marks results as requiring separate
current projection preparation.

The composition authenticates the checkpoint wrapper and every packed artifact
against its registered tenant-scoped full handle and exact bytes. It checks the
checkpoint digest, original V4 profile dataset/experiment seals, admitted
observation reference, case/role uniqueness, and uses the existing observation
custody loader for canonical response-envelope lineage. Retained request bytes
are rechecked by the existing wire assertion, then the existing Gateway or
Interfaze adapter is replayed using an in-memory response and retained HTTP
status. Precontext bytes and envelope lineage are checked when present.

For extractor calls it recomputes `verifyDiagnosticsExtractionOutput` and
`createDiagnosticsFieldLedgerArtifact`; it does not trust the recorded field
mechanics. Source locator validity is not accepted as present-day projection
custody, so execution must prepare current registered projections separately.
The source-binding input-manifest handle is still authenticated against the
resolver and must equal the dataset case input artifact ID; its locator flag is
not used as a custody decision. Packed request, raw-response, and response
envelope handles must exactly equal the independently hydrated observation
custody chain before adapter replay. Cancellation is rechecked after the replay
await before any field-mechanics work.
Captured failure checkpoints remain unavailable and cannot become a replay
success path.

The retained V4 `tru-sites-source` source projection and envelope are currently
owned by source tenant `fbfa12cf-0cef-423d-858e-f7a3e213fa80`, while its
historical provider checkpoints and observations are owned by tenant
`6d057f43-6aaf-48d9-b3ba-374169abb989`. This replay admission therefore does
not claim an executable current-projection path. A later executor needs an
explicit trusted source-ownership/import mapping; it must not silently cross
tenant boundaries or treat the historical locator as current custody.
