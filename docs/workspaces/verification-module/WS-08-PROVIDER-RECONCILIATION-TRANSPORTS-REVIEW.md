# Reconciliation CLI and MCP transports

EV-097, coordinator review, 2026-09-06. The CLI now exposes reconciliation apply and reconciliation show. Both take operationId and providerAttemptId in --input; apply additionally takes the full registered signed-decision artifact handle. Context and authentication use the existing CLI options. Unknown input fields fail locally. No operator keys or caller grants are accepted by either command.

MCP now registers knowledge_apply_provider_reconciliation and knowledge_get_provider_reconciliation. Their strict input schemas use the compact tenant/correlation context and original operation/provider-attempt identifiers; apply additionally accepts the registered artifact handle. Apply requires operation.submit and get requires knowledge.read at the MCP boundary. Both forward to the typed HTTP client, retaining the API's actor/issuer and original mission/deployment authorization. These tools never dispatch a supplier request.

A fresh four-case preparation covered accepted candidates and captured HTTP failures for Gateway and Interfaze. For each original uncertain call, the proof concurrently submitted the exact signed decision through a built CLI child process and actual MCP Streamable HTTP. Both returned the same compact settlement result. Subsequent built CLI show, MCP get and typed HTTP reads were identical. All24 grouped checks passed, retaining the HTTP authentication/role/actor/mission negatives, rollback, immutable ledger and original publication/receipt/operation stability checks. The isolated budget ends reserved0, settled34, ceiling400.

The independent audit checks18 actual Storage artifacts, four operator signatures, four original publication signatures,12 source hashes, five installed SQL function bodies and tenant isolation. Dedicated proof TypeScript passes. All72 workspace tasks pass,66 cached, in10.648s.

Evidence in parent internal/:

- verification-provider-reconciliation-transports-04b48945-7ae2-4adf-a0f5-db164e58b745.json — SHA256 782c9ade8ddf9f47b8dc5e22a2775d650cfdc9cb58633a33f74aebecbc941487.
- verification-provider-reconciliation-transports-audit-20260906.json — SHA256 ded13e2d389ae309b70e022502fcb6df98208f517625a2ca885bd69a20773e6c.
- Preparation: verification-provider-reconciliation-publications-preparation-c85d365b-aa30-4fec-83cd-8d51e176637d.json.

Reproduce using provider-reconciliation-publications-prepare, followed by provider-reconciliation-transports with VERIFICATION_RECONCILIATION_PREPARATION set to the fresh filename. Audit helper provider-reconciliation-transports-audit takes VERIFICATION_EXTRACTION_WORKER_RECEIPT. Already settled cohorts are not reusable for first-time application proofs. Never load remote KS .env for local tests.

No migration or contract-package version change: local330/DBcontract0.2.29 remain current, remote unchanged. This is local transport evidence with synthetic supplier/billing data. Deployment/operator configuration and real supplier billing remain open. Next cover partial response/candidate retention and cancellation windows with process recovery, then continue the remaining semantic, case/score, replay/export, security/deployment, runtime cutover, dashboard, human-review and final acceptance requirements. No whole acceptance row is closed.

Workspace log: parent internal/verification-provider-reconciliation-transports-workspace-20260906.log; SHA256 1d15c16baa667fcc245159caddbd2cf39ba9a1adc23c28868279c982e491f778.
