# Package cleanup delivery and continuation

Status: reference. Execution handoff, 2026-09-29 (5B delivered; DeepAgents fixture decision).

## Current delivery

Unit 5 slice **5B** (local host profile and capability matrix) is merged into local `main` from `refactor/ks-unit-5b-local-profile`: `createHost({ profile: "local" })` composes the verification intent pipeline lazily over the executor's file store (`packages/host/src/local/`), with the server/local/remote-CLI capability matrix; offline operations need no network, database or credentials, online capture, document conversion and semantic judging need explicit provider configuration (otherwise `CAPABILITY_NOT_ADMITTED`), and everything else is server-only. The executor supplies the file-backed services through a typed seam that 5D3 retires; no transport changed. Validation, the replay decision and the recorded decisions are in the [ledger](./workspace/PROGRESS.md) and [`unit5b-validation.json`](./workspace/evidence/unit5b-validation.json).

Unit 5 slice **5A** (entry evidence and the R1 inversion) is merged into local `main` from `refactor/ks-unit-5a-r1-inversion`: knowledge-db owns its transaction and content-admission ports (`packages/knowledge-db/src/ports.ts`), persistence implements them (`TenantPostgres`, `postgresContentAdmission`), the executor composition injects them, and the production `knowledge-db → persistence` edge is gone. Commits `4dd7510`, `8ec3f3c`, `2c474ad` and a documentation/evidence commit; validation, the replay decision and the carried test-only edge are in the [ledger](./workspace/PROGRESS.md) and [`unit5a-validation.json`](./workspace/evidence/unit5a-validation.json).

Unit 4 (application order, naming pass and catalog parity) is merged into local `main` from `refactor/ks-unit-4-application-order-and-catalog`. Implementation commits: application folders by tool group `c995cbc`, benchmark/diagnostics split `d187c4e`, diagnostics quarantine test `e44da60`, A2A binding into the API `677fd48`, demo bundle port (testkit off the API runtime) `95561dd`, folder renames `577864d` (`packages/sources`), `8e81d51` (`packages/client`), `f428a69` (`services/parser`), the catalog parity test `e0e032d`, and review fixes `edd4533`; the documentation commit records evidence, navigation and the [Unit 5 specification](./UNIT-5-EXECUTOR-FOLD-CLI-AND-EVE.md). Exact validation, the fixture reassessment and the recorded decisions are in the [ledger](./workspace/PROGRESS.md) and the [Unit 4 delivered section](./UNIT-4-APPLICATION-ORDER-AND-CATALOG.md#delivered-structure-and-decisions). Units 1–3 remain as recorded.

## Priority: a useful experiment feedback loop before full Mission Control

The developer's priority is to reach a useful engineering feedback loop before building full Mission Control. Read [OPENAI_FIXTURE.md](../../../../ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/OPENAI_FIXTURE.md) (§5 stage graph) and [EVE_AGENT_EXECUTION.md](../../../../ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/EVE_AGENT_EXECUTION.md) as historical harness context; meta harness wording is pending a later update. The DeepAgents decision below controls this fixture.

**Milestone — bounded stage-graph engineering experiment.** A small, real stage graph executed sequentially:

1. `preflight`: read existing knowledge through KS.
2. `research`: discovery, capture, verification and recovery.
3. `reports`: create and store reports from the validated research seal.
4. `ingestion`: consume **both** research and report seals.
5. `publication-and-retrieval`: authorized publication and citation replay.
6. `restoration`: restore the specified fixture checkpoint/selection.
7. `fresh-consumer-evaluation`: a separate consumer through published contracts only.

Each stage is a separate agent session with explicit, digest-pinned inputs, durable outputs and a validated handoff before the next dispatch. Manual stage launch is acceptable. The harness is TypeScript DeepAgents 1.14.x on LangGraph, with real config-composed sync and async children; see [readiness](./DEEPAGENTS-READINESS.md) and the [seven-stage fixture](./REAL-FIXTURE-STAGE-GRAPH.md). Eve adaptation is superseded. Production scheduling, Temporal and a Mission Control dashboard are not prerequisites; fixture stage results do not impersonate Mission Control Stage Acceptance.

**Accepted sequencing adjustment.** This bounded experiment may run before Unit 7's proof-folder reorganization once its prerequisites are satisfied. It is recorded in [FINAL-LAYOUT.md §5](./FINAL-LAYOUT.md#5-units-of-work). Results are **provisional engineering results**, reported separately from full fixture acceptance (human-reviewed gold, frozen corpus, lanes A–E and release gates remain unmet by this experiment).

Prerequisites, by owner — a proposed mapping to confirm when the experiment is specified. Units 3 and 4 satisfy only their own rows, on the KS side; the experiment is not runnable yet:

| Prerequisite | Owner |
| --- | --- |
| In-process MCP retrieval, evidence packet and citation replay; no sibling-HTTP shims | Unit 3 — delivered in KS; DR2 verifies the DeepAgents consumer |
| Profile-aware operation catalog, where stage tool subsets depend on it | Unit 4 — delivered: `apps/mcp/src/tests/operation-catalog.ts` classifies every operation by tool group, admission and transport; the local profile and executor rows arrive with Unit 5 |
| Folded KS surfaces and installed `ks`; minimal DeepAgents smoke | Unit 5 slices 5C–5D3, 5F, 5H plus DR2 smoke; 5E1/5E2 superseded |
| Model/route conformance, reachability, artifact custody, real sync/async stage runner, budget/intervention | [DR1–DR5](./DEEPAGENTS-READINESS.md), owned by `research_ingestion_systems_agent/agents/deepagents-stage` |
| Eight canonical skills, DeepAgents parser conformance with zero skips, manifest ids/digests | [Unit 6](./UNIT-6-SKILLS-DIRECTION.md); stage files own role bindings |
| Fixture inputs, disposable database/storage target, budget ceiling and stage manifests/validator | Experiment setup (meta spec P2/P4/P6 scope) |

Order: **KS cleanup/readiness → DeepAgents readiness → real fixtures → Mission Control**. Unit 7 retains its accepted scheduling exception. Do not build the experiment runner inside a cleanup unit. Preserve this milestone in every subsequent handoff until the experiment has run and its provisional results are recorded.

## Next unit

Implement [Unit 5](./UNIT-5-EXECUTOR-FOLD-CLI-AND-EVE.md) in the slices of [UNIT-5-SLICES.md](./UNIT-5-SLICES.md), one slice per session and branch. 5A and 5B are delivered; next is **5C** (`ks` CLI skeleton, remote mode, lazy offline dispatch and packaging) on `refactor/ks-unit-5c-ks-cli`. Eve slices 5E1/5E2 are superseded by DeepAgents readiness. 5C starts with the decision carried from 5B: how `ks` reaches the local verification seam (today in the executor app) before 5D3, and how CLI flags and environment map onto the local host's `providers` and `identity` without legacy `VERIFY_*` names. 5D1 must first remove the test-only `knowledge-db → persistence` edge recorded by 5A; 5D3 retires the 5B seam. Reassess the missing historical receipt explicitly at every slice entry; reuse `unit5-catalog-snapshot.ts` (it now also records each row's local host state) and copy `unit5b-inventory.mjs` for the slice inventory.

## Branch and delivery rule — developer accepted

Use **one branch per cleanup unit, with as many cohesive commits as needed**. Unit 5 adjustment (developer preference for smaller slices, 2026-09-28): one branch per Unit 5 slice, each validated and merged locally before its dependents start; see [UNIT-5-SLICES.md](./UNIT-5-SLICES.md). Branch from the integrated local `main`; do not stack unfinished unit branches or implement cleanup directly on `main`. After a unit, inspect its diff and evidence, resolve new regressions, update the ledger and next-unit specification, then merge locally with a merge commit and return to a clean `main`. Remote publication and deployments are separate actions.

## Known baseline exception

`packages/application/src/verification/benchmark/verification-benchmark-registered-replay.test.ts` still fails with `SEALED_CHECKPOINT_MISSING:records/25-gl-repeatability-mutated-haiku_judge-failure.json`. The original historical judge-failure receipt remains unavailable (rechecked across the workspace at Unit 4 entry). Each unit reassesses it explicitly; the exception is never automatic. Do not skip, delete or weaken the assertion, generate a substitute receipt, or reseal historical evidence. If the original receipt becomes available, restore it with provenance and rerun the affected checks. Unit 0 and the full suite cannot be called green while it is absent.

## Jev is implemented and must be preserved

See [Jev architecture](../../architecture/modules/jev.md). Preserve `packages/jev`, `apps/jev`, the `contracts/jev`, `application/jev` and `@aiengineer/knowledge-client/jev` (folder `packages/client`) entrypoints, `KnowledgeClient.jev`, the CLI, six MCP tools, registered skill and the physical child worker beside the compiled service. Unit 5 consolidates Jev's transport; until then importing host does not start Jev. Existing `.jev/` state is operator data.

## Suggested next-session instruction

> Continue the Knowledge Services package cleanup, Unit 5 slice 5C (`ks` CLI skeleton and packaging), from local main. Read repository AGENTS.md, `docs/operations/package-cleanup/workspace/PROGRESS.md`, `docs/operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md`, `docs/operations/package-cleanup/UNIT-5-EXECUTOR-FOLD-CLI-AND-EVE.md` and `docs/operations/package-cleanup/UNIT-5-SLICES.md`. Implement only that slice on its own branch `refactor/ks-unit-5c-ks-cli`, starting with the decisions carried from 5B, following its scope, "must not" and exit criteria and the rules for every slice (replay gate decision, inventories, catalog rows, sequential full test graph, packaging smoke, docs check). Record it in the ledger and evidence, merge locally, return to a clean main and name the next slice. Keep the DeepAgents milestone (KS cleanup → DR1–DR5 and Unit 6 conformance → real seven-stage fixtures with compiled sync and async children → Mission Control; provisional results distinct from fixture acceptance) in the handoff; do not build its runner inside the cleanup.
