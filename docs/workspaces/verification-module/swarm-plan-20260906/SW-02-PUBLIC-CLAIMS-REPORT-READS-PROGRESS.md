# SW-02 public claims/report terminal reads progress

## 2026-09-07 completed bounded source slice

Implemented authenticated typed terminal reads for native `verifyClaims` and `verifyReport` operations across contracts, application, persistence, HTTP, TypeScript client, CLI, MCP, and generated OpenAPI. The public resources expose an allowlisted deterministic summary, immutable result and signed manifest references, policy outcome, and, for reports, count-only report-wide gates with `coverageScope: producer_declared_assertions_only`. They expose no object paths, complete artifact handles, raw bundles, selector resolutions, individual report assertion/group identifiers, provider payloads, or signing material.

The persistence boundary validates the durable operation/request/step/receipt/success-event chain, canonical hashes and fencing, the complete registered result artifact, exact signed audit bundle and signature, the authoritative native `evidence.verification_run`, capture/source/assertion/report/ledger closure, and the exact report gate before it constructs the public projection. The API runtime obtains signature keys, Storage coordinates, and mission ownership grants only from server configuration. A request actor and tenant must pass the configured ownership authorizer before artifact hydration. Routes parse the returned family-specific schema before sending it and map missing, pending, failed, cancelled, and integrity states without returning partial result bodies.

Public routes and adapters:

- `GET /v1/verification/claims/{operationId}` / client `getVerificationClaimsResult` / CLI `verify claims-result` / MCP `knowledge_get_verification_claims_result`
- `GET /v1/verification/reports/{operationId}` / client `getVerificationReportResult` / CLI `verify report-result` / MCP `knowledge_get_verification_report_result`

Runtime configuration requires `VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON`, `VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`; `VERIFICATION_STORAGE_BUCKET` remains the optional canonical bucket override. Missing trust leaves the capability unavailable. Partial trust configuration fails startup.

No artifact vocabulary or database migration was needed for this read surface. It verifies the existing signed result, manifest, and `verification_report_result` gate registrations and creates no operation, receipt, artifact, or Storage object.

## Focused verification

All commands used Corepack pnpm 10.34.5 and exited `0` unless explicitly described:

- `corepack pnpm --filter @aiengineer/knowledge-contracts build`
- `corepack pnpm --filter @aiengineer/knowledge-application build`
- `corepack pnpm --filter @aiengineer/knowledge-persistence build`
- `corepack pnpm --filter @aiengineer/knowledge-client build`
- `corepack pnpm --filter @aiengineer/knowledge-api typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-client typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-cli typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-mcp typecheck`
- `corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/claims-report-reads.test.ts` — 1/1
- `corepack pnpm --filter @aiengineer/knowledge-client exec vitest run src/claims-report-reads.test.ts` — 2/2
- `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run src/commands.test.ts` — 14/14
- `corepack pnpm --filter @aiengineer/knowledge-mcp exec vitest run src/verification-tools.test.ts` — 10/10
- `corepack pnpm --filter @aiengineer/knowledge-api exec vitest run src/verification-claims-report-reads-routes.test.ts src/verification-claims-report-reads-runtime.test.ts` — 4/4
- `corepack pnpm exec tsc -p scripts/tsconfig.verification-claims-report-read-transports.json`
- `corepack pnpm --filter @aiengineer/knowledge-api build`
- `corepack pnpm --filter @aiengineer/knowledge-cli build`
- `corepack pnpm --filter @aiengineer/knowledge-mcp build`

One first native transport-proof attempt exited `1` before any application read because the diagnostic count referenced nonexistent `evidence.artifact_registry`; the canonical table is `orchestration.artifact`. A second attempt exited `1` before serving HTTP because it correctly found that the retained claims and report operations have distinct authenticated producer actors. The proof was corrected to create separate server-authenticated identities and ownership grants for the two retained operations. Both failures occurred under PostgreSQL `default_transaction_read_only=on`, wrote no database or Storage state, and produced no success receipt.

## Read-only native public proof

`corepack pnpm exec tsx scripts/prove-verification-claims-report-read-transports.ts ../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json ../internal/verification-claims-report-read-transports-20260907-r1.json` exited `0`.

Immutable receipt: `../internal/verification-claims-report-read-transports-20260907-r1.json`, SHA-256 `e1a3f456a536819386c43eb8a0534f1563a9fa8aad30b143b444a9ed48b8924d`.

Its eleven controls prove exact claims and report parity across raw loopback HTTP, the strict TypeScript client, CLI dispatcher, and MCP read adapter against retained native signed rows and Storage objects. It also rejects an invalid bearer, a missing operation, a claims operation requested through the report family, a different authenticated tenant, and an authenticated actor absent from server ownership grants. PostgreSQL enforced `default_transaction_read_only=on`; before/after tenant operation and artifact counts were identical. Parser and provider dispatch counts were zero.

## Frozen source hashes

| File | SHA-256 |
| --- | --- |
| `packages/contracts/src/verification/claims-report-reads.ts` | `da6373b138e2be375d60e3285dece2675e3ea36cc263d9b93ce805afb9e96c47` |
| `packages/contracts/scripts/generate-contract-artifacts.ts` | `93e2b278f7c02935a5d143e13a39c11c7f2b81a452d43a012d54ced53a97ab5e` |
| `packages/contracts/generated/openapi.json` | `6d7045cfae20c7ce9a9fc3698c16147e6ceaad57faa2528ce923440f0b4e170b` |
| `packages/application/src/verification-claims-report-reads.ts` | `cba47832704fb24a37cf1b94b1b5dd313320b17154b5a58eeb8513f6406bb1bf` |
| `packages/persistence/src/verification-claims-report-reads.ts` | `3d68432068bb1ae145f3d409c69d6093b79e01b8bfc0cf26577826eab85037cf` |
| `apps/api/src/verification-claims-report-reads-runtime.ts` | `76688438f4872e8d961010354a02ca84d6c392359aa837e8438511c83586cba7` |
| `apps/api/src/server.ts` | `a77d6ea768655cc1c3ba4cff7ce5a44eadaf00666ae8b2f7cd59a39a5fb4eded` |
| `apps/api/src/index.ts` | `88ca716399be470b6985585d1ffb5601c7227c410e3d9de4313447ba76f4b7af` |
| `packages/client-typescript/src/client.ts` | `8296be8adbc780f9effa0061c88033e530e5e2c9a377e745f005fcc9b5ec763d` |
| `apps/cli/src/commands.ts` | `17e17fc6fcf49f6372c742c0605d47336e463e31ddee6729f18457a9ef3017cc` |
| `apps/mcp/src/index.ts` | `56f7ecbc8dbbc0a7c7342bb60a0f53560897e2521eaa725f8b4496a36da8b6d3` |
| `scripts/prove-verification-claims-report-read-transports.ts` | `7a278c7f6d4a24b9cfaa2e8f20467b522cdf4308bf937893c4101bf432d1e48c` |

The product and proof source above is frozen pending independent review and the coordinator-owned full serial workspace verification. Public audit inspection source remains unchanged from EV111/EV112.

## Independent review

`SW-02-CLAIMS-REPORT-PUBLIC-READS-REVIEW.md` records no actionable P1/P2 finding in the frozen bounded surface. The reviewer independently ran the same read-only proof against the retained signed claims/report operations: exit `0`, all 11 controls passed, parser/provider dispatches remained zero, and native operation/artifact counts were unchanged. Independent immutable receipt: `../internal/verification-claims-report-read-transports-independent-20260907-r1.json`, SHA-256 `a6219798a866eda8715e8cd482dc4fdeaec5375feb3dfae82782589954f0e2e3`.
