# Dispatch uncertainty recovery

EV-091, coordinator review, 2026-09-06. The configured extraction worker now explicitly marks an original dispatched call uncertain when a replacement finds no durable response capture. It retains the original reservation and throws the existing non-retryable STRUCTURED_EXTRACTION_DISPATCH_UNCERTAIN activity error. Already uncertain attempts remain unchanged; settled attempts are not downgraded. This update runs under the replacement's valid scoped lease before terminal failure releases that lease.

The proof submits two fresh operations through the public HTTP client, one per registered provider. Each executes in a separate hidden Node process. The explicit synthetic fetch port signals only after accounting has authorized dispatch, then waits before returning any response. The parent kills the actual child process, asserts SIGKILL exit and waits for natural lease expiry. No supplier request is made. The replacement cannot invoke its transport port: that port throws if called. Both replacements mark the original row uncertain and terminate with one generic infrastructure-failure receipt. Neither operation can be claimed again or read as a published extraction result.

Final six checks pass. Each operation has one original provider attempt at ordinal zero, a 100-micro-unit reservation, null actual cost and null response artifact. No response capture, candidate, success publication or captured-provider-failure publication exists. The lifecycle remains running as incomplete retained history while the canonical operation and step are failed; it is not fabricated into a provider-output failure. Total unknown reserved liability is 200 for this two-operation cohort.

The independent audit reads actual PostgreSQL operation, step, original provider accounting, generic receipt and released replacement lease records. It confirms original versus later fencing, non-retryable error class and absence of capture/publication/candidate rows. It hydrates the registered source-custody Storage object and verifies all 17 retained source files against their bytes and current workspace hashes. This audit does not claim a full source-artifact replay or independent observation of historical OS exits; the parent process proof asserts the latter live.

Evidence in parent `internal/`:

- `verification-structured-extraction-dispatch-recovery-b2143f43-1da0-434a-b53e-7f1f2143cbe5.json`: SHA256 `66c1075485896bcd62be450652c326ad3e6eecd3651e353ce32ba6d7c291a725`.
- `verification-structured-extraction-dispatch-recovery-audit-20260906.json`: SHA256 `69b8af2e5cbfbf3a5b8dcc732f61717fbdfdcccedfe7a3a91cc51c739c5461af`.
- `verification-structured-extraction-dispatch-recovery-workspace-20260906.log`: SHA256 `a25692e7ec4583137b9648723d0058f07bffe410fa0eadaa16e8bc11d8bf7228`; 72 tasks passed, 69 cached, 6.165 seconds. Proof TypeScript validation also passed.

Reproduce from KS using local helper mode `structured-extraction-dispatch-recovery`. Audit mode is `structured-extraction-dispatch-recovery-audit`, with VERIFICATION_EXTRACTION_WORKER_RECEIPT set to the final filename. Do not load the remote KS `.env`. No migration, supplier settlement or remote deployment was performed.

Next implement separately authorized reconciliation of original attempts after canonical failure/cancellation, with immutable evidence, exact tenant/operation/provider scope, budget invariants and no redispatch authorization. Also cover partial response/candidate retention and cancellation crash windows. Dynamic arrays, semantic claims/report/adjudication, canonical case/score completeness, disconnected replay, security/deployment, runtime cutovers, dashboard, human review and the full matrix audit remain open. This evidence closes no complete acceptance row.
