# Verification service composition gates

Coordinator preparation for WS-08, based on specification sections 17–20 and reviewed WS-03/04/05 boundaries. This is a work brief, not implementation evidence.

## Shared trusted application boundary

All HTTP, CLI, MCP and worker routes must invoke one application service. Existing versioned verification commands and receipts live in contracts/verification/operations.ts. Use the existing orchestration capability/operation infrastructure, tenant authorization and actor/mission/work-item/attempt propagation; do not create a second unrelated job system. Public parameters must be allowlisted and bounded per use case, rather than forwarding the generic parameters object to providers or runtime configuration.

The pure semantic admission helper takes a deterministic result supplied by trusted composition. Never accept that result, authority flags, principal bindings, judge identities or an opaque-admission substitute from an HTTP/MCP caller. The application must hydrate authorized artifacts, recompute mechanics against the submitted bundle and exact selected fragments, then call semantic admission. Recorded source assessments are reviewable inputs with provenance; a caller saying independent or licenseKnown does not establish those facts.

## Parser admission in replay

Generic provenance/replay.ts currently hydrates registered canonical projection bytes and invokes supplied selector resolvers. It does not revalidate the native-parser admission envelope. Before claiming full replay admission, wire the existing VerificationAdmissionService.hydrateAdmittedProjection path into trusted application composition. Persist and bind the capture-specific envelope alongside source/native/projection identities so replay re-authorizes original source bytes and validates all ordered parents, parser identity, transformation signature, exact projection ordinal and residual state. Fail closed on missing/forged/cross-parent envelopes. Do not silently replace failed evidence with a newly parsed artifact.

There is also a representation mismatch to resolve explicitly: native admission stores parentless content-addressed projection bytes and puts source/native/projection lineage in the capture-specific transformation envelope. `packages/verification/src/deterministic/engine.ts` currently requires a projection handle itself to declare the capture parent and transformation signature. Genuine admitted projection handles therefore cannot pass that older direct-parent check. Do not manufacture different handles for already registered bytes or delete the lineage check. Extend the admitted projection contract and trusted replay composition so the core can verify a validated envelope binding, while retaining the old direct-parent path only for its explicitly supported historical representation. Test both successful native replay and missing/wrong-capture/native-ordinal/parser/residual/parent failures.

Recorded policy-input artifact bytes are separately sealed and replayed without model calls. Preserve this offline path; offline replay must not acquire new sources or silently rerun judges. New versions require new immutable runs with explicit comparison and lineage.

## Durable execution and failure

The existing worker uses legacy source-captures/content-derivatives stores. Verification artifacts belong to the reviewed ai-engineer-cloud-bucket policy and repository; wire that configuration explicitly. Register all outputs before terminal success, and finalize once with operation fencing/idempotency. Candidate artifacts may survive a failed operation but must not become an accepted run. Exercise cancellation after source acquisition, parser creation, provider response and artifact writes, including partial infrastructure failure and restart. Classify completed quality failure separately from infrastructure failure; retry only eligible infrastructure errors with every attempt accounted.

Current artifact Storage I/O lacks its own total cancellation/deadline control. Close this production operation gap or record a bounded external operation timeout plus safe uncertain-state reconciliation before claiming cancellation completeness.

## Transport proof

Implement the specification's route/tool/CLI inventory against the same application calls. Long mutations return 202 receipts with mandatory idempotency keys. Enforce separate run/read/replay/adjudicate/promote/policy-admin authority. Handle-based inputs still require tenant authorization before hydration. Return compact summaries, typed versioned errors, stable pagination and authorized handles; restricted provider payloads and arbitrary upstream errors must not escape.

Cross-surface tests must execute the same real frozen input through API/client, CLI and MCP and compare canonical result/policy identities. Include rejected tenant, actor and capability cases, repeated idempotency, payload drift, cancellation, quality exit 1 and infrastructure exit 2. Generated OpenAPI/client schemas must reflect the final endpoints. Skills should execute the public client/CLI and be fixture-tested, including offline knowledge demo diagnostics-companies once WS-07 produces its pack.

## Provider composition after WS-06

Use the exported `AccountedVerificationProviderSink` for every dispatched provider call. The artifact composer is only its storage building block. For this laboratory, use the accepted successor budget in `LOCAL-RESET-RECOVERY.md`; the original pilot pointer is historical and must not recreate a spendable budget. Derive production budgets from trusted configuration. Failure after dispatch retains its reservation until evidence-backed reconciliation; report actual, estimated and unknown charges separately.

The sink's external-processing grant is trusted application configuration, not an HTTP authorization mechanism. Derive prompts and uploaded bytes from tenant-authorized registered inputs; a request cannot register one harmless artifact and supply unrelated text or an image for transmission. Bind the actual provider/model configuration to the accounting identity, preserve source-capture scope in semantic inputs, and snapshot trusted grants so caller mutation cannot change admission mid-operation. Public callers must not construct grants, supply policy findings or self-declare producer/verifier independence.

The four WS-06 synthetic calls establish protocol evidence only. Registry modalities remain lab-only. Interfaze request headers establish that ZDR was requested, not that retention or data residency was independently verified. Production promotion and human-gold quality gates remain separate.

## Existing implementation locations

The TypeScript client is `packages/client-typescript`, and the worker is `apps/worker`; do not create duplicate `packages/client` or `packages/worker` trees. `packages/contracts/src/integration.ts` owns the general `OperationKindSchema`. `packages/application/src/surface.ts` owns `operationStepsByKind`, `productionWorkerStepsByKind`, `apiOwnedStepsByKind` and the shared `KnowledgeOperationPort`; its in-memory `KnowledgeIntegrationService` is not evidence of durable execution. `packages/persistence/src/operation-service.ts` is the canonical durable composition. Extend these existing boundaries where needed.

`apps/api/src/server.ts` registers the current mutation route map and uses capability admission separately from the contract vocabulary. `apps/worker/src/activity-registry.ts` validates versioned operation/step inputs and owns production activities. Contract names must not be added to the production-admitted map until their complete worker handlers, authorization, output registration and failure behavior exist. Preserve the existing retrieval/evaluation operations while adding the verification use cases from specification sections 17–20.

## Concrete surface inventory for the next owner

The specification has ten mutation routes and six read routes. Preserve this inventory in contract tests; a generic command endpoint alone does not satisfy it.

| Mutation route under `/v1/verification` | Existing use-case vocabulary | Primary CLI/MCP entry |
| --- | --- | --- |
| `POST /captures` | `captureSource` | benchmark capture / knowledge_capture_source |
| `POST /extractions` | `extractStructuredData` | knowledge_extract_structured |
| `POST /extractions:verify` | `verifyExtraction` | verify extract / knowledge_verify_extraction |
| `POST /claims:verify` | `verifyClaims` | verify citations / knowledge_verify_claims |
| `POST /reports:verify` | `verifyReport` | verify report / knowledge_verify_report |
| `POST /metrics:verify` | `verifyMetricObservation` | verify metric |
| `POST /benchmarks:run` | `runBenchmark` | benchmark run / knowledge_run_benchmark |
| `POST /benchmarks:compare` | `compareBenchmarkRuns` | benchmark compare and diff |
| `POST /runs/{runId}:replay` | `replayRun` | bundle replay |
| `POST /reviews` | `requestAdjudication` | authenticated review control |

Read routes are `/operations/{operationId}`, `/runs/{runId}`, `/runs/{runId}/manifest`, `/runs/{runId}/cases`, `/cases/{caseRunId}` and `/evidence/{evidenceId}`. Map `knowledge_get_operation` and `knowledge_inspect_run` to the same authorized readers. Bundle inspect and the diagnostics demo must also use the public application/client boundary, with an explicit offline replay mode that consumes sealed exported bytes.

The current generic `VerificationCommandSchema.parameters` record is vocabulary, not a validated per-use-case payload. Replace or refine it at admission with bounded strict schemas before any execution. Reject unknown keys, provider endpoints, credentials, grants, synthesized findings and caller-supplied trusted identity. Preserve the operation context IDs only after checking their authenticated tenant/actor ownership and deriving deployment identity from trusted runtime configuration.

The local reset incident adds an operating constraint: use incremental migrations for the populated shared project. Fresh-chain and failure-injection tests run in separate disposable instances. Read `LOCAL-RESET-RECOVERY.md` before accessing the resumed benchmark budget or interpreting pre-reset artifact registrations.

2026-09-05 bounded preparation assignment: the coordinator reused the completed Terra selector agent for new `packages/contracts/src/verification/requests.ts`, its direct-import tests and `HANDOFF-WS-08-REQUESTS.md` only. Existing index exports, application code, routes, database and benchmark files remain outside that assignment. This is strict request-shape preparation; full WS-08 integration remains unclaimed and requires independent review before admission.
