# WS-05 semantic and policy implementation brief

Coordinator preparation, not a workstream claim. Specification sections 5, 11, 12, 24 and diagnostics acceptance remain authoritative.

## Stable boundaries and required behavior

Use `packages/verification/src/semantic` and `policy`, with narrow facade exports and contracts where transport-visible. Run existing deterministic verification first. A semantic or human opinion cannot override byte, identity, locator, arithmetic, or deployment-independence failure. Keep five orthogonal properties separate: evidence support, world correctness, source authority, causal attribution, provenance. Exact source quotation establishes what a source says, not world truth or clinical validity.

The semantic port receives only bounded authorized evidence fragments, assertion/qualifiers, and a fixed rubric. No general filesystem, network, shell, delegation or tool array is exposed. Three-way NLI and strict evidence-only LLM judgments must return supported fragment IDs and unsupported facets, with exact provider/prompt/schema/config identity. Reject invented fragment IDs, malformed outputs, contradictory rubric fields and unbounded rationale. Do not label an LLM rubric as an independently trained NLI model. Implement cross-family second-judge selection for high risk/disagreement, and abstain/review when required diversity or capacity is unavailable. Actual provider execution belongs to WS-06; port tests may use explicitly synthetic adapters.

Preserve exact report offsets and qualifiers in atomic claim decomposition. Decomposition proposals must reconstruct report text and be evaluated against a versioned annotation set; punctuation splitting alone cannot be represented as semantic atomization. Cited evidence and uncited rescue evidence are separate judgments. Rescue is a separate port with explicit bounded retrieval/call/token budget. Source promotional statements, publication applicability and count/turnaround conflicts must remain explicit.

Report checks include weighted citation completeness separately from correctness, placement/invalid-pointer failures, duplicated or contradictory assertions, source independence, qualifier omissions, cross-section identity/date/number mismatches, and evidence-linked calculations. Closed-provider deletion/replacement/order perturbation adapters measure attribution sensitivity as an audit metric; they are not a causal-proof gate.

## Replay and policy

Policy is immutable versioned data, deterministically evaluated over recorded mechanical and semantic inputs. Record risk/downstream use, authority/independence/directness/freshness/jurisdiction/license observations, conflicts, deployment/provider diversity and review availability. Unknown critical facts cannot default to pass. Overrides require an authorized actor, reason, timestamp and before/after outcomes, append-only.

Read WS-03 provenance replay before implementing. Current `VerificationPolicyReplayPort` receives policy bytes, verification bundle and freshly replayed deterministic result, but not recorded semantic judgments/source assessments. Extend the sealed audit/policy input binding narrowly as needed so replay authorizes and rehydrates an immutable recorded-input artifact and recomputes the same policy decision without a model call. Do not hide per-run judgments in mutable closure state, rerun nondeterministic models during offline replay, or embed a new copy of policy code per run while claiming one stable policy hash. Existing unsigned/signed audit tests and registration protections must still pass. A caller-provided `replaySignatureMatch` flag is not a receipt; derive it in trusted composition from actual replay output.

## Required diagnostics truth-table cases

Exact field; normalized field; precise citation; missing qualifier/partial support; real 19-vs-21 within-page conflict; two turnaround statements with context; promotional clinical-accuracy statement withheld for authority; one-person technical triplicate distinguished from population accuracy; publication-to-product overextension rejected; corrupted locator as mechanical pointer failure; swapped entity/algorithm/count/negation contradicted where evidence supports that conclusion; unknown or visual-only graph value abstained. No patient-specific advice. First-party support must not become independent corroboration.

Human gold review, human policy promotion and production shadow evidence cannot be fabricated. Agent labels remain proposals. Live lab models chosen in D-011/D-012 are Gateway Luna baseline, Haiku cross-family judge, Terra justified escalation, and Interfaze extraction only, with maximum first-pilot estimated spend USD 20. No inference has been performed as of this brief.

## Coordinator integration notes — 2026-09-06

The native parser admission application is implemented in `packages/application/src/verification-admission.ts`. Its `hydrateAdmittedProjection` verifies a parent-specific transformation envelope and the immutable source/native/projection bytes. Generic `replayAuditBundle` currently hydrates the projection artifact directly and does not call that admission service. A registered projection by itself therefore does not prove that it was derived from the claimed capture. Keep this service/replay integration gate explicit and require the checked transformation binding in the eventual trusted composition. Pure selector availability is not parser admission.

Provider-reported confidence must not populate the existing `calibratedProbability` field without an actual versioned calibration procedure and held-out evidence. Preserve raw provider confidence separately, if collected. Likewise, a prompt-based three-way verdict is an LLM judgment, not evidence that a separate trained NLI model ran.

Coordinate ownership with the actual package topology: claims and authority primitives may live under the verification package; policy evaluation should extend the existing shared policy package without introducing a circular dependency. Immutable policy definitions and recorded run inputs are distinct artifacts. The coordinator will review schema bounds, deployment identity, source independence, qualifier reconstruction, and replay drift after the owner handoff.

Write shared ledger claims before editing, then meaningful tests and a hashed handoff. Coordinator acceptance follows independent adversarial review; passing synthetic semantic tests does not establish live judge calibration.
