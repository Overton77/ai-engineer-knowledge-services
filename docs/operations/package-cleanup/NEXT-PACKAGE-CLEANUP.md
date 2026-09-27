# Package cleanup delivery and continuation

Status: reference. Execution handoff, 2026-09-27 (Unit 2 delivery).

## Current delivery

Unit 2 (shared host composition) is merged into local `main` from `refactor/ks-unit-2-host-composition`. Implementation commits: host composition `a6b6790`, proof path/lifecycle adaptation `e036bf0`; the documentation commit records evidence, navigation and the [Unit 3 specification](./UNIT-3-APPLICATION-AND-MCP.md). Exact validation, the fixture reassessment and remaining seams are in the [ledger](./workspace/PROGRESS.md) and the [Unit 2 delivered-seams section](./UNIT-2-HOST-COMPOSITION.md#delivered-composition-and-remaining-seams). Unit 1 remains as recorded (`0d73dac`).

## Priority: a useful experiment feedback loop before full Mission Control

The developer's priority is to reach a useful engineering feedback loop before building full Mission Control. Read [OPENAI_FIXTURE.md](../../../../ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/OPENAI_FIXTURE.md) (§5 stage graph) and [EVE_AGENT_EXECUTION.md](../../../../ai-engineer-meta/ai-engineer-architecture/specs/knowledge-services-pre-mission-control/EVE_AGENT_EXECUTION.md).

**Milestone — bounded stage-graph engineering experiment.** A small, real stage graph executed sequentially:

1. `research`: knowledge preflight, research and verification.
2. `reports`: create and store reports from the validated research manifest.
3. `ingestion`: canonical ingestion and retrieval publication, consuming **both** the research and report manifests.
4. Restoration, then fresh-consumer evaluation through published contracts only.

Each stage is a separate agent session with explicit, digest-pinned inputs, durable outputs and a validated handoff before the next dispatch. Manual stage launch is acceptable. Reuse existing harnesses (Eve, the fixture adapter) and KS contracts. Production scheduling, Temporal and a Mission Control dashboard are not prerequisites; fixture stage results do not impersonate Mission Control Stage Acceptance.

**Accepted sequencing adjustment.** This bounded experiment may run before Unit 7's proof-folder reorganization once its prerequisites are satisfied. It is recorded in [FINAL-LAYOUT.md §5](./FINAL-LAYOUT.md#5-units-of-work). Results are **provisional engineering results**, reported separately from full fixture acceptance (human-reviewed gold, frozen corpus, lanes A–E and release gates remain unmet by this experiment).

Prerequisites, by owner — a proposed mapping to confirm when the experiment is specified; none is claimed satisfied by Unit 2:

| Prerequisite | Owner |
| --- | --- |
| In-process MCP retrieval, evidence packet and citation replay; no sibling-HTTP shims | Unit 3 (specified) |
| Profile-aware operation catalog, where stage tool subsets depend on it | Unit 4 |
| Eve adapted to the new services, CLI/MCP surfaces and packaging; stage/child input and result manifests | Unit 5 and the Eve repository |
| Canonical skills materialized for each stage role | Unit 6 |
| Fixture inputs, disposable database/storage target, budget ceiling and stage manifests/validator | Experiment setup (meta spec P2/P4/P6 scope) |

Do not build the experiment runner inside a cleanup unit. Preserve this milestone in every subsequent handoff until the experiment has run and its provisional results are recorded.

## Next unit

Implement [Unit 3](./UNIT-3-APPLICATION-AND-MCP.md) on its own branch from integrated main: move the Unit 2 seams into application, compose them in host, and remove MCP's HTTP shims with API/MCP parity tests. Reassess the missing historical receipt explicitly before acceptance.

## Branch and delivery rule — developer accepted

Use **one branch per cleanup unit, with as many cohesive commits as needed**. Branch from the integrated local `main`; do not stack unfinished unit branches or implement cleanup directly on `main`. After a unit, inspect its diff and evidence, resolve new regressions, update the ledger and next-unit specification, then merge locally with a merge commit and return to a clean `main`. Remote publication and deployments are separate actions.

## Known baseline exception

`packages/application/src/verification/benchmark/verification-benchmark-registered-replay.test.ts` still fails with `SEALED_CHECKPOINT_MISSING:records/25-gl-repeatability-mutated-haiku_judge-failure.json`. The original historical judge-failure receipt remains unavailable (rechecked across the workspace at Unit 2 entry). Each unit reassesses it explicitly; the exception is never automatic. Do not skip, delete or weaken the assertion, generate a substitute receipt, or reseal historical evidence. If the original receipt becomes available, restore it with provenance and rerun the affected checks. Unit 0 and the full suite cannot be called green while it is absent.

## Jev is implemented and must be preserved

See [Jev architecture](../../architecture/modules/jev.md). Preserve `packages/jev`, `apps/jev`, the `contracts/jev`, `application/jev` and `client-typescript/jev` entrypoints, `KnowledgeClient.jev`, the CLI, six MCP tools, registered skill and the physical child worker beside the compiled service. Unit 5 consolidates Jev's transport; until then importing host does not start Jev. Existing `.jev/` state is operator data.

## Suggested next-session instruction

> Continue Knowledge Services from local main. Read repository AGENTS.md, `docs/operations/package-cleanup/workspace/PROGRESS.md`, `docs/operations/package-cleanup/NEXT-PACKAGE-CLEANUP.md` and `docs/operations/package-cleanup/UNIT-3-APPLICATION-AND-MCP.md`. Implement Unit 3 completely on its own branch with cohesive commits, preserving behavior, authority failures and Jev. Validate, update documentation and the ledger, prepare the bounded Unit 4 specification, then merge locally and return to a clean main. Reassess the documented missing historical receipt failure explicitly; do not hide it or accept new failures. Keep the bounded stage-graph experiment milestone (research → reports → ingestion consuming both manifests → restoration and fresh consumer; provisional results distinct from fixture acceptance) in the next handoff; do not build its runner inside the cleanup unit.
