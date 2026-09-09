# Swarm plan 2026-09-06: completing the verification module

Planning package prepared after the EV-097 handoff, the Mission Control pre-spec and supplement, and the dashboard specification. It does not change any acceptance status and does not authorize new spend.

| File | Purpose | Give to |
|---|---|---|
| [01-CURRENT-SYSTEM-SUMMARY.md](01-CURRENT-SYSTEM-SUMMARY.md) | What exists, where, and what is not done; binding decisions; traps | Anyone starting on this module |
| [02-INTEGRATION-AND-TESTING-MODEL.md](02-INTEGRATION-AND-TESTING-MODEL.md) | How deep research, ingestion, coding agents, Mission Control, and the dashboard call the module; the Consumer Proof Harness for real Cursor + Eve tests on Temporal Cloud without building the kernel; dashboard first slice | Architects, the coordinator, Mission Control implementers |
| [03-SWARM-INSTRUCTIONS.md](03-SWARM-INSTRUCTIONS.md) | The instruction file for the coordinator agent: goal, read-first, non-negotiables, user decisions D-014 to D-019, coordinator protocol, eleven workstreams, waves, reporting, completion protocol | The next coordinator swarm session |

Authoritative sources remain `../../../specifications/verification-module.md`, `../ACCEPTANCE-MATRIX.md`, `../DECISIONS.md`, `../work-items.yaml`, `../STATUS.md`, `../EVIDENCE-LOG.md`, and the `../handoff-20260906/` package. The Mission Control pre-spec at `ai-engineer-meta/ai-engineer-architecture/specs/mission-control/MISSION_CONTROL_PRESPEC.md` governs how this module is consumed by the kernel.

Suggested opening prompt for the coordinator:

> Complete the Knowledge Verification module. Start with `ai-engineer-knowledge-services/docs/workspaces/verification-module/swarm-plan-20260906/03-SWARM-INSTRUCTIONS.md` and follow its read-first list. Preserve the specification and all 46 acceptance rows. EV-097 is the latest accepted slice; continue evidence numbering from EV-098 in `LEDGER.md`. Stop at the spend or mutation boundary for decisions D-014 to D-019 and put the question at the end of a turn that also delivers progress. Do not load KS `.env` for local proofs; do not reset or clean untracked work.
