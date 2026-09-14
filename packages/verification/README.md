# `@aiengineer/knowledge-verification`

For implementation, use the authoritative [final clean-code plan](CLEAN-CODE-RECOMMENDATION.md), which consolidates code and testing recommendations with ordered phases and completion criteria.

For an agent-oriented walkthrough of interfaces, call sequences and clean-code recommendations, start with the [comprehension guide](COMPREHENSION.md).

For the test suite, read the [testing comprehension guide](TESTING-COMPREHENSION.md) and [clean testing recommendation](CLEAN-TESTING-RECOMMENDATION.md).

Private workspace package that owns verification **algorithms** for Knowledge Services (`verification.v1`). Transport schemas live in `@aiengineer/knowledge-contracts`. `packages/application` composes use cases with persistence. `apps/api`, `apps/cli`, `apps/mcp`, and `apps/worker` are thin transports.

The module answers the spec’s five ordered questions (capture integrity → selector integrity → mechanical correctness → semantic support → policy admission). Later stages may add restrictions; they must not reverse an earlier deterministic failure. Orthogonal properties (evidence support, world correctness, attribution faithfulness, source authority, provenance integrity) are stored separately. Semantic/policy verdicts follow the contract lattice (`directly_supported`, `locator_error`, `unverifiable`, …). Cross-repository consumers must use HTTP, CLI, or MCP — never import this package.

## Invariants enforced here

| Invariant | Enforcement |
| --- | --- |
| Deterministic-before-semantic; monotonic failure | `verifyDeterministicBundle` sets `semanticEligibility` only when mechanical status is `passed` (`src/deterministic/engine.ts`). `authorizeSemanticCase` throws `SEMANTIC_MECHANICAL_GATE_CLOSED` otherwise (`src/semantic/verification.ts`). `applyReportWideMechanicalGates` can only add hard failures and clear eligibility (`src/claims/report.ts`). |
| Evidence-closed judges cannot override mechanical failure | `verifyAssertionSemantics` returns `mechanicalSemanticClosure` (`locator_error` / `unverifiable`, reason `MECHANICAL_GATE_CLOSED`) without calling a judge (`src/semantic/verification.ts`). Judges see only authorized fragment IDs/bytes (`JUDGE_FRAGMENT_ID_INVENTED`, digest match). |
| Content-addressed immutable captures | `CAPTURE_DIGEST_MATCH` / `CAPTURE_BYTE_LENGTH_MATCH` hash hydrated bytes against the registered handle (`src/deterministic/engine.ts`). Projection bytes are re-hashed the same way. |
| Selectors ≠ display excerpts | Resolution binds `selectorDigest = digestCanonicalJson(selector)` (`SELECTOR_DEFINITION_BOUND` in `src/deterministic/engine.ts`). Locator kinds are the contract union. HTML `canonicalTextFallback` is a check, not a locator (`src/selectors/resolvers.ts`). |
| Producer/verifier independence | `PRODUCER_VERIFIER_INDEPENDENT` requires distinct runtime principal deployments and principal digests (`src/deterministic/engine.ts`). |
| RFC 8785 canonicalization before hashing/sealing | `canonicalizeJson` / `digestCanonicalJson` (`src/deterministic/canonical.ts`). Manifest and audit seals hash that projection (`src/provenance/seal.ts`: `verificationManifestDigest`, `sealAuditBundle`). |
| Append-only judgments (seal-time) | There is no in-package judgment store or overwrite API. A run manifest’s `judgments` array is part of the RFC 8785 signable payload; changing it changes `manifestDigest` (`src/provenance/seal.ts`). The `Judgment` type is re-exported from contracts only. |

Policy admission (question 5) is **not** decided here. This package records policy-binding artifacts and digests; `packages/policy` is the admission authority.

## Module map

| Directory | Responsibility | Key exports (from that `index.ts`) | Tests |
| --- | --- | --- | --- |
| `src/deterministic/` | RFC 8785 JSON, SHA-256, decimal replay, built-in text/JSON selectors, bundle engine | `canonicalizeJson`, `digestCanonicalJson`, `sha256Digest`, `fromPrototypeSha256`, `toPrototypeSha256`, `parseDecimal`, `replayDecimalOperation`, `compareFractions`, `withinTolerance`, `formatRoundedDecimal`, `verifyDeterministicBundle`, `resolveBuiltInSelector`, `resolveWithAdmittedResolver` | `deterministic/deterministic.test.ts` |
| `src/selectors/` | Canonical projection parse + admitted resolvers for HTML/PDF/geometry/table/media/repo/dataset/API | `parseCanonicalProjection`, `ProjectionSelectorResolver`, `projectionSelectorResolver` | `selectors/resolvers.test.ts` |
| `src/extraction/` | Bounded schema gate, field/evidence verification against capture bytes | `admitExtractionSchema`, `validateExtractionCandidate`, `verifyExtractionFields`, `verifyExtractionFieldsWithEvidence`, `EXTRACTION_SCHEMA_GATE_VERSION` | `extraction/extraction.test.ts` |
| `src/provenance/` | Audit-bundle seal/inspect, replay, recorded policy-input check, benchmark publication, DSSE/SLSA attestation | `sealAuditBundle`, `inspectAuditBundle`, `verificationManifestDigest`, `createEd25519Signer`, `createEd25519Verifier`, `replayAuditBundle`, `validateRecordedPolicyInputsArtifact`, `sealVerificationBenchmarkPublication`, `verifyVerificationBenchmarkPublication`, `sealVerificationBenchmarkComparisonPublication`, `verifyVerificationBenchmarkComparisonPublication`, `createVerificationDsseSlsaAttestation`, `inspectVerificationDsseSlsaAttestation`, `verificationDssePae` | `provenance/provenance.test.ts`, `attestation.test.ts`, `benchmark-publication.test.ts`, `benchmark-comparison-publication.test.ts` |
| `src/claims/` | Claim atomization acceptance; report-wide mechanical gates | `acceptClaimDecomposition`, `evaluateDecompositionProposal`, `claimClassifications`, `verifyReportWide`, `verifyReportWideFromLedger`, `applyReportWideMechanicalGates` | Covered in `semantic/diagnostics.test.ts` (no `claims/*.test.ts`) |
| `src/authority/` | Source-fitness / independent-corroboration decision from assessments | `assessSourceAuthority` | Covered in `semantic/diagnostics.test.ts` (no `authority/*.test.ts`) |
| `src/semantic/` | Evidence-closed authorization, judge ports, rescue proposals, attribution audit metrics | `authorizeSemanticCase`, `verifySemanticCase`, `verifyAssertionSemantics`, `mechanicalSemanticClosure`, `observeSemanticModelDrift`, `semanticCalibrationStatus`, `proposeUncitedEvidenceRescue`, `summarizeAttributionPerturbations` | `semantic/verification.test.ts`, `semantic/diagnostics.test.ts` |
| `src/providers/` | Conformance registry, bounds, injected-`fetch` Gateway/Interfaze adapters, recorded/NLI judges | `providerRegistry`, `registeredProvider`, `ProviderFailure`, `GatewaySemanticJudgeAdapter`, `GatewayStructuredExtractionProvider`, `InterfazeStructuredExtractionProvider`, `RecordedSemanticJudgeAdapter`, `ThreeWayNliSemanticJudgeAdapter` | `providers/providers.test.ts`, `semantic-judge.test.ts`, `gateway-semantic-observation.test.ts` |
| `src/prototype-compat.ts` | Legacy `research_ingestion_systems_agent` locator/hash shapes | `prototypeSha256`, `resolvePrototypeTextLocator`, `resolvePrototypeJsonPointer` | `prototype-compat.test.ts` |
| `src/prototype-bundle-compat.ts` | Offline translation of `verification-bundle-0.1.0` (unauthenticated prototype mechanics only) | `verifyPrototypeBundle`, `replayPrototypeArithmetic` | `prototype-compat.test.ts` |

`prototype-compat.ts` and `prototype-bundle-compat.ts` are compatibility facades for the legacy prototype bundle format. They reproduce unprefixed SHA-256 and IEEE-754 arithmetic. They do not create KS provenance bindings, semantic verdicts, runtime-principal attestation, or policy admission.

## Responsibilities outside this package

Spec §6.2 also lists metrics, experiments, demos, and a `domain/` tree under this package. Those live elsewhere:

| Spec concern | Location (verified) |
| --- | --- |
| Metrics | `packages/application/src/verification-metrics.ts` |
| Experiments / benchmarks | `packages/evaluation/src/verification-benchmark.ts`, `verification-benchmark-v1.ts`, `verification-benchmark-run-comparison.ts`, `verification-statistics.ts`, `verification-human-review.ts`; `packages/application/src/verification-benchmark.ts` and `verification-benchmark-*.ts` |
| Demos | `apps/cli/src/diagnostics-demo.ts`; `packages/application/src/verification-diagnostics-*.ts` |
| Persistence | `packages/persistence/src/verification.ts` and `verification-*.ts` |
| Policy admission | `packages/policy/src/verification-policy.ts` |

## Facade (`src/index.ts`)

Re-exports every subdirectory index plus the two prototype-compat modules.

From `@aiengineer/knowledge-contracts` it also re-exports:

- Schemas: `DeterministicVerificationResultSchema`, `VerificationBundleSchema`, `VerificationContractVersionSchema`, `VerificationMetricObservationSchema`, `VerificationOperationContextSchema`, `VerificationPolicyDecisionSchema`, `VerificationPolicyDefinitionSchema`, `VerificationRecordedPolicyInputsSchema`, `VerificationSelectorSchema`
- Types: `Assertion`, `DeterministicVerificationResult`, `EvidenceEdge`, `Judgment`, `ResolvedSelector`, `VerificationArtifactHandle`, `VerificationBundle`, `VerificationMetricObservation`, `VerificationOperationContext`, `VerificationPolicyDecision`, `VerificationPolicyDefinition`, `VerificationRecordedPolicyInputs`, `VerificationRunManifest`, `VerificationSelector`, `VerificationSource`, `VerificationSourceCapture`

## Usage

### Resolve a selector

```ts
import { resolveBuiltInSelector, sha256Digest, type ResolvedSelector } from "@aiengineer/knowledge-verification";

const content = new TextEncoder().encode("Intro. RAG was basically just a hack.");
const selection = resolveBuiltInSelector({
  captureId: "capture-1",
  representationArtifactId: "22222222-2222-4222-8222-222222222222",
  representationDigest: sha256Digest(content),
  selector: { kind: "text_quote", quote: "RAG was basically just a hack", normalization: "none" },
  content,
});
const resolution: ResolvedSelector | undefined = selection?.resolution;
```

HTML/PDF/table/media/repo/dataset/API selectors go through `projectionSelectorResolver` (or `resolveWithAdmittedResolver(request, [projectionSelectorResolver])`) against a canonical projection whose UTF-8 JSON equals `canonicalizeJson(value)`.

### Deterministic engine (bundle or extraction)

```ts
import {
  verifyDeterministicBundle,
  verifyExtractionFields,
  projectionSelectorResolver,
} from "@aiengineer/knowledge-verification";

const deterministic = verifyDeterministicBundle(
  {
    bundle,
    artifacts: [{ artifactId: handle.artifactId, content }],
    runtimePrincipals: {
      basis: "runtime_principal_binding",
      producerDeploymentId: "research-synthesis",
      verifierDeploymentId: "verification-agent",
      producerPrincipalDigest,
      verifierPrincipalDigest,
    },
  },
  { selectorResolvers: [projectionSelectorResolver] },
);

const fields = verifyExtractionFields({
  schema, // AdmittedExtractionSchema from admitExtractionSchema(...)
  candidate,
  fields: [{ path: "/vendor", comparison: "exact" }],
  evidence: [{
    path: "/vendor",
    captureId,
    representationArtifactId,
    representationDigest,
    selector: { kind: "json_pointer", pointer: "/vendor" },
  }],
  representations: [{ captureId, artifactId, digest: representationDigest, content }],
});
```

### Canonicalize and digest (RFC 8785)

```ts
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";

const canonical = canonicalizeJson({ b: 1, a: 2 });
const digest = digestCanonicalJson({ b: 1, a: 2 }); // `sha256:${hex}`
const raw = sha256Digest(new TextEncoder().encode(canonical));
```

### Seal or attest

```ts
import {
  sealAuditBundle,
  inspectAuditBundle,
  createEd25519Signer,
  createEd25519Verifier,
  createVerificationDsseSlsaAttestation,
  inspectVerificationDsseSlsaAttestation,
} from "@aiengineer/knowledge-verification";

const audit = await sealAuditBundle({
  tenantId,
  verificationBundle,
  manifest, // canonicalization.manifestDigest must equal verificationManifestDigest(manifest)
  policyBinding: { policyVersion, policyArtifact, recordedPolicyInputsArtifact },
  recordedPolicyInputsBytes,
  policyDecision,
  signer: createEd25519Signer(privateKeyPem, "key-1"),
});
const inspection = await inspectAuditBundle(audit, createEd25519Verifier({ "key-1": publicKeyPem }));

const attestation = await createVerificationDsseSlsaAttestation({
  auditBundle: audit,
  auditBundleVerifier,
  signer,
  trustedBinding: { builderId, keyId: "key-1" },
});
await inspectVerificationDsseSlsaAttestation({
  auditBundle: audit,
  auditBundleVerifier,
  envelope: attestation.envelope,
  attestationVerifier,
  expectedBinding: { builderId, keyId: "key-1" },
});
```

## Development

Canonical commands:

```bash
corepack pnpm --filter @aiengineer/knowledge-verification typecheck
corepack pnpm --filter @aiengineer/knowledge-verification test
corepack pnpm --filter @aiengineer/knowledge-verification build
```

On Windows Git Bash, `corepack` may not be on `PATH`; use `corepack.cmd` instead of `corepack` for the same commands.

Tests are colocated `*.test.ts` files run by `vitest run` (package script; no local Vitest config). Frozen prototype-parity input lives at `src/deterministic/testing/prototype-parity.fixture.ts`.

## Boundaries

This package must not:

- Own persistence, tenant authorization, or artifact registration (application + `packages/persistence`).
- Be the policy admission authority (`packages/policy`).
- Put provider SDK client objects on the public facade. Adapters take `fetch`, an API key, and a `ProviderArtifactSink`.
- Perform filesystem I/O. (Gateway/Interfaze adapters may call an injected `fetch`; that is the only network path.)
- Be imported by other repositories. Cross-repo callers use HTTP, CLI, or MCP.
