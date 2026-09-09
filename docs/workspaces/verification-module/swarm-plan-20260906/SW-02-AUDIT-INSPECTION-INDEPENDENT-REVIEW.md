# SW-02 audit inspection public slice review

Read-only source review completed 2026-09-07 across strict audit-inspection contracts, application inspection/grant/read services, Postgres authenticated reads, worker runtime/activity, and API/client/CLI/MCP adapters.

## Result

No new concrete P1 or P2 source defect was identified in the reviewed public slice.

- The public resource schema is strict and projects only tenant/operation/request digest, compact output, and result artifact ID/digest. Storage coordinates and full internal handles remain server-side.
- API submission requires both configured ownership context and an exact audit grant. The runtime additionally resolves the claimed retained audit bundle, its replay binding, expected claims/report producer kind, claims projection grant, canonical projection admission, and retained transformation lineage before inspection.
- The read repository binds terminal operation, step input/hash/context, receipt/event/fencing/output digest, result artifact type/metadata/bytes/canonical body, exact audit parent, and a second snapshot to detect terminal drift. Cross-tenant, pending, failed, cancelled, malformed, or unbound records fail closed.
- Worker cancellation polling aborts on inactive/missing operation; the activity checks before inspection, before registration, and after fenced registration. It never returns a successful terminal body after a poll failure. Runtime receives only configured public verification keys; no private signing material crosses this boundary.
- API/client/CLI/MCP submission and read adapters use typed strict contracts. No invented public result route was found.

## Limits

This is source review only. Native SQL/Storage activity proof, configured key deployment, real retry/deadline behavior, and browser/transport evidence remain pending Sol's coordinated proof receipt and targeted checks. No source, database, Storage, provider, or infrastructure mutation was performed.

## Native receipt SQL audit

Read-only audit of retained native receipt `verification-audit-inspection-public-cccd810b-776d-4b39-a7dd-a4d6c0927f04.json` confirms all eight listed claims/report inspection operations are `succeeded` with exactly one receipt each; the cancellation operation is `cancelled` with zero receipts; and the denied wrong-digest operation has zero rows. The credential-free audit receipt is `internal/verification-audit-inspection-independent-sql-audit-cccd810b-776d-4b39-a7dd-a4d6c0927f04.json`.

This independent SQL check does not claim the remaining Storage canonical-byte, event/fence, result-parent, or policy-outcome assertions, which require the dedicated native custody audit rather than broadening this query-only review.
