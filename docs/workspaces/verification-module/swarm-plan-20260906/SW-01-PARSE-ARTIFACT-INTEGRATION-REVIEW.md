# SW-01 parseArtifact integration review

Independent read-only review completed 2026-09-07 against the dashboard agent's stable source snapshot.

## Result

No source-level bypass was found in the public parseArtifact integration. The initially observed API admission weakness (matching only an artifact ID and digest) was corrected before this review snapshot: the configured catalog now requires a nonempty immutable `parseArtifactGrants` set with the capture ID, complete source handle, and server-owned parser kind. API admission checks the authenticated tenant and canonical full handle, while the worker re-resolves the registered capture and repeats the full-handle check before deriving parser kind.

The integration is source-checked only. It is not evidence that a configured PostgreSQL/object-store/Sandboxed parser deployment has registered, fenced, or recovered a parse result.

## Boundary review

- `packages/contracts/src/verification/parse.ts` exposes a strict, artifact-only request. It rejects caller parser identity, image, options, bytes, URLs, and labels. Its terminal result requires the full source handle, bounded projection receipts, and a result artifact.
- `packages/application/src/verification-parse.ts` reads the native capture by authenticated tenant and capture ID, exact-compares the entire canonical source handle, invokes `VerificationAdmissionService.parseAndAdmit` as the single parser/projection owner, checks every receipt binding, validates the terminal body before writing, checks cancellation, and writes a ledger result with source/native-output/projection/transformation parents through `registerFencedContentAddressedArtifact`.
- `packages/application/src/verification-service.ts` adds an immutable `VerificationParseArtifactGrant` keyed by capture ID plus canonical complete handle. `parseArtifact()` is the server-owned parser-kind lookup and `admitsParseArtifact()` is the API probe.
- `apps/worker/src/index.ts` only registers the parse handler with `VERIFICATION_PARSE_ARTIFACT_ENABLED=1`, a verification catalog, a parser image digest, and nonempty parse grants. It obtains the capture from `PostgresVerificationRepository`, compares its complete handle, then derives kind from the configured grant. `apps/worker/src/verification-parse-activity.ts` checks liveness around resolution and application execution and passes the claimed lease to the fenced result writer.
- `apps/api/src/index.ts` refuses enabled parse configuration without dynamic verification context or nonempty strict grants. `apps/api/src/server.ts` denies before enqueue if the authenticated tenant/full request has no grant, and returns unavailable if no predicate was composed.
- The typed client posts the strict request to the dedicated route. CLI `artifact parse` and MCP `knowledge_parse_artifact` parse the same strict schema; the MCP adapter checks its bearer-bound tenant grant before calling the client.

## Focused verification

All commands were run with corepack pnpm 10.34.5 in `ai-engineer-knowledge-services` and exited 0.

| Command | Evidence |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/parse.test.ts` | 3 passed |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-parse.test.ts src/verification-service.test.ts` | 8 passed |
| `corepack pnpm --filter @aiengineer/knowledge-worker exec vitest run src/verification-parse-activity.test.ts` | 2 passed |
| `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-routes.test.ts` | 10 passed |
| `corepack pnpm --filter @aiengineer/knowledge-client exec vitest run src/client.test.ts` | 8 passed |
| `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run src/commands.test.ts` | 12 passed |
| `corepack pnpm --filter @aiengineer/knowledge-mcp exec vitest run src/verification-tools.test.ts` | 7 passed |

The application build/typecheck was not used as integration evidence: it was blocked during this review by an unrelated concurrent `verification-audit-inspection.ts:89` TS2366 reported by the dashboard agent. The focused application tests above passed.

## Source snapshot SHA-256

| File | SHA-256 |
| --- | --- |
| `packages/contracts/src/verification/parse.ts` | `FA313D190FEE23BDD220250A6BEA6CC23B64641F5EFBF00FE8A1A0B9EC74CD47` |
| `packages/application/src/verification-parse.ts` | `239EC04995C057A6DE4BEA38196126D14D64E5698221F57409279041D735B1F6` |
| `packages/application/src/verification-service.ts` | `4F4AA557626DD4702C28664FE8370F016199CA9FDBDD098E2047D1DC9DCC1D4F` |
| `apps/worker/src/verification-parse-activity.ts` | `B874A23BD62E48FC38AC1E9797B7C71FDDD41DD9E5C9D4F6386FC32862388232` |
| `apps/worker/src/index.ts` | `0F4BAF19BD787AE672A86AE5135851A9CC3C0FD46A4E2F4063F2EDDAD6543A01` |
| `apps/api/src/index.ts` | `9910BC3B798E77A27BFC25EB11775B91432103CA9CBF320014EF4AC8082F5052` |
| `apps/api/src/server.ts` | `DE868915CBCDA3D7BBF83D33570AB380902D5EF66807C2964307CB55B7CB1668` |
| `packages/client-typescript/src/client.ts` | `59D507382D3CE11DEC654ED7391201B92439489AE71218A4C92BF921B2C58F80` |
| `apps/cli/src/commands.ts` | `4DB4B183B8E014B658C647A4B4133BA115B0496B63A198A71A747C5C6FB096E6` |
| `apps/mcp/src/index.ts` | `A72C81399D5E3C075C2B330BC4D90EC6C53F3A044613EAB7E3D76120DE80D8AA` |

## Remaining proof required

Run configured native tests against PostgreSQL and object storage to prove lease expiry/cancellation cannot make the terminal artifact available, stale writers are rejected atomically, the parser runtime receives only the server-derived kind, idempotent retries reuse only exact terminal content, and capture-to-parse lineage survives recovery. The mock-focused checks cannot prove the SQL locking/fencing or sandbox/runtime behavior.

## OpenAPI and literal-route recheck (2026-09-07)

The contract generator now registers `ParseArtifactRequest` and `VerificationParseArtifactResult`, and emits the public `/v1/verification/artifacts:parse` operation with the strict request schema, accepted-operation response, and verification context headers. Its `x-fastify-route` is deliberately `/v1/verification/artifacts::parse`, which matches Fastify's literal-colon escaping and the server's registered route.

The API route test exercises the public literal suffix: `/v1/verification/artifacts:parse` is the admitted route, while `/v1/verification/artifacts-anything` and `/v1/verification/artifacts:other` return 404. It also retains unavailable/denied-before-enqueue and admitted operation-kind checks. Root's focused API receipt [`internal/verification-parse-openapi-routes-20260907.log`](../../../../../../internal/verification-parse-openapi-routes-20260907.log) records 2 files / 12 tests passing, exit 0. This is a source and focused-test recheck; it does not prove a deployed parser or native fencing.

| File | SHA-256 |
| --- | --- |
| `packages/contracts/scripts/generate-contract-artifacts.ts` | `31D2248326925303814274869D27458E0ED770BA57E806F3347CE76CA0876ABE` |
| `packages/contracts/generated/openapi.json` | `BB84A33A1196C6C04E5F57A06A97E8B5E54ECC2E09EB225AE8EDECE2748CB6D0` |
| `apps/api/src/server.ts` | `12DFE6E7C43F9C5130374A8BE86A120094DE6FF680B7AC2AD35F7CA894F14278` |
| `apps/api/src/verification-routes.test.ts` | `3CAF87797CE193AEF4671B32C9B15653F99576A29F6891080D62499C928696CE` |
