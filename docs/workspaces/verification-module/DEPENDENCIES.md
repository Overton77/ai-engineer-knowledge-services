# Cross-Repository Dependencies

## Dependency register

| ID | Repository | Needed change | Blocks | Owner | State |
| --- | --- | --- | --- | --- | --- |
| DEP-001 | `ai-engineer-db-contract` | Stabilize verification/provenance/evaluation migrations, constraints, types, RLS, and grants. | WS-03, WS-08, WS-11 | verification-persistence-agent | review — EV-012; remote deployment not performed |
| DEP-002 | `ai-engineer-db-contract` | Create authoritative artifact bucket, Storage policies, lifecycle/retention rules. | WS-03, Pilot sealing | verification-persistence-agent | review — EV-012/EV-013; remote deployment not performed |
| DEP-003 | `research_ingestion_systems_agent` | Freeze prototype tests/contracts/core and provide migration parity fixtures. | WS-01, WS-02 | unassigned | pending |
| DEP-004 | `research_ingestion_systems_agent` | Replace local core with Knowledge Services client/compatibility adapter; retain EVE-specific workflow behavior. | WS-10 | unassigned | pending |
| DEP-005 | Cursor Cloud repository | Replace direct verifier logic/table mutation with Knowledge Services CLI/API operations while preserving mission IDs. | WS-10 | unassigned | pending |
| DEP-006 | `ai-engineer-mission-control` | Implement authenticated capability dispatch, receipts, retry/cancel/reconcile behavior. | Dashboard controls, full Temporal orchestration | unassigned | pending |
| DEP-007 | `agents_dashboard` | Add read-only experiment/run/case/evidence feature using route/fetcher/hook pattern. | Operator visibility | unassigned | pending |
| DEP-008 | Interfaze account | Confirm key availability, ZDR behavior, terms/security review, and model-version semantics. | Provider promotion; not mocked development | unassigned | pending |

## Dependency rules

- Never make a local schema workaround for a pending canonical migration.
- Never copy verifier algorithms to bypass client/service readiness.
- Mocked/recorded providers unblock deterministic development, but do not satisfy live promotion evidence.
- A dependency is resolved only when its artifact/commit/test evidence is recorded in `EVIDENCE-LOG.md`.
