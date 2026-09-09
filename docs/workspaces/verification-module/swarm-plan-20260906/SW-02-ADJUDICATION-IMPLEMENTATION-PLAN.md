# SW-02 Adjudication implementation plan

Date: 2026-09-07. This is a read-only implementation inventory and design. It does not claim an adjudication route, human decision, or policy override is currently enabled.

## Grounded requirement

Specification section 16 requires canonical storage for human-review items and policy overrides. Sections 8.5 and SW-02 require append-only judgments; SW-02 step 4 requires `requestAdjudication` to create an authorized, bounded queue item with evidence handles and failure context, preserve immutable reviewer decisions, handle conflict, and allow later decisions to coexist. Section 17 separately requires adjudicate and policy-admin authorization. A model-produced label is not human adjudication or human gold.

The current request contract is deliberately only a requester-side envelope: `RequestAdjudicationRequestSchema` permits an assertion, evidence, or run target, a bounded reason, an artifact ID/digest evidence packet, and an optional <=1,000-character requester note. It has no decision payload. `VerificationOperationApplicationService.submitRequestAdjudication` throws `OperationCapabilityUnavailableError("verification_adjudication")`, and `apps/api/src/server.ts` registers no `/v1/verification/reviews` route. This fails closed today.

## Reusable native paths

| Existing path | Reuse | Limit for adjudication |
| --- | --- | --- |
| `knowledge_service.operation`, `operation_step`, leases, receipts and outbox | Create a durable request operation (`verification_adjudication`, step `request_adjudication_and_register`) under the established idempotency/context/lease lifecycle. | It does not supply a review subject or an authorized decision by itself. |
| Content-addressed artifact ledger and the verified claims/report sealer | Store an immutable `verification_adjudication_packet`; bind the source signed run/audit manifest, retained deterministic result, policy outcome/gate where applicable, exact evidence handles, target and request context. Register via the same live-lease fence used by claims/report terminal outputs. | A vocabulary row alone does not establish packet structure, authorization, or append-only decision semantics. |
| `knowledge_service.review_subject` / `review_decision` and `PostgresCanonicalRepository.createReviewSubject` / `recordReviewDecision` | The tables already provide tenant scope, immutable rows, guarded digest, eligible role list, quorum, expiry, per-reviewer uniqueness, and a decision-operation reference. The persistence method also verifies the stored subject digest and eligible role. | Its `subject_kind` excludes verification adjudication; `subject_ref` is untyped JSON; decisions do not require a signed packet handle or verification run/manifest/policy binding; the API does not expose it. Existing role grants include `executor_service` and `control_plane` writes, so database role possession is not reviewer authority. |
| `evidence.verification_run` plus signed manifests/replay | Verify that a request targets a tenant-local, sealed run and bind exact full artifact handles/digests rather than display text or mutable JSON. Existing verification run constraints already enforce producer/verifier separation and terminal artifact bindings. | It has no foreign key for a review packet or decision and cannot represent an override lineage. |
| local API identity resolver (`KNOWLEDGE_API_IDENTITIES`) | The actual server identity mechanism binds bearer tokens to an `Actor` plus tenant roles/scopes. `ActorSchema` supports `kind: "human"`; `knowledge_admin` is the only defined role whose current action mapping includes `decision.record`. | No existing action distinguishes adjudication from generic decision recording, no route checks `actor.kind === "human"`, and no configured reviewer roster/key is present. Do not treat `knowledge_operator`, `control_plane`, `executor_service`, or a `human_reviewer` service identity as a human approval. |

The applied vocabulary migration `20260907010000_verification_claim_report_artifact_types.sql` already registers `verification_adjudication_packet` and `verification_adjudication_decision`. It makes no table, constraint, grant, worker, or route change.

## Canonical persistence work

Add this only through a new `ai-engineer-db-contract` migration and regenerated types.

1. Add a verification-specific immutable review subject table (recommended) rather than weakening unrelated generic constraints. It must include: tenant ID; request operation/step; requester's authenticated actor identity; target kind/ID; reason; exact full `verification_adjudication_packet` handle and SHA-256; sealed verification run ID and signed manifest artifact/sha; policy artifact/version and report gate handle when present; requester note; eligible reviewer roles; quorum; expiry; and timestamps. Add same-tenant FKs for every canonical ID/handle and a unique idempotency identity such as `(tenant_id, request_operation_id)`.
2. Add an append-only decision table linked to that subject. Each decision stores: tenant ID; decision operation ID; reviewer `Actor` identity serialized canonically; reviewer authorization basis/version; exact packet digest; decision enum (`uphold`, `overturn`, `defer`, `request_changes` is a reasonable bounded starting set); scoped disposition/override effect; bounded rationale; optional expiry; creation time; and an immutable decision artifact handle/digest. It must not contain an asserted verifier identity, arbitrary evidence bytes, raw manifest, or a benchmark/gold-label flag.
3. Enforce at the database layer: insert-only for subject and decision; same-tenant foreign keys; decision packet digest equals subject packet digest; review decision’s authenticated actor is a human identity; reviewer authorization is an admitted roster/grant at decision time; a decision may not self-reference its output artifact; and immutable idempotency collision detection. A later decision by a different reviewer or a re-review request may coexist. A replacement must link to the prior decision rather than mutate it.
4. Keep adjudication distinct from policy override. A policy override needs a separately typed, append-only record that binds the exact policy artifact/version, sealed run/manifest and the adjudication decision(s) that authorize it. It must be scoped (assertion/evidence/run), expire when intended, and state the resulting admission disposition. It cannot rewrite deterministic findings, report gates, evidence edges, or the original policy decision.
5. Do not reuse `evaluation.review_task` / `evaluation.review_decision` for this path: their target arc has no verification run/evidence packet binding, their rows are mutable queue state, and their historical decision schema feeds labels. Do not write any adjudication decision to `evaluation.eval_label`; no submitted annotation or model result becomes human gold without independently authenticated human adjudication and the existing benchmark-bound adjudication artifact rules.

A narrower alternative is to extend `knowledge_service.review_subject` / `review_decision`, but only with a migration that adds a `verification_adjudication` subject kind, exact typed packet/run bindings, human actor/authorization enforcement, and a separate policy-override table. The existing generic `subject_ref jsonb` alone is insufficient.

## Bounded application and public shapes

### Request

Keep the current public `RequestAdjudicationRequest` bounded. Before enqueue, the service must resolve the target against tenant-scoped canonical rows, hydrate the supplied packet as a complete registered handle, and compose the packet server-side from the sealed audit bundle/run rather than trusting caller-supplied evidence metadata. The worker writes the packet through a live lease fence, creates the review subject, and emits a sealed terminal receipt. Request success is `202` with an operation receipt; it is not an adjudication result.

Suggested internal request result: `{ operationId, state: "queued", reviewSubjectId?, packetArtifact? }`, with the subject/packet identifiers present only after their durable creation and authenticated reads. Repeated identical submission returns the original operation/packet; changed payload with the same idempotency key conflicts.

### Decision

Introduce a separate authenticated mutation, for example `POST /v1/verification/reviews/{reviewSubjectId}/decisions`, only after an explicit server-side adjudicator authorization configuration exists. Its strict body should be limited to `{ packet: full handle, decision, rationale, dispositionScope, expiresAt? }`; it must exclude `reviewerIdentity`, tenant, policy version, evidence content, selectors, artifact parents, and any human-gold declaration. The API derives the actor and tenant from the bearer, verifies `actor.kind === "human"`, and resolves a server-owned adjudication authorization grant/roster. It then creates a decision operation/receipt and appends the decision through the native repository.

The currently real authorization vocabulary is `KNOWLEDGE_API_IDENTITIES` plus tenant grants. `knowledge_admin` includes `decision.record`; `knowledge_operator` does not. That provides a possible transport gate only, not sufficient human reviewer authority. Add an explicit configuration/parser for an adjudicator roster or signing-key identity bound to tenant and permitted review role, and fail startup/return 503 when absent. Never infer authority from a display name, requester-supplied reviewer role, service token, database role, or client-provided `approved` field.

Read endpoints should expose only sanitized, bounded subject/decision summaries and full artifact handles permitted to the tenant; raw packet/audit bytes remain behind the existing artifact/read custody controls.

## Required native proof cases

1. A genuine claims and report request uses retained signed runs and a full content-addressed packet; readback validates all handles, signature, digest, tenant, target, policy and report-gate bindings.
2. A changed packet byte, forged artifact handle, target/run mismatch, cross-tenant packet, stale artifact, or unsigned/corrupt manifest is rejected before subject creation; no receipt or terminal packet is published.
3. Missing reviewer configuration denies the decision route. A `knowledge_operator`, service actor, model actor, caller-supplied human identity, and a configured human outside the roster all fail before writes. A rostered `Actor.kind === "human"` with the explicitly permitted role succeeds.
4. Packet digest mismatch, expired subject, wrong tenant, altered policy/version, altered report gate, decision-to-another-subject, and a decision operation without a live lease fail closed.
5. Same request/idempotency returns the original subject; changed same-key request conflicts. Concurrent decision writes preserve append-only rows and the intended per-reviewer idempotency rule. Conflicting decisions coexist and resolve to `review_required` until the configured quorum/conflict rule makes a new policy disposition; no prior result is changed.
6. UPDATE and DELETE against new subject/decision/override rows fail under the actual application roles; direct writes by worker/executor roles cannot manufacture human decisions. Readback verifies RLS tenant isolation and grant scope.
7. A policy override is accepted only when its exact authorizing decision set, policy artifact/version, run/manifest and scope match; it changes only the derived admission disposition. Deterministic failures and signed historical findings remain unchanged. Replay reconstructs the same derived result and rejects altered decision/override bytes.
8. Cancellation and expired-lease windows produce no packet/subject/decision terminal artifact; replacement recovery returns exactly the retained packet/receipt without a duplicate human decision. Retain failure journals.
9. Prove every generated decision uses an authenticated human actor and remains unavailable as evaluation gold unless a separate, explicit benchmark adjudication binding and human-gold eligibility proof exists. Model or synthetic labels remain `agent_generated`/engineering evidence, never human gold.

## Current status

No canonical adjudication persistence, configured human adjudicator authority, worker handler, API/CLI/MCP/client surface, or native proof exists. The available generic review ledger is valuable infrastructure but cannot safely be advertised as verification adjudication until the bounded extensions and proof above are complete.

## Sources and read-only evidence

- Specification: `docs/specifications/verification-module.md`, sections 8.5, 16, 17 and SW-02 in `docs/workspaces/verification-module/swarm-plan-20260906/03-SWARM-INSTRUCTIONS.md`.
- Source hashes: requests `B78973A6205808D9BC783A941B709197AA61DBF58ABA7E202A0EFBB3789BD412`; service `958F9652A9F528AFA8D7BAFF9EED762793748AFB2D1508AB57747A5680B3D138`; API `12DFE6E7C43F9C5130374A8BE86A120094DE6FF680B7AC2AD35F7CA894F14278`; config auth `741913D8197B21A01035E80D7164178209FC496455DCB47C9E62DCD96E621EC1`.
- Migration hashes: verification persistence `DEB83B7828FF3534FDBA3A77FABBA61774B4845C6E02BBFBDE8003D9409E67A6`; runtime security `31D42CE7897583C431B6A307FF0E1046F5D2A1667BF74A657EA6158E5D769815`; vocabulary `557F35E3B25C551DB333E0944F622D98E2806F803ED54866520B3A9E4947E8DD`.
- Read-only local PostgreSQL inventory: 127.0.0.1:54322 queried through the persistence package. It confirmed the existing review and verification tables, their columns, and current table grants. No mutation was performed.