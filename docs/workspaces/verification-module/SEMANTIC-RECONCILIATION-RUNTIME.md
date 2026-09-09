# Semantic accounting reconciliation runtime

The API exposes GET and POST at `/v1/verification/claims/:operationId/provider-attempts/:providerAttemptId/reconciliation` and the corresponding `/reports/` path. POST accepts only `{artifact: <full registered artifact handle>}`. Both return the existing accounting decision resource; a decision does not authorize redispatch or change a verification verdict.

The runtime is disabled unless `VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON` is present. This server-owned array binds each authenticated `actor` and `tenantId` to an exact `operationId`, `providerAttemptId`, `keyId`, `operatorId`, `executionMode` (`synthetic_transport` or `live_provider`), and full `billingEvidenceArtifact` handle. Duplicate authority tuples and billing handles from another tenant are rejected. Configuration is bounded to 256 entries and 262,144 bytes.

It also requires `VERIFICATION_PROVIDER_RECONCILIATION_PUBLIC_KEYS_JSON` (Ed25519 key entries), `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and the canonical database. `VERIFICATION_STORAGE_BUCKET` defaults to `ai-engineer-cloud-bucket`. Credentials remain server-side. Accounting grants supplement the original mission, producer deployment and capability ownership; a claims grant cannot read or apply a report-path decision.

Admission verifies the canonical signed receipt, exact billing grant and original dispatch/custody. The store locks operation, budget and attempt, rechecks evidence, then inserts the immutable ledger row. Native triggers settle the original attempt and release its reservation once. Identical requests can recover the same decision. GET verifies retained evidence at its durable application time, including after receipt expiry, and never issues a mutation permit.

The TypeScript client exposes `getSemanticProviderReconciliation(host, operationId, providerAttemptId, context)` and `applySemanticProviderReconciliation(host, operationId, providerAttemptId, request, context)`, with host `claims` or `report`. Extraction endpoints and their existing grants are separate and unchanged.

Local deployment state: R17 was promoted to canonical migration `20260907013000_verification_semantic_provider_observation.sql` and applied on 2026-09-07, with generated database contract 0.2.34. No grant or environment value was installed by this implementation. Native settlement/restart/readback and simultaneous settlement races are recorded in the workspace evidence log; the full Temporal/public semantic lifecycle remains to be proved.

Concurrency follow-up: native receipt35b43d5a-75a9-44e7-a130-98617401a759 passes114 controls, including actual independent-session duplicate/conflicting settlements and positive-before-expiry then blocked-expiry rejection for claims/report/extraction. See EVIDENCE-LOG.md for exact custody cases, cleanup receipts and promotion evidence.
