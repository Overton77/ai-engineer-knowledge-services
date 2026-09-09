# Acceptance table snapshot

Copied from ../ACCEPTANCE-MATRIX.md at handoff. This does not update statuses or supersede the live matrix.

| ID | Priority | Requirement | Owner | Required proof | Status |
| --- | --- | --- | --- | --- | --- |
| VR-001 | P0 | Knowledge Services is the single owner of generic verification algorithms. | WS-00/02 | Package graph, migration parity, old implementation deprecated after cutover. | partial |
| VR-002 | P0 | Deterministic checks execute before semantics and cannot be overridden. | WS-02/05 | Unit/property/e2e tests with deliberate override attempts. | partial |
| VR-003 | P0 | Producer and verifier deployment identities differ. | WS-01/02/03 | Contract, engine, DB constraint, and end-to-end rejection test. | partial |
| VR-004 | P0 | Accepted results bind to immutable content-addressed captures. | WS-03 | Byte replay and tamper-failure integration tests. | partial |
| VR-005 | P0 | Machine selectors are separate from display excerpts. | WS-01/02/04 | Contract plus ambiguity/ellipsis/drift tests. | partial |
| VR-006 | P0 | Supported selector families cover text, JSON, HTML, PDF/image, tables, media, repository, and dataset records. | WS-04 | Golden/adversarial suite for each admitted selector. | partial |
| VR-007 | P0 | Every accepted extracted leaf has value, derivation, source fragment, and lineage. | WS-01/04 | Contract tests and gold field audit. | partial |
| VR-008 | P0 | Schema validity, semantic accuracy, and confidence calibration are reported separately. | WS-04/07 | Metrics artifacts and calibration plots. | missing |
| VR-009 | P0 | Numbers, units, periods, identities, and computations replay deterministically. | WS-02/04 | Fixture suite at effectively 100% for supported operations. | partial |
| VR-010 | P0 | Report assertions map to qualifier-preserving atomic claims and exact report offsets. | WS-01/05 | Claim decomposition gold set and reconstruction/recall tests. | partial |
| VR-011 | P0 | Citation correctness and claim-weighted completeness are independent metrics. | WS-05/07 | ALCE/TREC-style benchmark report. | missing |
| VR-012 | P0 | Support, correctness, authority, attribution faithfulness, and provenance integrity remain separate. | WS-01/05/07 | Result schema, policy truth tables, dashboard projections. | partial |
| VR-013 | P0 | Semantic verifier is evidence-closed with a bounded tool surface. | WS-05/08 | Capability inspection and prohibited-tool evals. | missing |
| VR-014 | P0 | Ambiguous/critical results support abstention and human review. | WS-05/11 | Policy/review e2e fixtures. | missing |
| VR-015 | P0 | Interfaze supports fixed-task and strict-schema modes behind provider-neutral adapters. | WS-06 | Adapter conformance and live safe fixtures. | partial |
| VR-016 | P0 | Interfaze raw response/precontext is retained outside model context and translated to compact canonical evidence. | WS-03/06 | Artifact manifest and projection-size test. | partial |
| VR-017 | P0 | Interfaze uses ZDR by policy for sensitive inputs and never verifies itself alone. | WS-06/09 | Header/config test, provider policy test, independence test. | partial |
| VR-018 | P0 | Provider errors, harness failures, quality failures, and policy rejection are distinct. | WS-01/08/09 | Typed error fixtures and dashboard/API projections. | partial |
| VR-019 | P0 | Datasets, cases, labels, variants, graders, and manifests are immutable/versioned. | WS-03/07 | Hash/version mutation tests and sealed Pilot. | partial |
| VR-020 | P0 | Pilot compares baseline, Interfaze, cascades, and consensus/abstention on identical frozen cases. | WS-06/07 | Signed/sealed paired experiment manifest and report. | missing |
| VR-021 | P0 | Benchmark reports uncertainty, calibration, catastrophic errors, slices, cost, latency, stability, and review burden. | WS-07 | Generated benchmark report with denominators and CIs. | missing |
| VR-022 | P0 | HTTP, CLI, MCP, and worker invoke the same application behavior. | WS-08 | Cross-surface golden semantic-parity test. | partial |
| VR-023 | P0 | Cursor Cloud invokes the service/CLI without copied algorithms and propagates orchestration identity. | WS-10 | Real cloud fixture and manifest inspection. | missing |
| VR-024 | P0 | EVE uses an authored bounded tool and independent verifier deployment. | WS-10 | EVE e2e eval suite. | missing |
| VR-025 | P0 | Temporal/Mission Control dispatches capabilities with idempotency, cancellation, retry classification, and reconciliation. | WS-10 | Workflow replay, duplicate, cancellation, and worker-loss tests. | partial |
| VR-026 | P0 | Persistence changes live only in `ai-engineer-db-contract`; consumers pin generated types. | WS-03 | Reviewed migrations, generated types, dependency pins. | partial |
| VR-027 | P0 | Every object-store artifact is registered in the relational ledger. | WS-03 | Orphan/collision/round-trip tests. | partial |
| VR-028 | P0 | Tenant isolation, SSRF prevention, hostile-file controls, secret redaction, and provider data policy are enforced. | WS-09 | Threat model and adversarial security suite. | missing |
| VR-029 | P0 | Audit manifests contain public proof records but no secrets or private chain-of-thought. | WS-03/09 | Redaction/schema tests and sampled manifest review. | partial |
| VR-030 | P0 | Deterministic bundle replay reproduces hashes, selections, calculations, and policy decisions. | WS-02/03/05 | Offline replay test from a sealed bundle. | partial |
| VR-031 | P0 | Provider/model/parser/grader/policy drift is observable and triggers revalidation policy. | WS-07/09 | Drift fixtures, scheduled comparison, alert test. | missing |
| VR-032 | P0 | Dashboard initially reads through supported server/API boundaries; controls never directly mutate canonical tables. | WS-11 | Route/auth tests and architecture inspection. | missing |
| VR-033 | P0 | Migration preserves prototype behavior before duplicate code is removed. | WS-02/10 | Parity report and consumer cutover evidence. | partial |
| VR-034 | P0 | Every completion claim is independently audited against this matrix. | WS-12 | Final audit with command outputs and artifact IDs. | missing |
| VR-035 | P1 | Optional artifact signatures/in-toto/SLSA attestations are supported for high-assurance runs. | WS-03/09 | Signature verification and tamper tests. | partial |
| VR-036 | P1 | Dashboard offers authenticated launch/cancel/replay/promotion after durable commands exist. | WS-10/11 | Authorization and recovery e2e tests. | partial |
| VR-037 | P0 | `diagnostics-companies-v1` contains immutable, licensed captures from TruDiagnostic, Generation Lab, and publication-layer sources. | WS-03/07 | Approved source manifest, capture digests, license/access review. | partial |
| VR-038 | P0 | Company facts, algorithms, biomarkers, counts, systems, limitations, and publication links extract with exact capture-bound selectors. | WS-04/07 | Gold field ledger and locator-resolution report. | missing |
| VR-039 | P0 | Known cross-page count, product, and turnaround conflicts remain visible rather than being silently normalized. | WS-04/05/07 | Conflict-set fixtures and generated report inspection. | missing |
| VR-040 | P0 | First-party support, independent corroboration, promotional authority, publication applicability, and world correctness remain distinct. | WS-05/07 | Gold claim ledger and policy truth-table results. | missing |
| VR-041 | P0 | Swapped names, algorithms, biomarkers, counts, institutions, qualifiers, and citations degrade verdicts monotonically. | WS-02/05/07 | Adversarial mutation report. | missing |
| VR-042 | P0 | One offline command generates TruDiagnostic, Generation Lab, comparison, and verification-audit reports plus machine ledgers and manifest. | WS-07/08 | CLI e2e and sealed artifact inventory. | missing |
| VR-043 | P0 | Every factual statement in generated mini reports has an inspectable assertion-to-fragment evidence path. | WS-05/07/08 | Report claim coverage and navigation audit. | missing |
| VR-044 | P0 | Reports contain no patient-specific advice and preserve medical/informational-use qualifications. | WS-05/09 | Safety-policy and report-content tests. | missing |
| VR-045 | P0 | Live refresh proposes a new immutable dataset version and drift report without mutating prior captures or results. | WS-03/07/08 | Refresh/diff/replay integration test. | missing |
| VR-046 | P0 | Gated sample reports are not acquired by bypassing authentication, submitting forms, or accepting terms without user action. | WS-03/09 | Acquisition policy tests and source-manifest review. | partial |
