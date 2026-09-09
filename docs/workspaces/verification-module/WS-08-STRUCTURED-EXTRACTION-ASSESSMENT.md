# WS-08 structured extraction vertical-slice assessment

Updated 2026-09-06. This is a read-only implementation assessment, **not an
acceptance record**. It authorizes no provider call, secret loading, remote
write, migration, or production-promotion claim.

## Decision

The smallest viable `extractStructuredData` slice is a new durable operation
whose only admitted runtime profile is server-owned and synthetic/offline. The
profile selects one registered provider adapter and exact schema/input artifact
bindings. The caller continues to send only registered artifact handles and
the compatibility literal `extractionProfile: "registered_default"`; it never
selects a provider, model, price, retry policy, budget, or processing grant.

Do not repurpose `verification_extraction`. Despite its misleading generic
name, it is the live operation for **`verifyExtraction`**:

- `packages/application/src/verification-service.ts` maps
  `verification_extraction` to `VerifyExtractionRequestSchema` and
  `verifyExtraction`.
- `apps/worker/src/verification-activities.ts` binds it to
  `verify_and_register`.
- API/client/CLI surface only `/v1/verification/extractions:verify` and
  `verifyExtraction`.

Add a distinct operation, proposed as
`verification_structured_extraction: extract_and_register`. It preserves
separate receipts, failure classification, replay semantics, and an honest
completion surface.

## Reusable implementation pieces

| Need | Reuse exactly | Verified behavior |
| --- | --- | --- |
| Strict public input | `packages/contracts/src/verification/requests.ts` `ExtractStructuredDataRequestSchema` | Requires one capture ID, representation and schema artifact references, and fixes profile to `registered_default`. |
| Schema gate | `packages/verification/src/extraction/schema.ts` `admitExtractionSchema`, `validateExtractionCandidate` | Bounded canonical JSON Schema subset; rejects remote refs, unbounded strings/arrays, unknown keywords, cyclic/oversize candidates. |
| Candidate evidence checking | `packages/verification/src/extraction/verification.ts` `verifyExtractionFields` and `ProjectionSelectorResolver` | Re-resolves evidence against immutable representation bytes; handles JSON/table/geometry/transcript selectors and fails closed on ambiguity or digest mismatch. |
| Provider adapters | `packages/verification/src/providers/gateway.ts` `GatewayStructuredExtractionProvider`; `interfaze.ts` `InterfazeStructuredExtractionProvider`; `registry.ts` `registeredProvider` | Request/response bounds, no tools/search/gui, exact raw response persistence hook, schema validation. Registry entries are all `lab`, retry limit zero. |
| Provider custody | `packages/application/src/verification-provider.ts` `VerificationProviderArtifactComposer`, `AccountedVerificationProviderSink` | Registers restricted input before dispatch, exact request before dispatch, raw response/precontext and request-bound envelopes after response; reserves before dispatch and settles or retains uncertainty. |
| Durable dispatch | `packages/application/src/verification-service.ts`, `apps/worker/src/activity-registry.ts`, `packages/persistence/src/operation-service.ts` | Existing submit/outbox/lease/receipt pattern is the required host path. Benchmark activities show cancellation polling and fenced final publication conventions. |
| Tenant artifact custody | `PostgresVerificationRepository` in `packages/persistence/src/verification.ts` | Content-addressed registration and tenant-scoped trusted hydration already exist. |
| Provider budget ledger | `packages/persistence/src/verification-provider-accounting.ts` `PostgresVerificationProviderAccounting` | Transactional reserve, one dispatch claim, settle, and uncertainty handling; existing migrations enforce tenant FKs, state transitions, fences and RLS. |

Useful focused tests already exist:

- `packages/verification/src/extraction/extraction.test.ts` covers schema
  safety, null/absent semantics, selector re-resolution, decimal/totals,
  ambiguity, bounds, tables, geometry, and transcripts.
- `packages/verification/src/providers/providers.test.ts` covers recorded
  provider adapter behavior and bounds.
- `packages/application/src/verification-provider.test.ts` covers artifact
  order/binding and accounted dispatch transitions.
- `packages/persistence/src/verification-provider-accounting.ts` has the
  production persistence implementation; its test location must be confirmed
  before a mutation (the expected sibling test file was absent in this
  inventory).
- `apps/worker/src/verification-activities.test.ts` and
  `apps/worker/src/verification-benchmark-activity.test.ts` are the closest
  operation-admission and cancellation/lease templates.

## Missing trusted composition

`providerRegistry` is source-code metadata, not runtime custody. It contains
fixed adapter/model/configuration digests and promotion state, but does not
bind an extraction request to an immutable profile artifact, tenant grant,
schema digest, representation modality, budget identity, or worker runtime
identity. Its `lab` state must never be interpreted as admission.

There is likewise no extraction executor. `AccountedVerificationProviderSink`
is deliberately dispatch-capable only after its caller supplies the provider,
budget, attempt ID, and grant; neither `apps/worker/src/index.ts` nor
`verificationActivityHandlers` creates it. No API/client/CLI/MCP command
submits `ExtractStructuredDataRequestSchema`.

The existing `registered_default` literal is a routing placeholder only. It
must be resolved by a worker-owned profile catalog, never treated as caller
authority. For the first slice, implement the catalog as strict, signed or
digest-pinned worker configuration in the style of the configured benchmark
runtime. It must contain exactly:

```text
profile ID/version + profile artifact digest
provider ID + adapter configuration digest + expected model
allowed modality and representation artifact type/digest binding
schema ID/version/digest binding and maximum input/output limits
external-processing grant (synthetic only for the first proof)
budget key/ceiling/reservation + retry policy (zero provider retries)
adapter/worker/runtime version and promotion state = offline or lab-only proof
```

The handler must reject absent, duplicate, changed, unapproved, or
profile/provider/configuration/model mismatches before hydration or dispatch.
It must derive a deterministic provider-attempt identity from operation/profile
/request digest/ordinal, rather than accepting one from transport input.

### The operation-claim link is a required first-slice gate

The current provider ledger is insufficient for a production dispatch: its
attempt row has no `operation_id`, `operation_step_id`, profile digest, or
canonical lease fencing token. `AccountedVerificationProviderSink` receives a
caller-supplied canonical orchestration `attemptId`, then generates an
unrelated random UUID `dispatchFence`. This prevents duplicate transition of a
ledger row, but cannot prove that the worker holding the live
`knowledge_service.lease` is entitled to make the external request.

The first production core must add the link. Prefer columns on
`orchestration.verification_provider_attempt` rather than a second mutable
dispatch table:

```text
operation_id          -> knowledge_service.operation(tenant_id,id)
operation_step_id     -> knowledge_service.operation_step(tenant_id,id)
profile_artifact_id   -> orchestration.artifact(tenant_id,id)
profile_sha256        -> retained profile artifact digest
lease_fencing_token   -> fencing token observed at reservation/claim
```

Require a same-tenant composite operation/step relationship, a unique provider
attempt per `(tenant, operation_id, operation_step_id, profile_sha256,
request_sha256, attempt_ordinal)`, and a check that the step is the new
`extract_and_register` step. Replace the current global
`(tenant, request_sha256, attempt_ordinal)` uniqueness; it incorrectly makes
an identical request in two distinct operations collide without recording an
intentional shared-call attribution. The first slice should prohibit sharing,
not silently treat that collision as a cache.

Reservation and the `reserved -> dispatched` transition must verify the active
operation, step, holder, lease token, and numeric fencing token inside the
same database transaction, following the active-lease claim pattern in
`20260906031000_verification_benchmark_comparison_claim.sql`. The accounting
port should accept the canonical `LeasedStep`/claim instead of creating its
own random dispatch authority. A stale lease may retain an already dispatched
uncertain call, but may neither dispatch nor settle/seal a new successful
result. Once `uncertain`, the row must never re-enter `reserved` or dispatch a
second call; reconciliation can only attach authoritative response/cost
evidence and settle it.

## Required execution order and failure semantics

1. Transport authenticates the normal operation context and creates the new
   operation. It accepts only the strict extraction request and header-derived
   routing context.
2. Worker claims `extract_and_register`; verify operation kind, tenant,
   attempt, active state, lease token/fence, and runtime-owned profile.
3. Tenant-scoped hydration verifies the exact registered representation and
   schema handles/digests, their permitted types and bounded bytes. Parse the
   schema through `admitExtractionSchema`; verify capture-to-representation
   provenance before forming a prompt. Do not concatenate arbitrary source
   material or trust document instructions.
4. Register the derived minimal provider input. Require the profile's
   synthetic/public grant and exact modality. Persist the canonical outbound
   request, reserve the budget, then atomically claim dispatch **before** the
   network boundary. The current adapter registry says zero retries; retain
   that for the first slice.
5. After any received body, persist raw response and Interfaze precontext if
   present. Independently validate provider response JSON against the admitted
   schema, register a canonical extraction-output artifact plus a compact
   call/result manifest, and record provider response/model/usage only as
   observations.
6. Call `settleOrRetain`: settle only with provider-reported actual cost and a
   response envelope. A lost/timeout/cancelled response after dispatch becomes
   `uncertain`, retaining the reservation; it is not retryable as a fresh call.
   Reconciliation needs provider evidence or an explicit bounded operator
   decision. Never turn unknown cost into zero.
7. Before every durable result/checkpoint and terminal receipt, recheck active
   operation and lease/fence. If cancellation or stale lease wins, do not emit
   a terminal successful extraction. Return only compact artifact handles and
   state.

Only infrastructure failures before dispatch may requeue automatically. Schema,
profile, artifact/provenance, grant, policy, response-shape, and extraction
quality/evidence failures are terminal completed outcomes or nonretryable
failures as appropriate. A provider timeout after dispatch is an accounting
uncertainty, not evidence that the provider did not act.

## Canonical persistence assessment

Already canonical in `ai-engineer-db-contract`:

- `orchestration.verification_provider_budget` and
  `orchestration.verification_provider_attempt` from
  `20260906010000_verification_provider_budget_accounting.sql`, hardened by
  `20260906012000`, `...13000`, and `...14000`: tenant-scoped reservation,
  request-digest/ordinal uniqueness, dispatch fence, append-only transition
  guard, settled/uncertain distinction, and RLS.
- Provider artifact types and lineage admission from
  `20260906011000_verification_provider_artifact_types.sql`,
  `...15000`, `...18000`, and
  `20260906021000_verification_artifact_consumer_admission.sql`.
- Existing immutable verification artifacts, source/capture/locator provenance,
  and operation/receipt/outbox tables.

Necessary mutation additions:

1. Add `verification_structured_extraction` to the canonical operation-kind
   contract/allowlist and its sole `extract_and_register` activity step.
2. Add canonical artifact types for `verification_extraction_output` and a
   `verification_structured_extraction_manifest` (or use an existing generic
   run manifest only after its mandatory fields can truthfully describe an
   extraction call). The output must bind candidate JSON, schema digest,
   representation/capture handles, provider response envelope and profile
   digest; raw provider bytes remain restricted.
3. Add one durable extraction-run/result relation only if the existing
   `evidence.verification_run` cannot represent a producer-less extraction
   candidate without inventing a verifier/policy terminal result. Recommended:
   `evidence.structured_extraction_run`, keyed by tenant and operation, with
   immutable input/profile/output/response-envelope artifact FKs, provider
   attempt FK, status and exactly one terminal transition. Do not overload
   `evidence.verification_run`; it requires deterministic result and policy
   artifacts and models an independent verifier run.
4. Extend `orchestration.verification_provider_attempt` with the operation,
   step, profile, and active-lease fencing binding above; harden its transition
   trigger/RLS and update `PostgresVerificationProviderAccounting` to require
   that claim. This is necessary for the first production core, not a future
   scalability enhancement.

No provider-profile database table is required for the first slice if the
profile is a signed/digest-pinned runtime catalog and the profile artifact is
retained with the run. A canonical profile table becomes necessary before
multi-profile selection, tenant-specific provider enablement, promotion state
changes, or audit queries must be managed transactionally rather than by a
deployment-controlled catalog.

## Smallest honest actual proof

Use one fresh synthetic tenant/capture/representation and a tiny bounded JSON
schema, a single server-owned synthetic-only profile, and an injected local
recorded-response adapter. Run it through the real API -> durable operation ->
worker -> PostgreSQL/Storage path. The adapter must make **zero network
requests** and return a fixed provider-shaped response; it demonstrates
composition and custody, not Gateway or Interfaze availability.

Assert: one operation/lease/receipt; exact profile/schema/input/request/raw
response/output/manifest artifact digests and lineage; one reserved then
settled provider-attempt row with a nonzero synthetic actual-cost observation
(or explicitly `uncertain` in a separate withheld-response scenario); compact
receipt only; duplicate submit returns the same operation; changed request
under that identity conflicts; foreign tenant cannot read it; stale lease and
cancel-before-final-write cannot seal success. Add a second invocation where
the recorded response is withheld after dispatch and prove no automatic second
dispatch and retained uncertainty/reservation.

This proof may establish the extraction operation's offline synthetic custody,
dispatch fencing, and uncertainty semantics. It does not establish live
provider health, pricing/billing accuracy, production provider promotion,
quality against human gold, calibrated confidence, or independent verification.
