# SW-01 `parseArtifact` independent review

Reviewed 2026-09-06. This is a source-only review of the new contract, thin application composition, worker adapter, their focused tests, and the SW-01 plan/progress records. No source under review was edited, no database/provider/runtime was invoked, and no shared KS build/test command was run while the integration owner sequences that work.

## Reviewed snapshot

| File | SHA-256 |
| --- | --- |
| `packages/contracts/src/verification/parse.ts` | `9E2EB721287122F499223C2C2BF100C34BD0BEB89F8A044FD26451A3F0CB5249` |
| `packages/contracts/src/verification/parse.test.ts` | `D7AEEB16CD65D4E041965759A51D298392DB8385BF8679EEA80828CD1452C041` |
| `packages/application/src/verification-parse.ts` | `A767B8E3E21DE36CB37640516C1DF88AC52A0E62D182DA55A7BE3D8661B961A6` |
| `packages/application/src/verification-parse.test.ts` | `8DEA4D64A5EEE5AA4C235A67A3815D21EB95B8D2978D2B59915EBBA56A22DF81` |
| `apps/worker/src/verification-parse-activity.ts` | `D2A65C7F3BA9AF1ED27CDD93154209ADA2ED8F55B2C11891404C29D2B25367A1` |
| `apps/worker/src/verification-parse-activity.test.ts` | `30626F8DA9CE41BDC3E44FACB7E09E1F5CE2BA2FEBC366F1561B1842C7C90C77` |

## Findings requiring correction

### P0 — the successful result cannot satisfy its own strict contract

`VerificationParseArtifactResultSchema.output.projections` accepts a compact object with nine fields. `ParseArtifactApplicationService.execute` serializes the full `ProjectionAdmissionReceipt` instead. Each actual receipt also has `schemaVersion`, `captureId`, and `sourceArtifact`; Zod strict-object parsing therefore rejects the result body before considering the top-level `resultArtifact`. The existing application test observes only `result.output.status` and registered-parent IDs, so it never parses the produced result with the exported schema.

Fix one representation and test it at the serialization boundary. Either extend the contract's projection schema to losslessly include the receipt's `schemaVersion`, `captureId`, and full `sourceArtifact`, or map each receipt to the compact contract shape before canonical serialization. Then construct the exact returned `{ ...body, resultArtifact }` and require `VerificationParseArtifactResultSchema.parse(result)` to succeed. This is a release blocker because downstream HTTP/client/worker code cannot rely on an internally self-inconsistent result contract.

### P1 — caller full-handle tampering is detected only after parser work and admission writes

The public request deliberately requires a complete registered `VerificationArtifactHandle`, but `execute` passes only its artifact ID and digest to `VerificationAdmissionService.parseAndAdmit`. That service validates those two fields, hydrates bytes, invokes the parser, and registers native/projection/transformation artifacts. Only after it returns does `execute` compare `canonicalizeJson(receipt.sourceArtifact)` with the complete caller handle. A caller can change `objectKey`, media type, retention/classification, parent IDs, or other full-handle fields while preserving artifact ID/digest; the request is rejected, but only after expensive work and durable writes.

Move exact full-handle binding before parser invocation. The trusted capture lookup/hydration boundary must compare the supplied handle byte-for-byte/canonical-JSON-equivalently with the registered capture content handle, verify tenant/capture ownership, and reject before sandbox execution or artifact registration. Do not solve this by weakening the public request to an ID/digest pair: the stated contract intentionally preserves the full immutable-handle identity.

Add an adversarial test that changes only `objectKey` (and separately one non-locator immutable field) while retaining ID/digest, asserts a binding error, zero parser calls, and zero registration calls. The current test changes a receipt returned *after* parsing and cannot prove this property.

### P1 — there is no canonical durable handler or fencing at the registration boundary

The activity's `assertActive` checks are liveness probes; they do not carry a claimed step, lease token, fencing token, or atomic terminal receipt transition. `ParseArtifactApplicationService` accepts a repository whose `registerContentAddressedArtifact` has no lease/claim argument. Consequently an activity that loses its lease between the final `assertActive` and result registration can still register a parse result; no operation kind, `parse_and_admit` step, handler/registry entry, terminal receipt, or native artifact vocabulary is wired yet.

Integrate through the existing canonical verification operation handler before exposing any surface: add `verification_parse_artifact`, one claimed/fenced `parse_and_admit` step, idempotent input identity, result-registration guard bound to that exact claim, and terminal `parse_and_admit.succeeded` receipt. Pass the claim/lease to the write-side repository path and have the storage/operation transition reject stale fencing. Preserve cancellation as a terminal cancellation rather than treating an aborted signal as a generic parser success/failure. Add native tests for duplicate submission convergence, lease loss before result write, cancellation during parser execution, parser failure, and result-parent closure.

### P2 — local duplicate types and `as never` fixtures hide contract drift

The application and worker redeclare `ParseArtifactCommand`/result shapes instead of importing `ParseArtifactRequest` and `VerificationParseArtifactResult` from the new contract. The application test casts the admission dependency and `OperationContext` to `never`; the worker test casts both a two-field context and malformed request/source handle to `never`. Those tests would remain green if the exported request schema, complete source handle, or required operation-context fields changed incompatibly.

Import and use the contract types/schemas at both boundaries. Parse untrusted activity/public input with `ParseArtifactRequestSchema`; validate the generic operation context at the ingress that creates the durable activity. Replace `as never` with complete valid fixtures built from the schemas, and add negative tests for malformed request/handle/context. Keep narrow structural interfaces only where they genuinely abstract a dependency, not to shadow an external contract.

### P2 — accepted capture IDs do not match the current parser admission identity rule

`ParseArtifactRequestSchema` accepts any trimmed 1–255-character `captureId`, and its test explicitly accepts `capture-1`. `VerificationAdmissionService.capture` requires a UUID-form capture ID before it loads the registered capture. The public contract therefore accepts values that always fail later as `ADMISSION_IDENTITY_INVALID`.

Choose one identity rule and apply it consistently. If registered captures are UUIDs in this path, use `UuidSchema` in the parse request and update fixtures. If non-UUID verification IDs are intended, update the admission repository/validation path and demonstrate a real registered non-UUID capture. The API must reject impossible identifiers before durable submission.

## What is sound in the proposed direction

The request excludes raw bytes, URLs, parser kind, parser image, and parser options. The worker intends server-owned kind resolution and passes cancellation through an `AbortSignal`. The application reuses `VerificationAdmissionService` rather than copying parsing/locator logic, and its intended result-parent closure includes source, native output, canonical projections, and transformation envelopes. Retain those constraints while applying the fixes above.

## Required re-review evidence

1. Contract-to-produced-result round-trip test, including one HTML and two PDF projections.
2. Pre-parser full-handle mismatch tests proving no parser invocation and no writes.
3. Native durable handler tests proving idempotency, lease/fence rejection, cancellation, parser failure, result parent closure, and exact capture/source binding.
4. Cross-package typecheck and focused tests only after the integration owner wires contract exports and the real handler; HTTP/CLI/MCP/MC remain out of scope until then.

No SW-01 acceptance or runtime success is claimed by this review.
