# SW-01 `parseArtifact` implementation progress

Owner scope: dedicated parse contract through configured application, worker, HTTP, typed-client, CLI, and MCP boundaries. Updated 2026-09-07.

## 2026-09-07 standalone integration in progress

- The isolated core now validates the complete source handle against the registered capture before invoking the parser, validates the strict result body before a fenced result write, and checks cancellation immediately before that write.
- This pass is adding the `verification_parse_artifact` operation vocabulary and its single `parse_and_admit` step, then will connect submission and configured runtime composition. Runtime registration remains unavailable unless an explicit parse capability flag and an exact trusted capture grant catalog are both configured.
- No database, object storage, provider, Docker, or other shared infrastructure action has been performed. Native/runtime evidence will remain pending until a configured environment is supplied.

## Implemented core

- `packages/contracts/src/verification/parse.ts` defines strict artifact-only `ParseArtifactRequestSchema`: `captureId` is the existing bounded capture identifier and `sourceArtifact` is a complete `VerificationArtifactHandle`, not an ID/digest pair. Caller parser kind/image/options, bytes, URLs, and labels are rejected by strict parsing.
- `packages/application/src/verification-parse.ts` reuses `VerificationAdmissionService.parseAndAdmit` as the sole parser/projection/locator algorithm owner. It exact-compares the full returned source handle with the caller handle using canonical JSON, validates capture consistency across receipts, and registers one ledger result artifact whose parents are the source, native output, canonical projection, and transformation envelopes. Its successful status is `canonical_projection_admitted`, not extraction or policy admission.
- `apps/worker/src/verification-parse-activity.ts` performs liveness checks before kind resolution, before execution, and after execution. Parser kind is resolved through a server-owned `resolveKind` dependency using trusted capture identity; it is not in the activity/public request input. Cancellation reaches the application parser through an abort signal.

## Owned files and snapshot hashes

| File | SHA-256 |
| --- | --- |
| `packages/contracts/src/verification/parse.ts` | `9E2EB721287122F499223C2C2BF100C34BD0BEB89F8A044FD26451A3F0CB5249` |
| `packages/contracts/src/verification/parse.test.ts` | `D7AEEB16CD65D4E041965759A51D298392DB8385BF8679EEA80828CD1452C041` |
| `packages/application/src/verification-parse.ts` | `A767B8E3E21DE36CB37640516C1DF88AC52A0E62D182DA55A7BE3D8661B961A6` |
| `packages/application/src/verification-parse.test.ts` | `8DEA4D64A5EEE5AA4C235A67A3815D21EB95B8D2978D2B59915EBBA56A22DF81` |
| `apps/worker/src/verification-parse-activity.ts` | `D2A65C7F3BA9AF1ED27CDD93154209ADA2ED8F55B2C11891404C29D2B25367A1` |
| `apps/worker/src/verification-parse-activity.test.ts` | `30626F8DA9CE41BDC3E44FACB7E09E1F5CE2BA2FEBC366F1561B1842C7C90C77` |

## Focused verification

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/knowledge-contracts typecheck` | 0 | Passed. |
| `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/parse.test.ts` | 0 | 2 passed. |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | 0 | Passed. |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-parse.test.ts` | 0 | 2 passed. |
| `corepack pnpm --filter @aiengineer/knowledge-worker typecheck` | 0 | Passed. |
| `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-parse-activity.test.ts` | 0 | 2 passed. |

These are isolated mocks/fixtures only. They are not a native persistence, sandbox-Docker, API, CLI, MCP, or provider proof.

## Historical integration checklist (superseded by the 2026-09-07 standalone integration update)

1. Export `verification/parse.ts` from contracts and `verification-parse.ts` from application indexes.
2. Add a generic `verification_parse_artifact` operation kind, one fenced `parse_and_admit` step, terminal `parse_and_admit.succeeded` receipt, and allow `verification_parse_result` in the native artifact vocabulary if its generic type guard requires it. Use the existing lease and producer-attempt guard for result registration.
3. In worker factory/registry, construct `ParseArtifactApplicationService` with the existing `VerificationAdmissionService` and native artifact repository. Implement `resolveKind` from the registered capture/source: `web_page -> html`, `pdf -> pdf`; reject every other source kind and never trust request data for this choice.
4. Add an application submit method and executor mapping with `parseArtifact`, then wire HTTP `POST /v1/verification/artifacts:parse`, typed client, CLI, MCP, and MC dispatch only after the real worker handler is registered. All surfaces must use `ParseArtifactRequestSchema` and server-derived context.
5. Add durable native tests for idempotency, lease loss, cancellation, exact capture/handle binding, parser failure, result-parent closure, and capture → parse → structured extraction reuse. Do not claim native success until these run against configured persistence/runtime.

## 2026-09-07 standalone integration update

- Added `verification_parse_artifact` to the shared operation contract and the single `parse_and_admit` surface step. It is deliberately absent from the generic production worker list; the configured worker registers its dedicated handler only when `VERIFICATION_PARSE_ARTIFACT_ENABLED=1` and `VERIFICATION_SERVICE_CATALOG_JSON` is present.
- Added `submitParseArtifact`, strict HTTP `POST /v1/verification/artifacts:parse`, typed client `parseArtifact`, CLI `artifact parse`, and MCP `knowledge_parse_artifact`. The HTTP route returns `CAPABILITY_NOT_ADMITTED` without an injected admission predicate and `FORBIDDEN` before enqueue when the configured catalog lacks the source artifact grant.
- Worker composition now resolves the capture natively, exact-compares its complete handle, resolves parser kind from the immutable catalog, and uses the existing `PostgresVerificationRepository.registerFencedContentAddressedArtifact` through the parse application service. It does not register when the flag is absent.
- Current source checks: contracts build, application build, client build, and API/CLI/MCP/worker typechecks passed after the shared-contract build. Focused route/client/CLI/MCP tests are being run next.

### Current limitations

- API pre-enqueue admission checks the configured source artifact identity; native worker execution repeats complete capture-handle and source-grant binding before parser invocation. There is no configured persistence/runtime proof in this workspace, and no Docker, database, storage, or provider call was made.
- The generic `verificationServiceOperationKinds` remains limited to capture/extraction/replay. Parse is supplied only by the explicit parse flag in API and worker composition, so installing contracts alone never enables queue admission or execution.
- Independent review identified that artifact ID/digest catalog probing was insufficient for a public parse enqueue. The parse flag now additionally requires nonempty `parseArtifactGrants`, each containing `captureId`, the complete immutable source handle, and server-owned parser kind. API admission and worker kind resolution use that exact grant; a changed `objectKey` is rejected in the focused application test.

### Focused checks completed

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/parse.test.ts` | 0 | 3 strict contract tests passed. |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-parse.test.ts src/verification-service.test.ts` | 0 | 7 tests passed, including no-parser source mismatch and no-write malformed receipt. |
| `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-parse-activity.test.ts` | 0 | 2 liveness/lease adapter tests passed. |
| `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-routes.test.ts` | 0 | 10 route tests passed, including unavailable/denied/admitted parse submission. |
| `corepack pnpm --filter @aiengineer/knowledge-client exec vitest run src/client.test.ts` | 0 | 8 tests passed, including strict parse route body. |
| `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run src/commands.test.ts` | 0 | 12 command-routing tests passed. |
| `corepack pnpm --filter @aiengineer/knowledge-mcp exec vitest run src/verification-tools.test.ts` | 0 | 7 MCP adapter tests passed. |
| `corepack pnpm --filter @aiengineer/knowledge-api typecheck; corepack pnpm --filter @aiengineer/knowledge-worker typecheck; corepack pnpm --filter @aiengineer/knowledge-cli typecheck; corepack pnpm --filter @aiengineer/knowledge-mcp typecheck` | 0 | Post-admission-predicate typechecks passed. |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-service.test.ts src/verification-parse.test.ts; corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-routes.test.ts; corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-parse-activity.test.ts` | 0 | 8 application, 10 API, and 2 worker tests passed after exact parse-grant tightening. |

### Integration-owned source

- `packages/contracts/src/integration.ts`, `packages/application/src/surface.ts`, and `packages/application/src/verification-service.ts`
- `apps/worker/src/index.ts` and `apps/worker/src/verification-parse-activity.ts`
- `apps/api/src/index.ts` and `apps/api/src/server.ts`
- `packages/client-typescript/src/client.ts`, `apps/cli/src/commands.ts`, `apps/mcp/src/catalog.ts`, and `apps/mcp/src/index.ts`
- Focused tests: API verification routes, typed client, CLI commands, and MCP verification tools.

## Ordered workspace verification (2026-09-07)

- Added the agreed application-index-only export for `verification-audit-inspection`.
- `corepack pnpm exec turbo run typecheck test build --concurrency=1` wrote [`internal/verification-knowledge-parse-audit-verify-20260907.log`](../../../../../internal/verification-knowledge-parse-audit-verify-20260907.log) and exited 1 after 57 of 60 tasks. The only reported failures were four timeout-only application benchmark tests: `verification-benchmark-profile`, `verification-benchmark-registered-replay`, `verification-benchmark-response-replay`, and `verification-benchmark`. There was no parseArtifact assertion/type/build failure in the log.
- A first logging attempt found the requested `internal/` directory absent and inadvertently left an unlogged duplicate Turbo process running. It was stopped once identified; the recorded logged run was the remaining ordered run. This contention may explain the timeout-only failures, so this is not evidence of a clean full workspace pass.
