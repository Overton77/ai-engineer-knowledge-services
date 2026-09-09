# Packet decision runtime handoff — 2026-09-08

This is an implementation checkpoint, not launch acceptance. Original specification and LAUNCH-GAP-CRITICAL-PATH-20260908.md remain in force.

## Working path

Canonical database contract 0.2.37 / 142 migrations includes immutable subject-bound reviewer grants and decisions. The decision application prepares exact packet-bound bytes; the worker checks the authenticated durable request and lease, registers the artifact, and commits/revalidates the immutable decision. Retained native operation 255bfea1-57f2-4798-8705-7bb5dd1d6aa3 recovered from fence 837 to 839 with one decision and terminal receipt.

API production startup now composes decision admission, registered Storage/signed source replay, and authorized historical reads. Worker startup registers the matching handler when explicitly configured. Public paths:

- POST /v1/verification/adjudications:record-decision
- GET /v1/verification/adjudication-decisions/:operationId
- Client recordAdjudicationDecision / getAdjudicationDecision
- CLI adjudication decision / adjudication get-decision
- MCP knowledge_record_adjudication_decision / knowledge_get_adjudication_decision

GET has native local-loopback HTTP/client, CLI-dispatch-through-HTTP and MCP-executor-through-HTTP evidence in internal/verification-decision-native-public-read-ae8a96b6-b462-42e7-b571-4fbb678fe8a4.json. The database was read-only. This does not prove full production startup or POST-to-worker execution.

## Deployment configuration

Both API and worker require VERIFICATION_ADJUDICATION_DECISIONS_ENABLED=1 to expose decision recording. Unset or 0 stays disabled. Optional VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON is a bounded strict array of tenantId, actorId and role. An omitted array means no synthetic authority. A service human_reviewer identity always produces synthetic_engineering provenance; it never contributes human votes.

The existing adjudication trust stack is required: audit grants, public keys, claims projection grants, parser image digest, canonical PostgreSQL and registered Supabase Storage configuration. API also requires dynamic server-owned mission/attempt ownership grants. Worker retains its existing enclosing verification/sealing configuration requirements. Do not copy proof credentials into deployment configuration.

Human authority is resolved from the canonical immutable subject-bound reviewer-grant table. Applications cannot grant themselves authority. The dashboard must bind its signed session subject to an exact server-owned KS human credential before human submission; its general static KS service token is insufficient. No human credential/grant was provisioned by this work.

## Semantics

An affirmative decision records evidence. It does not change admission, original policy outcome, or human-gold scoring eligibility. Public quorum fields are the recorded operation snapshot, not a current aggregate. Historical reads validate authority at decision creation, not whether the original grant is still live today. Subject expiry is checked when preparing and committing.

## Remaining sequence

1. Run the complete API-startup POST → production worker → terminal read proof using a clearly synthetic reviewer and retained signed packet; no new model calls are necessary.
2. Finish Mission Control dashboard form, proxy, terminal display and signed-session reviewer mapping; retain a disabled state when mapping is absent.
3. Verify dashboard request → worker → terminal evidence and isolation/recovery controls; run relevant consumer checks.
4. Reconcile VR-007/014/026/028 local acceptance against exact retained source snapshots, then continue benchmark human review, Cloud/runtime and deployment gates from the launch critical path. Do not substitute local synthetic proof for human quality or Cloud proof.

## Completion update after integration review

The full API-startup POST → production worker → terminal GET proof now passes using WORKER_OPERATION_ID to scope startup reconciliation and every claim to the new operation. Receipt: internal/verification-decision-full-startup-966fb678-1dc4-55ec-aa7d-683ba71e8696.json. The scope custody receipt explicitly distinguishes retained before statuses from after statuses/timestamps; no before timestamp snapshot is claimed. All 72 KS typecheck/test/build tasks pass in verification-decision-public-integration-20260908-r3.log. Earlier MCP catalog and OpenAPI omissions were fixed, not waived.

Dashboard review form/proxy/terminal integration is implemented and reviewed. The server-only DASHBOARD_HUMAN_REVIEWER_KNOWLEDGE_TOKENS_JSON mapping requires exact subject, tenantId, missionId, workItemId, attemptId and knowledgeToken. The token must authenticate as the intended human and match KS canonical ownership/reviewer grants. This mapping is never supplied by the browser. Missing mapping disables submission and the proxy fails closed. The proxy scopes idempotency to the signed session identity, forwards exact configured ownership, validates strict inputs and projects compact accepted/terminal responses. UI freezes the attempted payload, polls pending 409 responses and displays terminal failure and recorded quorum separately from admission.

Dashboard 45 unit tests/typecheck pass per SW-03 receipt r3. Root browser proof passes nine scenarios, including four new mocked decision/recovery flows and five existing regressions. Browser route fixtures are explicitly mocked; they do not establish a real human session/grant or a single native browser-to-Storage chain. The two initial regression fixture mismatches were updated to the expanded control-state DTO and separate expiry display; the rerun passes. Final current-source dashboard production build is being recorded separately.

Next: combine the signed dashboard session/proxy with the native KS decision worker in one bounded synthetic engineering proof if needed for VR-014 acceptance, then reconcile local VR-007/014/026/028 evidence. Real human provisioning/labels, Temporal Cloud and deployment acceptance remain outside these engineering proofs. No acceptance row has been promoted by this checkpoint.

## EV-154 successor checkpoint

The combined signed dashboard proxy proof now passes: operation `4bc6d7c7-b004-53d5-a252-b5d67bebc9d9`. It uncovered and fixed the dashboard's erroneous vote-count cap; recorded counts may exceed required quorum, while reached still requires sufficient human affirmations and no human rejection. The proof remains synthetic and changes neither admission nor human-gold eligibility.

VR026 and VR028 are accepted; VR014 is partial; VR007 has implemented leaf evidence and native/legacy compatibility proof but remains partial for its gold field audit. Current matrix23 proved/15 partial/8 missing. FullKS72/72 and dashboard47/47 pass. Aggregate receipt `internal/verification-leaf-security-EV154-20260908.json` SHA256 `f6addf006426ca30949de38ada74635e0d0508e4b96abe83d3bbb1224d9c762e` binds current source snapshots and proofs. Follow the launch critical path's EV154 reorientation; do not rerun the completed synthetic review bridge as a substitute for human review.

### EV-155 — launch preparation and populated compatibility
The frozen-fixture bridge passes independent r4 review and root9/9 tests (verification-loopback-fixture-bridge-root-r4-20260908.log, exit0). It binds the kernel-derived workflow and exact launch bytes, limits routes/credentials/traffic/lifetime and redacts upstream failures. No tunnel was opened. The isolated provider rehearsal c9c5fa59 reached93→142; before/after legacy identity/accounting SHA256 a8a953f3647b34341b94364c0b525fa540abd51ae95c39ad58f2f38687cd46e1 matches. All six scope fields are null and both partial indexes exist. Original passed:false is retained: PostgreSQL JSON whitespace caused the harness assertion failure. Reviewed successor parses the recorded values and accepts the bounded rehearsal; no migration rerun was needed. Root matched all142 current canonical migration hashes. Both owned rehearsal containers are stopped with volumes retained. Remote metadata confirms49 pending migrations and one settled legacy provider attempt; zero remote writes. The180-case pack is unchanged, restricted internal preparation, zero human labels. Matrix remains23 proved/15 partial/8 missing. Aggregate internal/verification-launch-preparation-EV155-20260908.json SHA256 bb86e8722f0cbcb819295dcde95afbe5a6641b014d093bd61714255e4c2fe65f. Next: D015 human campaign; D016 namespace/address; D017 bounded endpoint decision; D019 reviewed rollout window, then Cloud/deployment/final audit. No new provider calls. Goal active, unfinished.
