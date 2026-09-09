# SW-03 independent review

Date: 2026-09-06. Reviewer did not author the reviewed semantic/configuration/application files. This is a source and focused-test review only; no provider, database, Docker, or `.env` action was performed.

## Evidence inspected

| File | SHA-256 |
| --- | --- |
| `packages/verification/src/semantic/verification.ts` | `b07321d536074f4c26e874fc6dd862e36ae93f645c8c9a02ce5e977367a88cad` |
| `packages/verification/src/providers/semantic-judge.ts` | `91d379aab11a20bd6875b4cd5039c8ea84e42ec24f22290f6d8ea98d87adcba0` |
| `packages/config/src/index.ts` | `01c282c10ceeb2b20d42e45f0cb2c95575dfc47d2129749b121385bdf23cc0ea` |
| `packages/application/src/verification-semantic.ts` | `8796a653944a7360df9fd96e1871ef0b225cba0baa93bd2f198824ae7da5657a` |

Focused commands:

| Command | Exit | Result |
| --- | --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-verification test` | 0 | 10 files, 83 tests |
| `corepack pnpm --filter @aiengineer/knowledge-config typecheck` | 0 | passed |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | 0 | passed |

## Findings

### SR-01 — public application boundary accepts caller-supplied bundle, deterministic result, fragments, and judge adapters (P1)

`verifySemanticEvidence` accepts the complete `VerificationSemanticRequest` directly. The caller therefore chooses both semantic judge identity and the asserted mechanical result/bundle/fragments. Its collision checks prevent only obvious same-deployment identities; they do not establish an independently server-owned verifier or bind the semantic input to registered evidence custody. This violates the independent verifier and trusted composition requirements.

Fix: accept only a server-admitted claims/run handle plus operation context at the public/application boundary. Hydrate the exact registered bytes, recompute deterministic eligibility, derive runtime verifier identities from server configuration, then create the branded semantic case internally. Keep the current helper private or explicitly internal.

### SR-02 — “empty tool catalog” is a declaration, not runtime capability evidence (P1)

The adapter contract accepts optional `toolCatalog`; validation only rejects a nonempty declared array. A malicious or misconfigured adapter can omit the property while retaining network/filesystem/delegation capabilities. `loadSemanticJudgeConfig` similarly verifies only an environment string. Current tests prove adapter declarations, not an observed runtime tool inventory.

Fix: make deployment composition supply an immutable capability-attestation artifact or a restricted runner that constructs the adapter with no tool interfaces. Persist its digest in each judgment/run. Label existing tests as interface-policy tests, not prohibited-tool execution proof.

### SR-03 — drift observation is detached from execution and durable judgment records (P2)

`observeSemanticModelDrift` computes a useful local alert, but neither adapter returns a provider-reported model nor `verifySemanticCase` attaches the observation to `SemanticAssessmentRecord`. A returned-model change thus cannot be observed from actual judge execution or persisted for an alert.

Fix: extend the trusted provider response envelope with requested/returned model, calculate drift inside the adapter/runtime, and persist the observation/artifact as part of the append-only judgment.

### SR-04 — recorded fixture outputs are mutable after adapter construction (P2)

`RecordedSemanticJudgeAdapter` retains the caller’s `ReadonlyMap` reference. `ReadonlyMap` is compile-time only, so a holder of the original `Map` can replace an output after the adapter is constructed. The input digest lookup prevents assertion-ID substitution, but does not make recorded fixture output immutable.

Fix: copy and deep-freeze parsed outputs into a private `Map` in the constructor. Add a regression that mutates the source map after construction and expects the original recorded result.

## Confirmed strengths and limits

- The semantic core recalculates the blinded input digest over assertion ID, proposition, qualifiers, entity bindings, and exact selected fragments. NLI receives qualifiers, entities, fragments, and execution cancellation/deadline controls.
- A branded `AuthorizedSemanticCase`, mechanical eligibility check, selected-content digest replay, duplicate fragment rejection, and same-family/deployment cross-judge refusal are present in the core.
- Recorded fixtures are keyed by blinded input digest and tests pass, but this does not prove a live evidence-closed provider, model drift detection, a sandboxed tool surface, calibration, or human-label quality.
- No semantic source edit was made in this review.
