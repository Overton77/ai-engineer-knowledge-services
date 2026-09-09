# Public audit operator runbook

This surface inspects an already sealed, exactly granted claims or report audit bundle. It does not admit new evidence, parse content, call providers, or change a verification decision.

## Server configuration

Enable the API only with server-owned operation-context authority and both flags:

```text
VERIFICATION_AUDIT_INSPECTION_ENABLED=1
VERIFICATION_CLAIMS_ENABLED=1`nVERIFICATION_AUDIT_INSPECTION_READS_ENABLED=1
```

`VERIFICATION_AUDIT_INSPECTION_ENABLED` accepts only `0` or `1`. Enabling it without dynamic verification ownership grants fails startup with `VERIFICATION_AUDIT_INSPECTION_OWNERSHIP_GRANTS_REQUIRED`.

For API reads, `VERIFICATION_AUDIT_INSPECTION_READS_ENABLED=1` also requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`; reads are restricted to the `verification_audit_bundle` operation kind.`n`nSet `VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON` to this exact JSON array. Values below are placeholders and must be replaced by an existing server-admitted tenant and signed run-manifest artifact; do not put keys or credentials in this value.

```json
[
  {
    "tenantId": "<existing-tenant-uuid>",
    "auditArtifact": {
      "artifactId": "<existing-signed-run-manifest-artifact-uuid>",
      "digest": "sha256:<64-lowercase-hex>"
    },
    "runKind": "claims"
  }
]
```

`runKind` is exactly `claims` or `report`. A grant matches the tenant, artifact ID, and digest exactly. The API additionally requires a single succeeded native run whose operation kind is `verification_claims` for `claims`, or `verification_report` for `report`. Duplicate grants and malformed/oversized JSON fail startup. Claims runtime configuration remains required. The worker also requires `VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_JSON`, a server-owned JSON array of `{ "keyId": "<key-id>", "publicKeyPem": "<PEM>" }` entries (1–32; key ID is 1–120 letters, digits, `.`, `_`, or `-`), alongside the grants and claims catalog. Operators must never supply public keys, signing keys, policy grants, or identity claims in a request.

## Submit and read

All calls require normal authenticated server access. Submission needs `operation.submit`; reads need `knowledge.read` and are tenant-scoped.

HTTP submit:

```http
POST /v1/verification/audit-bundles:inspect
Content-Type: application/json

{"verificationContractVersion":"verification.v1","auditBundle":{"artifactId":"<uuid>","digest":"sha256:<hex>"}}
```

A successful submission returns `202` with the operation receipt. Read the terminal resource with:

```http
GET /v1/verification/audit-inspections/<operation-uuid>
```

The typed client methods are `inspectAuditBundle(request, context)` and `getAuditInspection(operationId, context)`. The CLI commands are `bundle inspect` and `bundle show`; `bundle inspect` accepts the strict request above and `bundle show` accepts `{ "operationId": "<uuid>" }`.

MCP submission uses `knowledge_inspect_audit_bundle` with `{context, request}`. MCP reads use `knowledge_get_audit_inspection` with `{context, operationId}`; it does not accept an audit bundle body for reading.

## States and safe handling

- `202`: accepted for asynchronous inspection.
- `403 FORBIDDEN`: no exact server grant, a different tenant, or an authenticated access failure. Do not retry with altered artifact fields.
- `503 CAPABILITY_NOT_ADMITTED`: runtime composition, grants, or reader capability is unavailable.
- `GET 404 NOT_FOUND`: the operation is absent in the authenticated tenant.
- `GET 409 CONFLICT`: inspection is pending and has no terminal resource yet.
- `GET 422 INVALID_STATE_TRANSITION`: the terminal operation failed or was cancelled.
- `GET 503 INTERNAL_ERROR`: retained-record integrity or replay trust failed. Preserve the correlation ID and investigate server-side; do not treat this as a verification pass.

A successful body is a compact audit-inspection resource. It returns result-artifact identity and replay/policy outcomes, not Storage object keys, raw bundles, provider responses, credentials, or a caller-selected verifier.

## Retained local proof

The frozen public transport proof is:

```powershell
corepack pnpm exec tsx scripts/prove-verification-audit-inspection-transports.ts
```

It records a receipt under `../internal/verification-audit-inspection-public-<namespace>.json`. The retained run used for claims/report replay is `../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`; its audit facade receipt is `../internal/verification-claims-report-audit-inspection-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json`. These are local proof inputs, never grant templates.

## Limits

Only claims and report audit bundles are admitted. The proof covers retained local PostgreSQL and Storage records, strict grant denial, cancellation, and a post-result recovery interruption with a higher fence. It does not prove new evidence admission, any other verification family, remote deployment behavior, or an operating-system process kill.


