# SW-01 `parseArtifact` coverage audit and implementation plan

Status: design/audit only, 2026-09-06. No source, database, provider, or runtime service was changed or invoked. This document is the SW-01 progress ledger for the bounded planning task.

## Requirement and conclusion

The specification names `parseArtifact` as one of the first stable public use cases (specification §7) and requires every long-running use case to take an operation context, idempotency key, cancellation signal, artifact-based input, and return an operation receipt. The integration model places it between capture and structured extraction. The current-system summary explicitly records standalone `parseArtifact` as absent from HTTP, CLI, and MCP.

There is a production-quality **inline parser/admission primitive**, but there is no durable standalone public operation. `captureSource` currently calls it internally, so that operation cannot satisfy the public-use-case requirement without re-running capture or conflating capture and parsing receipts.

## Existing reusable implementation

| Component | What exists | Reuse decision |
| --- | --- | --- |
| `packages/conversion/src/verification-parser.ts` | `SandboxedVerificationParser` accepts only PDF/HTML bytes whose digest matches the declared parent. It runs an immutable-image, network-disabled Docker sandbox with CPU/memory/pid/temp/output/time limits and emits native parser output plus transformation identity. | Reuse unchanged as the parser port implementation. Do not expose its byte-based request publicly. |
| `packages/application/src/verification-admission.ts` | `VerificationAdmissionService.parseAndAdmit` authorizes and hydrates a registered capture artifact, checks capture/source/kind binding, validates native output, canonical projections, residuals, parser identity, and locator-preserving projections. It content-addressedly registers native output, projections, and a lineage envelope artifact. | Reuse as the one algorithm owner. Add a thin durable executor around it; do not copy parsing, locator, or registration logic. |
| `packages/documents/src/index.ts` | Deterministic structural nodes and `SourceLocator` construction bind representation ID, node ID, offsets and quote digest; verification checks locator reconstruction. | Parser output is already validated as canonical projections before registration. Preserve this representation/locator path; do not manufacture display selectors. |
| `packages/application/src/verification-service.ts` | `VerificationOperationApplicationService` and `VerificationOperationExecutor` register `verification_capture`; its capture branch calls `parseAndAdmit` and emits a `captureSource` result artifact. The current capture grant is HTML-only. | Split only the parse invocation/result registration into a new parse executor branch. Keep capture’s existing inline parse behavior for compatibility until an explicit migration is approved. |
| `apps/worker/src/verification-structured-extraction-runtime.ts` | Already composes the admission repository, sandbox parser, immutable parser-image digest, and `VerificationAdmissionService`. | Extend this factory/composition with the new executor capability; do not make an alternate parser runtime. |

## Exact current gaps

1. `VerificationUseCaseSchema` lists `parseArtifact`, but `VerificationOperationApplicationService` has no `submitParseArtifact`; request schemas, service request union, executor kind/use-case mapping, terminal result schema, and result artifact type do not include it.
2. There is no strict `ParseArtifactRequestSchema`. Existing capture request data contains source registration plus a capture-time parser grant; it is unsuitable as the standalone public contract because parsing must operate on an already registered capture and must not accept mutable source metadata or raw bytes.
3. API verification context typing and routes omit `parseArtifact`; there is no `POST /v1/verification/artifacts:parse` admission/capability gate.
4. TypeScript client, CLI command map/completion, MCP tool schemas/executor, and worker dispatch/activity registration omit it. The MC dispatch operation union also omits it, so it cannot be used by the existing cross-surface workflow.
5. There is no durable operation kind/step/result/receipt projection for parsing. Existing `captureSource` receipts cannot be re-labeled as parse receipts without breaking historical semantics.
6. Existing capture parsing accepts only `parserKind: "html"`; the lower parser/admission layer supports PDF. Standalone parsing needs trusted capture metadata to select only `html` for `web_page` and only `pdf` for `pdf`, rather than a caller-selected kind.

## Smallest correct implementation path

### 1. Contract and application boundary

Add a strict public `ParseArtifactRequestSchema` in verification contracts:

```ts
{
  verificationContractVersion: "verification.v1",
  captureId: UUID,
  sourceArtifact: { artifactId: UUID, digest: sha256 },
}
```

The schema deliberately has no bytes, URL, source object, parser image, parser kind, projection selector, parser options, or caller-supplied labels. Resolve kind from the registered capture/source inside `VerificationAdmissionService`; reject unknown modalities and source-artifact mismatch before sandbox start.

Add `verification_parse_artifact` as a distinct generic operation kind, `parse_and_admit` as its single fenced worker step, and `parseArtifact` in the application request/use-case mapping. The executor should call only:

```ts
admission.parseAndAdmit({
  tenantId: context.tenantId,
  captureId: request.captureId,
  expectedSourceArtifact: request.sourceArtifact,
  kind: trustedKind,
  signal,
})
```

Then register a bounded canonical JSON operation-result artifact with `producerAttemptId: context.attemptId`, all source/native/projection/transformation artifacts as parents, and an explicit `useCase: "parseArtifact"`. Its output should contain only the immutable projection-admission receipt summaries: capture ID, full registered handles for source/native/projection/transformation, kind, ordinal, parser version/image/options/transformation digests, and residual digest. It must not inline projection content or native parser output.

The terminal receipt kind should be `parse_and_admit.succeeded`; failures use the generic failure receipt and retain parser/cancellation/persistence distinctions. A terminal successful parse says custody/structural admission only; it is not an extraction, quality, semantic, or policy admission.

### 2. Runtime and persistence composition

Wire the new executor in the existing worker composition that already constructs `VerificationAdmissionService` and `SandboxedVerificationParser`. Reuse the current trusted artifact resolver, registered-capture lookup, content-addressed registration, producer attempt, lease, and operation recorder. A separate parser repository, raw-byte transport, or second registration algorithm would violate custody and “one algorithm owner.”

Persisted/native work required from the integration owner:

- permit `verification_parse_artifact` and `parse_and_admit` in generic operation/step admission;
- add the corresponding artifact/result vocabulary only if current generic vocabulary rejects `verification_parse_result` (the existing parser artifacts already use canonical types);
- ensure `getRegisteredCapture` returns immutable source kind and the capture’s full content-artifact handle, not caller JSON;
- fence result artifact registration and terminal receipt against the step lease/producer attempt exactly as other verification operations do.

### 3. Public surfaces

Add one typed client method targeting `POST /v1/verification/artifacts:parse`, with verification headers generated outside its JSON body. Add a narrowly named CLI command (for example `knowledge artifact parse`) and MCP tool (`knowledge_parse_artifact`) that call the same typed client method. Add MC dispatch only after KS HTTP is admitted and worker runtime registration is real; its operation must retain the existing compact durable identifiers/digest input rule.

The HTTP route must obtain the operation context from authenticated server identity, verify tenant grant and capture ownership before submit, and return the accepted generic operation envelope. It must never provide direct parser execution or raw projection bytes.

## Required tests

1. Contract rejects extra fields, raw bytes/URLs, caller parser kind/image/options, digest mismatch, and malformed handles.
2. Application submission records `verification_parse_artifact` with exact context/idempotency identity and rejects an unadmitted capability before operation creation.
3. Executor: valid HTML and PDF registered captures create the expected parser artifacts/envelopes/result artifact and terminal receipt; source-kind/kind mismatch, wrong capture/artifact binding, altered hydration bytes/handle, parser image/output/transformation drift, locator/projection/residual invalidity, and result-parent mismatch fail closed.
4. Idempotency/retry/cancellation: repeated request reuses one operation, cancellation reaches the parser signal and produces cancelled state, stale lease cannot register a terminal result, and parser/persistence failures do not become a quality success.
5. HTTP/client/CLI/MCP: authenticated tenant submit succeeds; cross-tenant/missing grant fails; all use the same request schema; no raw response content appears in compact output.
6. Integration: capture → standalone parse → extract structured data with the emitted admitted projection works without reparsing; standalone parse result remains distinct from `captureSource` and from policy admission.

## Source snapshot

| File | SHA-256 |
| --- | --- |
| `packages/conversion/src/verification-parser.ts` | `9B4570752636995388B6AF2825A0B22DB5A8F83D695AC04AED7F06CF78D4E42D` |
| `packages/conversion/src/verification-parser.test.ts` | `3851DEDD6E59C16A4631F6A6C4C50241570E3D2F3C34B3A53DA85446A1A603F4` |
| `packages/application/src/verification-admission.ts` | `A60E6703EC0B711DFB493B591164AFFC2D0D7DE18335EBE6505ECBC75904187C` |
| `packages/application/src/verification-service.ts` | `441337D0277C1D2077C125A78F9245AE49B6561F9B69CED95E924DF41E8D52B7` |
| `packages/documents/src/index.ts` | `3E331BC932AA6B095E7E18D6546AA0597264580232096FC50DD74FC341B109F1` |
| `apps/api/src/server.ts` | `46E80467F7D85D1BBE06E43AF8A644885957D2EFF3530E9DAE1F523B75385F26` |
| `apps/worker/src/verification-structured-extraction-runtime.ts` | `5928CBCE0B0F364EB3D12F346D84DC36AA29190C3A0EA9210DA8A030703CBAB5` |
| `packages/contracts/src/verification/operations.ts` | `838511CD619921890514817BF5E3AB1C8CF3A265CB7802FE70B84438098F080A` |

## Verification performed

Read-only source audit and contract/surface inventory only. No test was run because this task produces a design for later implementation and concurrent shared integration work is active.

