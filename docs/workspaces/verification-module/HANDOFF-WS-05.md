# WS-05 bounded claims, semantics, authority, and policy handoff

**State:** bounded deterministic core accepted by coordinator; WS-05 remains partial.  
**Implementation owner:** verification-semantics-agent  
**Date:** 2026-09-06

## Delivered boundary

The contracts package now defines strict semantic judge identities and outputs, recorded source assessments, immutable policy definitions and inputs, decisions, and append-only override records. Generated JSON Schemas and public exports are rebuilt. Evidence support, world correctness, attribution faithfulness, source authority, and provenance integrity remain separate fields. Raw provider confidence is explicitly uncalibrated.

Claim decomposition admission requires exact UTF-16 report offsets, contiguous full-report reconstruction, exact segment text, atomic propositions, and preservation of every declared qualifier. The included annotation is declared synthetic and returns `pending_human_gold`; it is not human gold or a decomposition-quality estimate. Report diagnostics independently calculate claim-weighted citation completeness, total-citation correctness, valid-pointer conditional correctness, invalid and misplaced pointers, unsupported high-severity assertions, duplicate/conflicting statements, qualifier omissions, context-aware number/entity/date mismatches, distinct source families, and independently assessed source families. Aggregate sizes are rejected before grouping or flattening.

The semantic judge receives only an opaque process-admitted case built from a passed mechanical assertion and exact selected-fragment digest. A structurally fabricated case is rejected. Mechanical identity, selector, locator, and arithmetic failure closes the semantic route before any adapter call; an unsupported graph/visual resolver abstains. Output preflight bounds depth, nodes, object/array widths, and characters before serialization or schema parsing. The strict output validator rejects unknown fragments, duplicate references, extra fields/private reasoning, missing public rationale, and inconsistent support/contradiction fields. High-risk or disputed judgments require a distinct provider family and deployment or resolve to review/abstain.

Authority is derived from recorded source vectors rather than trusted from caller labels. First-party or promotional evidence never becomes independent corroboration. Population and product claims require the qualifying independent source itself to establish the applicable population/product scope, preventing an independent single-sample or antecedent-method paper from combining with an interested broad claim into sufficient authority. Clinical/comparative/causal/product scopes with insufficient authority are withheld.

Policy evaluation is deterministic over the recorded mechanical result, semantic records, source assessments, risk, downstream use, and metric records. It re-derives and checks authority, independence, conflicts, claim scope, and cross-family deployment diversity. A bundle-level or assertion-level mechanical failure always fails, including metric-only bundles. Unknown critical facts fail closed. An authorized override records the decision digest, before/after outcome, reason, trusted runtime principal, timestamp, and previous-record digest; neither `pass` nor `pass_with_warnings` can override a hard mechanical rejection.

The sealed audit bundle now binds a distinct immutable `verification_policy_inputs` artifact by complete handle, content digest, byte length, policy/run identity, deterministic result, assertion/fragment metadata, metrics, and manifest membership. Replay authorizes and hydrates policy and recorded-input bytes from private Storage, validates their handles and hashes, recomputes mechanics from source bytes and trusted runtime principals, and then invokes the shared application policy port. The policy port recomputes the same decision solely from the two immutable byte artifacts without a model call or mutable closure state. Signed, unsigned, handle-substitution, payload-tamper, and recorded-input-tamper regressions are present.

An additive canonical database migration registers the new artifact type. `@aiengineer/database-contract` is versioned as 0.2.1 and packed into a new vendor archive; the prior archive was not overwritten. The migration inside the archive is byte-identical to the canonical source. The local migration was applied with `supabase migration up --local` without reset.

## Provider port for WS-06

`SemanticJudgeAdapter` is the stable provider boundary:

```ts
interface SemanticJudgeAdapter {
  readonly identity: {
    deploymentId: string;
    provider: string;
    family: string;
    model: string;
    capability: "trained_nli" | "llm_evidence_rubric";
    graderVersion: string;
    promptDigest: `sha256:${string}`;
    outputSchemaDigest: `sha256:${string}`;
    configurationDigest: `sha256:${string}`;
  };
  readonly maximumInputCharacters: number;
  judge(
    input: {
      rubricVersion: "evidence-only.v1";
      assertionId: string;
      proposition: string;
      qualifiers: readonly string[];
      entityBindings: readonly { role: string; canonicalId: string }[];
      fragments: readonly { fragmentId: string; exactText: string }[];
    },
    execution: { signal?: AbortSignal; deadlineEpochMs?: number },
  ): Promise<unknown>;
}
```

Composition owns and snapshots `identity`; provider output cannot alter it. Calls are per-request cancellable. D011 remains Gateway Luna baseline, Haiku cross-family judgment, and Terra escalation. D012 remains the USD 20 first-live-pilot ceiling. This work makes no live-provider result, model quality, calibration, or production-shadow claim.

## Proof

Final source-state command:

```text
corepack pnpm verify
```

Exit 0: typecheck 43/43 tasks, tests 43/43 tasks, builds 24/24 tasks. Contracts pass 20/20 tests, verification 60/60, and policy 11/11. Log `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-ws05-authoritative-full-verify-20260906-40e1ba56-9e80-4483-b782-31590e1c8329.log`; 998 lines; SHA-256 `1cae515507eddd9c839b59dd0e07190b1f66097e3adb1dd81fef09d119409aad`.

The persistence proof script independently passes a strict isolated TypeScript check:

```text
corepack pnpm exec tsc --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --exactOptionalPropertyTypes --skipLibCheck --types node scripts/prove-verification-persistence.ts
```

Local Postgres/private Storage proof, run only through the local endpoint wrapper:

```text
node internal/verification-run-local-proof.mjs persistence
```

Exit 0: 26/26 checks, including actual application-port policy recomputation, stored decision digest equality, and tampered recorded-input rejection. Owner log `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-ws05-policy-replay-local-proof-20260906-c874ad2e-8cd5-4a68-8ef6-f4a432f85168.log`, SHA-256 `58a87478e70fc9eaa45bc9f2787058c0224c97fb54f3ef60800a0ffe0d33287e`. Receipt `catalog/verification-proofs/verification-persistence-48c3cd12-c6f2-4d12-b588-70f4230bdc6a.json`, SHA-256 `73f1e0810fd21434dd654bc09cc30e83b58fd879d2f3addd7a2555974ffea7e5`.

The coordinator independently repeated the same proof: 26/26 checks. Receipt `catalog/verification-proofs/verification-persistence-4a35e7da-11e9-4a7a-b61a-d17e3447e3b6.json`, SHA-256 `3f75b961eff44e01c6546d7a209dd9cc8864b3df4ee6fc8900abe468cec1d9ff`; log `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-coordinator-ws05-persistence-b917dae5-d646-4bb7-b0c6-1e285f02dbde.log`, SHA-256 `cb42495e5c987ed9323da148959fc0ae0b64f360619dfa099f8a9eff77c7065e`. Independent focused verification 60/60 and policy 11/11 log SHA-256 is `9a0a1d116aee0d6d718e8d964348bd3930e21adb1d0809a5d754f0974ecb841d`.

The coordinator's archive parity receipt confirms all 80 migrations and five source files are byte-identical: `C:\Users\Pinda\Proyectos\aiengineer\internal\verification-policy-vendor-parity-20260906.json`, SHA-256 `e3c7088f361809b913b90404a4e0d9acb2d147963fcc5d8e830c2e7d6dd10597`. Vendor archive SHA-256 is `7d814ec1f49c1303795b7ac492dae5287cf49f9f6823078eedef43df64c955c2`.

## Key source hashes

- `packages/contracts/src/verification/semantic-policy.ts`: `af3b15fb826e824eecde44c0ec4f521ba6c337969fed1a62a580bad376153d9c`
- `packages/verification/src/claims/decomposition.ts`: `02dcc343e12617abf8ce3802339299e274eb1bd5f8572ff154419ed6f6d95a59`
- `packages/verification/src/claims/report.ts`: `ec2be7e858abcb78ac647741802320d369403ac15ba8642bff0f06022a037df0`
- `packages/verification/src/authority/assessment.ts`: `8d7d7bea176b7ac9f89cd4a3d80103cf6869fffb9650ae189a54fb6b96e35c8e`
- `packages/verification/src/semantic/verification.ts`: `64fa6f888ee32e7b306f9b2f18a3f4d25d42255e2fa907175fbf0140ced0740f`
- `packages/verification/src/provenance/policy-inputs.ts`: `4217b58e62eeb82c0a3eeb3a83ba8943385ee785c0b7a0331a7cfe0780301b9f`
- `packages/verification/src/provenance/seal.ts`: `d4a1d18d1146934592a7f29b2b9229d517ec8b7dede170a52680b74699257beb`
- `packages/verification/src/provenance/replay.ts`: `a4cf086027afc26af414474feed2494497142b564cffe94dc14308f6f10e9902`
- `packages/policy/src/verification-policy.ts`: `03d08bb8b66c1e2c9c62cab8f16af984af7f85e73cadcd79be73ffb0d718ca91`
- `packages/application/src/verification-replay.ts`: `a9bbc3cfc40fa9d7940763a00b01880af2160845e5f463ea10fe77b7953ad009`
- `scripts/prove-verification-persistence.ts`: `74b5c33d5795d7731b17c183139465fdbc2d7f7874418dfda29257ab79774a24`
- canonical migration `20260905022000_verification_policy_inputs_artifact_type.sql`: `13d8506d93aea8c7ae14460e43474d58239883b1429cfca805f41df28d5b231c`

## Explicit remaining work

WS-05 remains partial. WS-06 must implement the actual Gateway/Interfaze adapters and conformance/pilot execution. WS-07 must supply licensed human labels, measured decomposition quality, bias/disagreement/calibration analysis, and production-shadow evidence. No synthetic fixture is labeled real gold.

The decomposition component only validates a declared proposal's offsets, reconstruction, atomization declaration, and qualifier retention; actual proposal generation and semantic completeness remain unproved. The rescue port returns `pending_mechanical_admission`. Attribution perturbations are audit metrics and explicitly set `causalProof: false`.

Generic `replayAuditBundle` still does not compose the parent-specific native PDF/HTML parser admission service before hydration. The existing application admission path remains authoritative for native projections; admission-aware general replay and cross-surface service integration are explicit WS-08 gates. Unsupported modality routes remain abstentions.
