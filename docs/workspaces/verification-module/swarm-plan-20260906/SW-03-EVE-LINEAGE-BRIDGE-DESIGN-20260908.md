# SW-03 — native Eve lineage bridge design (2026-09-08)

## Decision

Use a host-signed, single-request Eve invocation attestation plus a small canonical Postgres binding ledger. The Eve host issues the stable verification grant and idempotency key before execution, then signs the actual session/turn/tool-call lineage after Eve assigns it. The model receives only admitted artifact handles and tool input. It never receives a signing key and no request field can create authority.

The KS API verifies the attestation and the existing static ownership grant, then atomically claims or reads the immutable operation binding. The first valid invocation fixes `OperationContext.externalExecution` for the life of the operation. A later valid invocation with the same host-issued idempotency key and request digest may have a different Eve turn/tool-call lineage; it is recorded as a retry invocation, while the resolver returns the original stored operation context. This preserves the existing operation request hash and idempotency behavior.

An attestation-only change is insufficient. `resolveVerificationContext` runs before `PostgresCanonicalRepository.createOperation`; two first calls can therefore both resolve different contexts before one operation exists. The loser then gets `IDEMPOTENCY_CONFLICT`, and there is no durable replay ledger. The binding claim must be serialized in Postgres before operation submission.

## Existing interfaces and limits

- `apps/api/src/server.ts` already passes the authenticated `FastifyRequest`, tenant, identity, idempotency key, use case and parsed hints to `resolveVerificationContext`. This permits a narrow host-attestation header without adding model-visible request fields.
- `apps/api/src/verification-ownership.ts` currently admits only a server-configured tenant/actor/mission/deployment/capability grant and requires caller external hints, when present, to equal the configured external execution. Keep those checks for Mission Control and static integrations.
- `orchestration.agent_session` canonically maps `eve_session_id` to tenant, mission and agent deployment. `orchestration.attempt.agent_session_id` and `eve_turn_ids` can corroborate the Eve session and turn. They do not authenticate a tool call, freeze first lineage, or record retry invocations.
- `knowledge_service.operation.request.authenticatedContext` and step inputs persist the original trusted context. `createOperation` hashes that request and requires exact equality on duplicate idempotency keys. Consequently a retry cannot substitute its new turn/tool-call lineage into the operation context.
- Eve's active adapter derives the same operation UUID using the shared runtime package and uses a host-issued idempotency key. Its actual lineage is `sessionId`, `turnId`, `toolCallId`, and `rootSessionId`; Eve assigns session and turn identifiers at runtime.

## Wire protocol

The trusted Eve host or a host-local proxy adds one header, for example `x-eve-runtime-attestation`. Use a compact signed envelope with strict schema `eve-runtime-attestation.v1`; JWS EdDSA is adequate if the repository's existing Ed25519 verifier is reused.

Signed payload:

```text
version, issuer, keyId, audience="knowledge-services:verification",
jti, issuedAt, expiresAt,
grantId, tenantId, principal,
missionId, workItemId, attemptId, agentDeploymentId,
useCase, requestDigest, idempotencyKey, operationId,
externalExecution={runtime:"eve",runId,rootRunId,sessionId,turnId,toolCallId}
```

`operationId` must equal the existing shared deterministic UUID for `tenantId:useCase:idempotencyKey`. `requestDigest` must equal KS's canonical digest of the parsed verification request body. The signature covers the protected header and exact canonical payload bytes. Reject unknown fields, duplicate JSON keys, non-canonical encodings, unsupported algorithms, unknown/disabled keys, wrong audience/issuer, expired or excessively future attestations, and values over tight byte limits.

The trust boundary is capability reachability, not necessarily a separate OS process. The active authored `verify_evidence_bundle` callback runs in the Eve Node host and receives genuine `ctx.session.id`, `ctx.session.turn.id`, `ctx.callId`, and the abort signal. That callback may hold a signing closure or call a host-only signer in the same process, provided the private key and arbitrary signing API are unreachable from model messages and tool arguments. The signed fields must be assembled by fixed host code from the selected server-issued grant, parsed request, and runtime `ctx`; for this verification call, the model may only choose values allowed by the strict tool input schema.

The current `.eve/agent-summary.json` lists exactly one authored tool, no skills, connections, sandbox, or subagents. Eve also has session-dependent framework defaults that are not enumerated as authored tools in that summary. Its documented shell/file defaults proxy into an isolated sandbox with no `process.env`, secrets, or path into the app runtime; provider web search and app-runtime utility tools likewise do not expose a raw host signer. Same-process signing is therefore acceptable only while this separation remains true. Native acceptance must capture the effective runtime tool inventory and prove that no tool, connection, dynamic capability, debug endpoint, or sandbox mount can read host environment/secrets or invoke the signing closure with caller-selected bytes.

The ordinary bearer token still authenticates the KS service principal. The existing ownership catalog still authorizes that principal for the exact tenant, mission, attempt deployment, and capability. A valid host signature proves runtime facts only; it does not replace authorization.

The adapter may continue sending the actual `x-external-*` headers. KS must require exact equality between those headers and the signed lineage, preventing a caller from mixing an attestation with asserted lineage. If the host proxy injects the signed header after receiving the request, it should also overwrite the external headers from its trusted context.

## Canonical binding ledger

Add one migration in `ai-engineer-db-contract/supabase/migrations` with two tenant-scoped tables (names illustrative):

1. `knowledge_service.eve_operation_binding`: `(tenant_id, operation_id)` primary key; unique `(tenant_id,idempotency_key)`; `grant_id`, `use_case`, `request_sha256`, actor identity, mission/work/attempt, deployment, capability, and `original_external_execution jsonb`; issuer/key ID/JTI and timestamps. Add checks for runtime `eve`, bounded strings and operation identity. Make rows immutable with `util.reject_mutation`.
2. `knowledge_service.eve_operation_invocation`: append-only invocation/JTI, binding FK, exact observed external execution, `invocation_kind` (`original` or `retry`), issuance/acceptance times. Unique `(issuer,jti)` makes retransmission of the same signed envelope idempotent and prevents that attestation from being rebound. A new JTI is a distinct host-attested invocation even when its lineage is identical, so its row is deliberately retained; `lineage_sha256` supports audit grouping and is not unique.

Expose one repository transaction such as `resolveEveVerificationBinding`. Inside it:

- lock the idempotency-key binding (an advisory transaction lock derived from tenant + idempotency key is needed when no row exists);
- recheck the canonical mission/work/attempt/deployment chain and, where populated, require `attempt.agent_session_id -> agent_session.eve_session_id` and membership of `turnId` in `attempt.eve_turn_ids`;
- insert the first binding or require every immutable grant/request/operation field to match the existing row;
- append/idempotently observe the signed invocation;
- return the binding's `original_external_execution`, never the current retry lineage.

The operation insert remains in its existing transaction. If it fails, the binding can safely remain as an admission claim with no operation; a same-bound request can retry. A short expiry/reconciliation query can expose orphan claims for operations that never materialized. Do not delete or repurpose them, because doing so would permit a different first lineage to replace the original.

## Minimal code changes

- `apps/api/src/verification-ownership.ts`: split the common static grant/attempt validation from the external-runtime branch. For Eve, verify the signed envelope through an injected verifier, recompute body digest and operation ID with shared implementations, call the new binding repository method, and construct context using the stored original lineage. No wildcard matching and no caller-selected fallback.
- `apps/api/src/index.ts`: load a bounded server-owned Eve issuer/public-key catalog and construct the verifier. The private key remains in the Eve host/proxy only.
- `packages/persistence/src/postgres.ts` (or a focused `eve-verification-binding.ts` exported by persistence): implement the single binding transaction.
- `apps/api/src/server.ts`: only header-size/shape plumbing if the resolver reads the raw request header directly; keep the existing post-resolution exact hint checks.
- DB contract migration and generated database types for the two tables.
- Eve host integration: inject a bounded signer into `executeEveVerification` and sign immediately before its KS fetch, using the genuine lineage passed by the authored callback. No change to the model-facing verification tool contract is required, and the current callback supplies the required IDs, so no sidecar is needed. A host-local sidecar is only a fallback for a deployment where trusted callback/middleware code cannot access actual runtime IDs. Never expose the private key, raw signing primitive, environment access, or caller-chosen signed payload to the model/tool schema.

## Threat handling

- **Caller/model assertion:** external headers alone remain untrusted. Missing or invalid host signature is denied before operation admission.
- **Replay:** issuer/JTI uniqueness, short validity, exact audience, tenant, principal, request digest and operation binding prevent cross-request reuse. Identical network retransmission returns the same binding; reuse with changed data is denied.
- **First-call race:** the tenant/idempotency advisory lock serializes an absent-row claim. One immutable original lineage wins; a concurrent different valid invocation becomes a recorded retry against it.
- **Wrong tenant/principal/mission/attempt:** require equality among bearer identity, static catalog, signed payload, request, and canonical tenant-scoped joins. RLS/set tenant context remains mandatory.
- **Cancellation:** cancellation authorization uses the stored original operation context and actor. A signed current invocation may request cancellation only when its grant permits it and it resolves to the same binding. Terminal-operation semantics decide cancellation races; an abort is never reported as success.
- **Retry with new tool lineage:** validate and append the new invocation, then return the original external execution. The operation request digest and provenance are unchanged, while the invocation ledger retains the retry lineage.
- **Compromised signing key:** scope issuer keys to Eve verification audience/deployment, support disabled/not-before/not-after metadata, and retain key ID on every row. Static KS authorization still limits damage to pre-granted tenant/mission/attempt/capability tuples.
- **Unregistered Eve provenance:** the configured issuer key plus the matching static ownership grant is the authoritative runtime attestation source. `agent_session` and `eve_turn_ids` are supplemental corroboration: if those fields are populated they must match; if absent, admission may proceed but must not be described as database-corroborated. Native proof should either seed them from an actual trusted runtime callback after Eve assigns the IDs, or state explicitly that issuer attestation, rather than canonical session/turn rows, supplied the runtime proof. Caller assertions never substitute for either source.

## Tests and native proof

Unit tests should cover signature/key/audience/time/schema failures, digest and operation-ID mismatch, external-header mismatch, static-grant mismatch, and wrong tenant/actor/mission/work/attempt/deployment. Persistence tests should exercise concurrent first claims, repeated JTI, same lineage retransmission, changed-lineage retry, immutable original context, orphan-claim recovery, and append-only guards.

An API integration test must use the real resolver and Postgres service: submit with lineage A, then resubmit the exact request and host idempotency key with signed lineage B; both yield the same operation ID, the durable operation stores lineage A, and the invocation ledger contains A and B. Add denial cases for corrupted locator/request digest and same-deployment verifier rules already required by VR-024. Cancellation tests must cover abort before insert, queued/running cancellation, cancellation versus terminal completion, and subsequent read.

The native Eve proof then runs the built agent through the trusted host hook against the real authenticated KS API, worker, Postgres, and Storage. Capture the Eve catalog/tool result, signed-attestation metadata (never the private key), operation/step/receipt/event IDs, binding and invocation rows, and terminal artifact lineage. Keep mock-model transport and live-model evidence separately labelled.

## Rejected shortcuts

- Dynamic or wildcard `externalExecution` grants weaken the existing trust boundary.
- Treating Eve headers, grant JSON in the agent environment, or a model-selected grant ID as attestation lets the caller mint authority.
- Replacing runtime IDs with preassigned fixture IDs is not a native Eve proof.
- Recomputing KS UUID/canonicalization code in Eve creates drift; continue using the shared packages.
- Updating `authenticatedContext.externalExecution` on retry would mutate original provenance and break exact idempotency.
