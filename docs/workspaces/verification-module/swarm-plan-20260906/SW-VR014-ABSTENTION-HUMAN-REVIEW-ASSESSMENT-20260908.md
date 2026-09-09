# SW-VR014 abstention and human-review assessment — 2026-09-08

## Exact requirement and disposition

VR-014 requires: **“Ambiguous/critical results support abstention and human review.”** The acceptance matrix still records VR-014 as missing and expects policy/review end-to-end fixtures (`docs/workspaces/verification-module/ACCEPTANCE-MATRIX.md:22`). Independent assessment: **partial; do not promote**.

The policy layer proves deterministic routing: critical unknown facts become `abstain`, mixed/conflicting evidence becomes `review`, and review-unavailable cases become `abstain` (`packages/policy/src/verification-policy.ts:66-113`; focused tests `packages/policy/src/verification-policy.test.ts:41-70`). The packet/adjudication stack supports a pending review subject, exact packet binding, reviewer role checks, synthetic engineering decisions, and a real human grant lookup. The end-to-end receipts and proof scripts, however, deliberately exercise only a synthetic service reviewer and explicitly set `humanGoldScoringEligible: false`. There is no production human grant row/decision or completed human review campaign in the inspected evidence.

## Source trace

- Policy evaluation ranks outcomes through `pass`, `pass_with_warnings`, `review`, `abstain`, and `fail`; critical use plus unknown facts/provenance routes to the stricter configured review or abstain outcome, and semantic abstention is preserved (`packages/policy/src/verification-policy.ts:33`, `66-113`). Tests cover first-party review, conflict review, critical unknown abstention, authority withheld review, and mechanical fail (`packages/policy/src/verification-policy.test.ts:41-82`). This establishes deterministic policy mechanics, not reviewer action.
- The adjudication packet builder creates an immutable pending subject with original policy outcome and review requirements, while explicitly providing no decision/override API at packet creation (`packages/application/src/verification-adjudication.ts:69-94`, `161-206`).
- Decision preparation authenticates service reviewers only through an exact synthetic allowlist; human actors are authorized only by a live canonical `evidence.verification_adjudication_reviewer_grant` joined to the subject and eligible role (`packages/persistence/src/verification-adjudication-decision-preparation.ts:11-44`). The application rejects model/non-human service authority and binds subject, packet, role, expiry, and actor before preparing the signed decision (`packages/application/src/verification-adjudication-decision.ts:52-85`).
- Persistence rechecks subject expiry/packet/role under a lock, rechecks the human grant for `human_origin`, and records quorum counts. The result hard-codes `admissionChanged: false` and `humanGoldScoringEligible: false` (`packages/persistence/src/verification-adjudication-decision.ts:52-83`). Thus review records cannot silently change policy admission.
- The dashboard proxy proof runs a real local signed session, CSRF check, POST, scoped worker, and terminal read. Its script asserts reviewer mapping and terminal provenance, but the actor is a service with `serviceIdentity: "human_reviewer"`, the grant is injected through `VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON`, and the assertion requires `reviewerProvenance === "synthetic_engineering"` plus `humanGoldScoringEligible === false` (`scripts/prove-verification-adjudication-dashboard-proxy.ts:45-63`, `77-105`). Receipt: `internal/verification-decision-dashboard-proxy-4bc6d7c7-b004-53d5-a252-b5d67bebc9d9.json`.
- Full-startup proof makes the same synthetic choice and asserts the same limitations (`scripts/prove-verification-adjudication-decision-full-startup.ts:55-83`, `92-117`; receipt `internal/verification-decision-full-startup-966fb678-1dc4-55ec-aa7d-683ba71e8696.json`). Recovery proves injected interruption/lease abandonment, unchanged decision row, one terminal receipt, signed source replay, and synthetic provenance (`scripts/prove-verification-adjudication-decision-recovery.ts:57-72`; receipt `internal/verification-decision-recovery-6c8b2ea9-33b4-48d3-98db-481bb08a26ab.json`).
- Public-read evidence confirms HTTP/client/CLI/MCP reads and denial controls, but itself records `reviewerProvenance: "synthetic_engineering"`, zero human affirmations, quorum unreached, and limitations of no human quality evidence (`internal/verification-decision-native-public-read-ae8a96b6-b462-42e7-b571-4fbb678fe8a4.json`).

## Exact gaps

1. **Human evidence gap:** no inspected receipt proves a human actor (`actor.kind: "human"`) with a canonical reviewer grant row and a persisted `human_origin` decision. The code path exists and has unit coverage, but the acceptance evidence is synthetic.
2. **Campaign/gold gap:** no completed human review packet/submission is bound to the adjudication subject or policy decision. Existing receipts explicitly exclude human gold and set the flag false. Human-review pack validators in `packages/evaluation/src/verification-human-review.ts:38-50` enforce real annotator identity/provenance when used, but no submitted packet was found in this VR014 proof chain.
3. **Requirement boundary gap:** policy tests prove abstention/review outcomes, while dashboard/full-startup/recovery prove safe mechanics and review plumbing. They do not prove that an actual ambiguous/critical production result reaches a human reviewer and receives an authoritative human decision.
4. **Admission remains unchanged:** the decision payload and persistence result explicitly bind `admissionChanged: false` (`packages/application/src/verification-adjudication-decision.ts:77-83`; `packages/persistence/src/verification-adjudication-decision.ts:81-83`). Any future human campaign must separately show how review affects downstream publication/decision gates without turning the packet decision into an admission bypass.

## Recommended closure proof

Create a fresh local-only fixture whose policy result is critical/unknown or ambiguous/conflicting and whose packet is pending. Provision a real canonical reviewer-grant row for an actor with `kind: "human"`, submit through the authenticated API/dashboard path, run the production worker, and independently inspect the signed decision artifact plus DB row for `human_origin`, grant/subject/packet binding, quorum, and unchanged admission. Bind a completed human review packet/submission (with annotator identity, attestation, and held-out labels where VR014 claims gold) to the exact source/result digests. Retain negative controls for absent/expired grant, model actor, non-reviewer service, packet drift, and admission-change attempts. Keep the synthetic dashboard proof as engineering evidence only.

## Progress ledger

| Slice | Evidence | Disposition |
|---|---|---|
| Deterministic critical/ambiguous policy routing | `packages/policy/src/verification-policy.test.ts:41-82` | Proved for unit mechanics |
| Pending packet and exact review binding | `packages/application/src/verification-adjudication.ts:161-206`; adjudication tests | Proved for local mechanics |
| Human grant implementation and fail-closed checks | `packages/persistence/src/verification-adjudication-decision-preparation.ts:23-44`; persistence tests | Implemented/tested, no live human receipt |
| Native worker/API/dashboard synthetic e2e | proxy/full-startup/recovery scripts and receipts | Synthetic engineering only |
| Human-origin decision and campaign evidence | No accepted receipt found; all current proofs mark synthetic/no gold | Missing |
| VR-014 row | Acceptance matrix row 22 | Partial; retain missing until human proof |
