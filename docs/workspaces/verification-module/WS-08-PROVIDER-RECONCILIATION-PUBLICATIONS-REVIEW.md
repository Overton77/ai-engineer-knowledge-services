# Reconciliation preserves completed publications

EV-094, coordinator review, 2026-09-06. Original-attempt reconciliation now accepts succeeded extraction operations as well as failed and cancelled ones. Migration 20260906033000 changes that terminal-status predicate while retaining all existing identity, evidence, expiry, role and atomic-settlement guards. The persistence store uses the same predicate. Applied migrations were preserved; local schema330 and database-contract0.2.29 are current. Remote schema remains unchanged.

A fresh isolated preparation exercised Gateway and Interfaze with accepted candidates and captured HTTP failures. Each original response omitted actual cost, leaving four uncertain accounting records. Public submission, configured worker completion/recovery and authenticated HTTP reads produced two succeeded and two failed operations. Synthetic signed decisions then settled each accepted call at17 and each HTTP failure at0. Final accounting is reserved0, settled34, ceiling400.

All20 grouped settlement checks passed, including admission negatives, rollback after insertion, executor-role denial, concurrent exact application, conflicting decisions and immutable ledger. For every case, the full authenticated publication, compact HTTP resource, canonical operation and receipt records remained identical across settlement. Original signed publications still retain their original uncertain-cost snapshots; mutable provider accounting reflects the later decision. No redispatch occurred.

The independent audit verified18 actual Storage artifacts, four operator signatures, four original publication signatures, four current source hashes, five installed SQL function bodies and tenant isolation. It also checked original response identity, exact ledger bindings and native terminal receipt bodies. All72 workspace typecheck/test/build tasks passed uncached in2m6.766s. Proof TypeScript, generated database types and193-file canonical/vendor/installed contract parity passed.

Evidence in parent internal/:

- verification-provider-reconciliation-publications-9d8562b6-5f9b-486c-ac9a-2b696ce53f65.json — SHA256 ea557e9187a7fc25a658d035afb4031c471d52849438fee5d6c9f9b7e72451b7.
- verification-provider-reconciliation-publications-audit-20260906.json — SHA256 a4f7f285d4b9181cf6a71bcd55391f32557d68b3fa49c135c940a892dacdf89b.
- verification-provider-reconciliation-publications-workspace-20260906.log — SHA256 7a492e7a6bb0f0e8dea95c06a0ac9a38050e593deb84a2cb76a54ce30f9d5fe0.
- verification-contract-0229-audit-20260906.json — SHA256 1e7e204ff6d5d3c8b33558c47c84458023d7a6f6f21884d54b369a30241d5cb6.
- Preparation: verification-provider-reconciliation-publications-preparation-be3aebb9-60cc-40e0-895a-b7c3d5c8d7fc.json;16 checks passed.

Reproduce with the local helper provider-reconciliation-publications-prepare, set VERIFICATION_RECONCILIATION_PREPARATION to its fresh output filename, then run provider-reconciliation-publications. Audit mode provider-reconciliation-publications-audit takes VERIFICATION_EXTRACTION_WORKER_RECEIPT. A prepared cohort is consumed by settlement; create fresh attempts for a new settlement proof. Never load the remote KS .env for these local proofs.

This evidence uses synthetic supplier responses and billing assertions. It does not establish supplier billing truth, deployed operator authorization or production readiness. Operator runtime/transport and authorized historical reads of applied decisions remain next. Partial-retention/cancellation windows, semantic custody, case/score completeness, replay/export, security/deployment, runtime cutover, dashboard, human review and final acceptance remain open. No entire acceptance row is closed by this slice.
