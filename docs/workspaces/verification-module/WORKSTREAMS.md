# Workstreams and File Ownership

Each workstream must keep its owned paths disjoint from other active workstreams. Changes outside owned paths require coordinator approval and a dependency note.

2026-09-05 dependency exception: WS-03 owner confirmed provenance/core interfaces stable while finishing persistence proof. A bounded Terra selector-only task may operate in `packages/verification/src/selectors/**` with no facade/contracts/persistence edits. Coordinator continues independent WS-03 review; parser/extraction work and WS-04 acceptance wait for their own handoffs. This limited overlap avoids an idle implementation queue without shared-file writers. All subsequent integration still requires coordinator review.

## Dependency graph

```text
WS-00 baseline and decisions
  -> WS-01 contracts
  -> WS-02 deterministic core
  -> WS-03 provenance/persistence
  -> WS-04 extraction/selectors
  -> WS-05 claims/semantics/policy
  -> WS-06 providers/Interfaze
  -> WS-07 benchmarks
  -> WS-08 service surfaces
  -> WS-10 external integrations
  -> WS-11 dashboard/review
  -> WS-12 independent audit

WS-09 security/observability begins after WS-00 and reviews every later stream.
```

## WS-00 — Coordinator, baseline, and architecture

**Owns:** coordination files, ADRs, repository baseline decision, final acceptance audit coordination.  
**Does not own:** feature implementation.

Deliverables:

- preservation checkpoint for every dirty source repository;
- ADRs for module boundary, package naming, public access, storage, policy, and migration;
- approved package/dependency graph;
- assigned workstream owners and file boundaries;
- continuously maintained acceptance matrix.

## WS-01 — Contracts and domain taxonomy

**Owns:** `packages/contracts/src/verification/**`, verification-related domain vocabulary, golden serialization fixtures.  
**Source:** prototype verification contracts and canonical DB vocabulary.

Deliverables:

- all versioned request/result/event/manifest/error schemas;
- claim-type and verdict-taxonomy reconciliation;
- RFC 8785 canonical representation rules;
- generated JSON Schema/OpenAPI components;
- forward/backward compatibility tests.

## WS-02 — Deterministic verification core

**Owns:** `packages/verification/src/deterministic/**` and deterministic fixtures only.  
**Source:** `research_ingestion_systems_agent/packages/verification-core`.

Deliverables:

- pure deterministic engine and ports;
- prototype parity fixtures;
- hash, selector, value, identity, period, arithmetic, independence, and monotonic-failure tests;
- no network, environment, database, transport, or framework dependencies.

## WS-03 — Provenance, persistence, and object storage

**Owns:** Knowledge Services persistence ports/mappers and coordinated changes in `ai-engineer-db-contract`.  
**Does not own:** application-local migrations.

Deliverables:

- canonical table mapping and approved gaps;
- stable database migration/type revision;
- bucket/RLS/lifecycle policies;
- immutable artifact and run-manifest registration;
- tenant-isolation, append-only, and replay integration tests.

## WS-04 — Extraction, parsers, normalization, and selectors

**Owns:** `packages/verification/src/selectors/**` and verification-specific adapters to existing `packages/acquisition`, `packages/conversion`, and `packages/documents`; it does not create a duplicate extraction package. Provider-specific code remains with WS-06.

Deliverables:

- parser/extractor ports and canonical projections;
- text, JSON, HTML, PDF, image, table, media, repository, and dataset selectors;
- normalization libraries and computation replay;
- Docling/native parser adapters;
- modality fixture and adversarial locator suites.

## WS-05 — Claims, semantic verification, authority, and policy

**Owns:** `packages/verification/src/claims/**`, `authority/**`, and verification-facing composition with existing shared evaluation and policy packages. Coordinated shared-package changes require explicit file ownership.

Deliverables:

- claim decomposition and assertion-offset mapping;
- evidence-closed judge cascade;
- NLI and LLM judge adapters;
- source authority/conflict assessment;
- bias, disagreement, calibration, and source-ablation tests;
- policy truth tables, replay, and human-escalation rules.

## WS-06 — Provider framework and Interfaze

**Owns:** `packages/verification/src/providers/**`, its conformance kit, and Interfaze/current-provider adapters.

Deliverables:

- capability and data-handling registry;
- fixed-task and strict-structured Interfaze adapters;
- raw response/precontext persistence plus compact projections;
- ZDR, schema safety, URL safety, bounded retries, and error mapping;
- live non-sensitive conformance experiment and promotion result per modality.

## WS-07 — Benchmarks, statistics, and experiments

**Owns:** benchmark harness, dataset tooling, metrics/statistics, Pilot and Benchmark v1 artifacts.

Deliverables:

- immutable dataset/version/split/case contracts;
- annotation and adjudication guide;
- perturbation generator;
- paired/replicated experiment runner;
- clustered bootstrap, McNemar, calibration, and risk–coverage reports;
- sealed 30–50 case Pilot run followed by Benchmark v1.
- frozen `diagnostics-companies-v1` source pack, gold claim/field ledgers, adversarial variants, company mini reports, comparison report, and verification audit.

## WS-08 — API, client, CLI, MCP, worker, and skills

**Owns:** transport/application composition and invocation guidance.

Deliverables:

- asynchronous versioned HTTP endpoints and generated client;
- machine-readable CLI and exit-code contract;
- compact bounded MCP tools;
- worker capability handlers;
- thin fixture-tested agent skills;
- cross-surface semantic-parity tests.
- one-command offline `knowledge demo diagnostics-companies` flow plus explicit immutable capture/diff commands.

## WS-09 — Security, privacy, observability, and operations

**Owns:** threat model, security controls, telemetry schemas, SLOs, alerts, and runbooks.

Deliverables:

- threat model covering hostile content/providers/graders/reviewers;
- SSRF, parser sandbox, schema bomb, artifact authorization, tenant, and secret tests;
- provider retention/data-classification policy;
- OpenTelemetry spans and cost/usage metrics;
- redaction and restricted-artifact rules;
- outage, drift, replay-failure, review-backlog, and false-acceptance runbooks.

## WS-10 — Cursor, EVE, Temporal, and Mission Control integration

**Owns:** external repository adapters and orchestration integration.

Deliverables:

- Cursor skills/CLI operation with mission/work-item/attempt propagation;
- EVE authored bounded tool using the client/API;
- alternate-framework conformance example;
- Temporal activity/workflow dispatch with idempotency, heartbeat, cancellation, retry classification, and reconciliation;
- real cross-repository end-to-end fixtures.

## WS-11 — Dashboard and human review

**Owns:** dashboard feature slice and reviewer experience.

Deliverables:

- read-only experiment/run/case/evidence/replay/calibration/failure views;
- human review queue and adjudication history;
- authenticated launch/cancel/replay/promote controls only after durable APIs exist;
- browser-visible redaction and access-control tests.

## WS-12 — Independent completion audit

**Owns:** no implementation paths; reads everything and reruns evidence.

Deliverables:

- requirement-by-requirement completion audit;
- independent command/test execution;
- sealed audit report with incomplete or contradictory evidence called out;
- final recommendation to accept, remediate, or block rollout.
