# Decision Log

## Resumption authority — 2026-09-07

### D-014 — accepted: bounded completion testing spend

The resuming user explicitly authorizes Vercel AI Gateway and Cursor SDK paid use without another permission request, and asks for economical Luna/Terra testing. The coordinator adopts the proposed USD 25 maximum for a new isolated `cph-20260907` completion cohort as an engineering limit within that authorization. Existing pilot liabilities/budgets remain unchanged. Retain D-013 per-call content/output bounds, serialize supplier calls, stop after three consecutive failures, record requested/returned models and known/unknown cost. Cursor credits are accounted separately; start with bounded local/SDK runs. This authorizes testing, not provider/policy promotion or invented human labels.

### D-018 — accepted: Mission Control dashboard home

As already accepted in the swarm instructions and reaffirmed by the resumed mission, build the verification control plane/debugger in `ai-engineer-mission-control/apps/dashboard`, using supported KS/MC APIs. `agents_dashboard` remains reference only. Controls require authenticated durable commands; execution state and admission disposition remain separate.

Human annotations (D-015) cannot be supplied by engineering. Temporal namespace discovery/configuration (D-016) and reachable Cloud endpoints (D-017) are still to be established from actual infrastructure. Remote migration work (D-019) still requires the concrete compatibility review before any rollout decision.

The coordinator records accepted decisions here. Proposed entries are not implementation authority until changed to `accepted`.

| ID | Status | Decision | Rationale | Consequence |
| --- | --- | --- | --- | --- |
| D-001 | accepted | Name the capability “Knowledge Verification” and the pure core package `@aiengineer/knowledge-verification`. | Matches repository naming and avoids collision with source “assurance” dimensions. | Package names using `@ai-engineer/*` are not canonical here. |
| D-002 | accepted | Implement one private packages/verification package composing existing extraction, evaluation, policy, runtime, observability, and client packages (spec section 6.2 takes precedence). | Keeps deterministic core free from providers, statistics, transports, and persistence. | “Module” is a cohesive capability, not one kitchen-sink package. |
| D-003 | accepted | Use HTTP as the authoritative cross-repository runtime contract; CLI and MCP are facades; direct imports are first-party only. | Required by Knowledge Services ADR and prevents workspace-relative coupling. | Cursor/EVE use client/CLI/MCP, not server internals. |
| D-004 | accepted | Knowledge Services supersedes generic verifier algorithms in `research_ingestion_systems_agent`. | Prevents incompatible duplicate implementations. | Migration requires parity tests and compatibility period. |
| D-005 | accepted | Deterministic failures are monotonic and semantics run only on mechanically eligible bundles. | Prevents models from laundering broken evidence. | Separate bounded rescue stage is required for more evidence. |
| D-006 | accepted | One private content-addressed artifact bucket is the initial default; split only for policy differences. | Avoids per-experiment bucket sprawl while preserving ledger identity. | Bucket and RLS/lifecycle policy must be canonical DB-contract changes. |
| D-007 | accepted | Interfaze is an extractor/perception candidate, not a verifier or truth oracle. | Its evidence metadata is useful, but current claims are vendor-led and confidence is uncalibrated. | Always use independent verification and internal gold benchmarks. |
| D-008 | accepted | Audit manifests store public rationale and proof artifacts, never hidden chain-of-thought. | Chain-of-thought is unstable, sensitive, and not independently verifiable. | Restricted development telemetry must be redacted or separately controlled. |
| D-009 | accepted | Policy decisions are versioned and replayable separately from verification findings. | New policy can evaluate old evidence without rewriting history. | Store all decisions append-only. |
| D-010 | accepted | Dashboard ships read-only experiment/evidence views before execution controls. | Current Mission Control is not yet a durable authenticated dispatcher. | Controls wait for operation APIs and recovery semantics. |

### D-015 readiness update — 2026-09-08 (still pending)

The prepared v3 human-review form and 180-row pack match their recorded hashes.
All candidate propositions and labels remain blank. The user has been asked
whether they will provide single-annotator review or designate a reviewer.
No annotation, qualification or authenticated human authority is inferred from
that request. The form is
`catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/review.html`;
SHA-256 `cba19b219131a020866330b216afc541d63a1383742f6064310de08863c87e5d`.

### D-016 readiness update — 2026-09-08 (still pending)

Read-only Cloud namespace discovery using the existing host credential returned
HTTP 200 with zero namespaces. Authentication is available; the namespace and
endpoint are not provisioned. The user has been asked for namespace provisioning
and its non-secret name/endpoint. No resource or workflow was created. This does
not accept or change the user-owned provisioning decision in the swarm plan.
Evidence: `internal/verification-temporal-cloud-namespace-discovery-6223d5ce-61fe-4158-91e3-4d9861f00ad9.json`,
SHA-256 `c74f837e4a148987d54293f893f78a16b6ded8f017d522d73b6d14556ae97868`.

## Decision template

```text
ID:
Status: proposed | accepted | superseded | rejected
Date:
Owner:
Decision:
Context:
Alternatives:
Consequences:
Evidence:
Supersedes:
```


## Coordinator execution decisions — 2026-09-05

The user authorized implementation and necessary commands/migrations. D-001–D-010 are accepted with D-002 corrected to the current specification. HTTP is the cross-repository default; no new private registry publication is required. Existing canonical storage and tenant policies are reused and hardened upstream. Public-source retention is internal-only, rights-recorded, with no redistribution of full copyrighted captures. Unknown licensing is not assumed approved. Sensitive provider input remains disabled pending policy review. Human annotations, cloud execution, production shadow evidence, and live provider evidence must be labeled accurately; agent-generated labels and mocks cannot satisfy human/live gates. Provider/policy promotion remains human-controlled. Compatibility retirement requires measured parity and a recorded rollback path.

### D-011 — accepted: economical live Pilot candidates

Use Gateway `openai/gpt-5.6-luna` as the initial extraction baseline and `anthropic/claude-haiku-4.5` as the initial cross-family semantic judge candidate. Gateway model discovery on 2026-09-05 confirms both IDs. Use Terra only for justified escalation. This follows the user's economical-agent preference and workspace `available_env.md`. The selection is a lab experiment configuration, not promotion. Record requested/returned model IDs and price snapshot; fail explicitly on unavailable models rather than silently substitute. Interfaze remains a separate extractor/perception arm and never its sole admission authority. Its internal model families are not assumed known.

### D-012 — accepted: bounded experiment spending

The first live Pilot uses a recorded maximum estimated spend of USD 20, bounded output tokens, concurrency and retry limits, and a stop condition on repeated provider failures. The harness must account for actual provider calls, including failed calls where usage is available, and distinguish estimated cost from billed cost. Shared cached calls may be reused only by exact input/configuration digest with attribution to each composition; reports must disclose reuse instead of presenting it as independent repeated inference. Begin with small live conformance probes before executing the full frozen matrix. This is an engineering default chosen within the user's budget-efficiency instruction, not a provider promotion or a request to purchase credits.

### D-013 — accepted: minimal public-text Pilot processing grant

Within the user's authorized engineering mission, WS-07 may transmit one case assertion, its single necessary public selected fragment and minimal source-class/qualifier metadata to Gateway Luna extraction, Gateway Haiku evidence-only judgment and Interfaze strict text extraction. Scope is at most 40 cases with at most one call per candidate per case, 2,000 UTF-16 characters of case content and 10,000 UTF-8 bytes of the entire serialized provider request including prompt/schema. Output remains capped at 900 tokens, temperature zero, text only, no tools/search/redirects and initial concurrency one. Qualifiers must survive intact; an over-limit case must abstain or be redesigned, not silently truncated. Source pages, PDFs, archives, report files and full restricted handles are outside this grant.

Each transmitted input requires an immutable manifest binding the original authorized source/capture, selected digest, license/source metadata and this derived-input grant. The original frozen preparation's blanket `providerUploadAuthorized: false` remains unchanged. This is limited laboratory processing of necessary public factual excerpts, not wholesale redistribution or production promotion. Human labels and clinical/model-quality claims remain gated.

Use the existing `ws06-ws07-pilot` budget only. Per-call estimated reservations are 5,000 microdollars for Luna, 20,000 for Haiku and 50,000 for Interfaze; 120 calls reserve at most USD 3 before any actual-cost settlement. The frozen Gateway model catalog lists base input/output rates per million tokens of USD 0.20/1.20 for Luna and USD 1/5 for Haiku (cache-write input up to USD 1.25). The [Interfaze primary site](https://interfaze.ai/) checked on 2026-09-05 lists USD 1.50/3.50. These support conservative estimates under the wire/output bounds; they are not billing receipts or guarantees. Persist the price snapshot and assumptions, reject changed limits/tiers, retain unknown Interfaze charges, and settle Gateway only from actual provider evidence. Exact cached calls may serve multiple arms only with explicit shared-call attribution.

### D-017 and D-019 — accepted by user, 2026-09-08
The user explicitly approved the proposed temporary maximum30-minute frozen-fixture endpoint and the rollout window for the49 reviewed remote migrations: "Yes I approve this" and "You can run the migrations. You can run the temporal and cursor testing." D017 execution may proceed against the tested dedicated bridge; D019 may apply the exact reviewed49 canonical files after a fresh remote ledger/preflight match. Stop on changed history or unexpected compatibility state. Gateway/Cursor testing remains authorized under D014 economical bounds. The user states TEMPORAL_CLOUD_API_KEY is set in .env; discover actual namespace/address without printing credentials. Human review remains deferred to the user/team and must not be fabricated. This approval does not promote benchmark/provider/policy outcomes or waive human acceptance.

### D-016, D-017 and D-019 execution closure — EV-159, 2026-09-08

D016 is resolved under the user's Temporal testing authorization: namespace `verification-cph-20260908.ih0e7`, address `us-east-1.aws.api.temporal.io:7233`; actual workflow, cancellation, recovery, retry classification and replay passed. The earlier zero-namespace discovery is historical.

D017 executed successfully: the existing Cursor Cloud agent called the dedicated endpoint, which was closed within five minutes, below the approved30-minute maximum. Full capture and local inspection were disabled; the endpoint returned `ERR_NGROK_3200` after cleanup. The Cursor agent is archived.

D019's49 reviewed migrations are applied. The additional reviewed drift migration was subsequently applied within the authorized implementation/migration scope after native and rollback validation, with unchanged legacy provider/budget records. Remote ledger209 and local canonical143 are recorded with contract0.2.38. No remote fixture/provider rows were inserted. Aggregate: `internal/verification-cloud-drift-EV159-20260908.json`.

Human review, source-rights decisions and provider/policy promotion remain distinct and deferred. Disposable test schedules are deleted; no recurring drift schedule was activated for production.
