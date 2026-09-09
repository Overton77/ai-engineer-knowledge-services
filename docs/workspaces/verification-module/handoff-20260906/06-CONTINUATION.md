# Continuation instructions for a fresh task

## Suggested opening prompt

> Continue the full Knowledge Verification module mission in C:/Users/Pinda/Proyectos/aiengineer/ai-engineer-knowledge-services. Start with docs/workspaces/verification-module/handoff-20260906/README.md and its linked files. Preserve the original specification and all46 acceptance requirements. EV-097 is the latest completed local engineering slice. Reinspect source, state and evidence; do not infer completion from handoffs. Prefer economical sequential subagents with bounded ownership and shared-ledger updates. Start by reviewing partial-retention/cancellation crash recovery, while preserving the entire remaining semantic, benchmark, security, consumer, dashboard, human-review and final audit scope. Do not load KS .env for local proofs and do not reset/clean untracked work.

The user has not yet issued this prompt; it is a template for their chosen next session. If they only ask to read/review the handoff, do that without starting mutations.

## Coordinator bootstrap

1. Read current repository instructions, specification, decisions, acceptance matrix and this handoff. Inspect current Git status and source files listed in snapshot.json.
2. Confirm external parent internal/ evidence and DB-contract repository are available. Verify latest receipt hashes when relying on them. Recheck actual local infrastructure via bounded, non-secret status checks if proofs are needed.
3. Distinguish historical file/package parity from current installed DB and remote state. This handoff did not query remote Supabase.
4. Identify any live worker/subagent/process by its actual handle. Do not assume stale session IDs from prior chat are running. No job is intentionally pending from the handoff.
5. Record the next concrete work item, owned files, invariant and required proof in STATUS/work-items before editing. Existing assignments may reference agents from previous sessions; those names do not prove live ownership.
6. Implement against existing classes and native functions. Prefer a follow-up migration over modifying applied SQL. Build dependency exports before executing proof scripts.
7. Exercise the real boundary and independent audit for material changes. Record new evidence and limitations; update the relevant acceptance row only when its entire requirement is proved.

## Suggested first implementation investigation

Read apps/worker/src/verification-structured-extraction-runtime.ts and the native capture/lifecycle/candidate/publication stores. Read both process-recovery and dispatch-recovery proof/child pairs. Select one unproved partial-retention or cancellation window from 04-TESTING.md. Identify the exact durable checkpoint and expected original provider/budget/capture state. Extend the real child harness to stop at that checkpoint, kill the process, observe exit, expire the lease naturally and resume or cancel through the real API. Count dispatches; inspect native records and retained Storage bytes. Fix any exposed recovery defect, then prove it with fresh isolated cohorts.

Do not spend the next task recreating reconciliation: EV-092–097 already implement signed admission, atomic native ledger, historical read, actor/mission HTTP/client and CLI/MCP. Production configuration and authentic billing remain open, but the core local stack exists.

## Agent and budget protocol

The user encouraged subagents and prefers them sequentially, with coordinator oversight and a shared workspace ledger. Use concrete bounded tasks, disjoint writes and explicit evidence expectations. Choose economical models for mechanical inventory/documentation/testing scaffolds; reserve deeper review for native authority, custody and recovery. Do not assume a new subagent exists just because an old work item names one. Earlier session notes reported thread/subagent limits; if unavailable, continue locally rather than repeatedly trying to spawn.

Existing live-pilot budget and processing grants in DECISIONS.md remain constraints. No silent provider/model substitution; no newly invented spending budget; no reclassification of synthetic/human/live evidence. Human reviewer and promotion actions require actual authorized humans. Continue independent implementation without repeatedly requesting already granted generic command permission.

## Completion protocol

Before marking complete, derive a checklist from every explicit specification deliverable, use case, command, numbered gate and46 acceptance rows. For each inspect actual source/runtime/artifact evidence at matching scope. Missing, stale, indirect or simulated evidence cannot satisfy a real deployed/human requirement. Verify old-consumer retirement and rollback. Retain an independent final report. Only then complete the goal. This handoff deliberately leaves the original goal unfinished.

## Concrete continuation anchors

- Reviewed parser image used by recent native extraction proofs: sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37. Verify it is actually installed before new runs; do not substitute a tag and retain the old identity.
- Latest consumed EV-097 preparation: verification-provider-reconciliation-publications-preparation-c85d365b-aa30-4fec-83cd-8d51e176637d.json. It has already been settled. Use a fresh preparation for new mutation proofs.
- Latest EV-094 historical-read fixture: verification-provider-reconciliation-publications-9d8562b6-5f9b-486c-ac9a-2b696ce53f65.json. The dedicated historical-read proof intentionally accepts this filename family.
- Latest DB parity evidence: parent internal/verification-contract-0229-audit-20260906.json. It established193 files at EV-094; new source-only CLI/MCP work did not change DBcontract.
- Latest CLI build is apps/cli/dist/index.js. This generated output is not a substitute for its source; rebuild before testing changed commands.
- Repository source inventories are filesystem observations. Installed Postgres and remote migration history were not re-queried for this handoff request.
