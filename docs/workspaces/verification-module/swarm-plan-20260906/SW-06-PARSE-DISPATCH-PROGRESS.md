# SW-06 parseArtifact Mission Control dispatch progress

Updated 2026-09-07. Scope: immutable SDK snapshot, MC parse dispatch, API grant vocabulary, and dashboard shape gate only.

## Immutable SDK snapshot

- Packed the current built KS contracts and typed client with `corepack pnpm pack --pack-destination` into MC `internal/parse-sdk-20260907/`.
- Copied byte-identical tarballs into MC vendor as `knowledge-contracts-0.1.0-verification-parse-20260907.tgz` (`529007A81B682D88EFAB5BA1297B35A148FD3B854FFBF8BC52F4FB3CA63FDF8C`) and `knowledge-client-0.1.0-verification-parse-20260907.tgz` (`776EE04E030D4C77306B32DBD845BBE01AB74889D631E9E2E477B76F30213BC7`).
- Preserved the EV103 tarballs. Updated only the root contracts override and kernel/worker direct dependencies, then ran `corepack pnpm install --ignore-scripts` successfully.

## Implemented MC boundary

- `parseArtifact` uses the published strict `ParseArtifactRequestSchema` and typed `KnowledgeClient.parseArtifact`; raw bytes, parser controls, and partial handles are rejected before Temporal history.
- Its expected KS kind is `verification_parse_artifact` and terminal receipt is `parse_and_admit.succeeded`. The kernel accepts success only when the strict parse-result schema binds operation ID, request digest, full source handle, capture ID on every projection, tenant on every output, and result-artifact ancestry for source/native/projection/transformation handles.
- A validated parse terminal is `completed_without_admission`; it never means policy admission. API principal grants and the dashboard operation list include `parseArtifact`. The dashboard requires a complete immutable source handle.

## Focused validation

| Command | Exit | Evidence |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-kernel typecheck` | 0 | Published parse contract/client types compile in the kernel. |
| `corepack pnpm --filter @aiengineer/mission-kernel build` | 0 | Updated kernel distribution consumed by worker tests. |
| `corepack pnpm --filter @aiengineer/mission-worker typecheck` | 0 | Worker dispatch adapter sees parse client and operation kind. |
| `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` | 0 | 25 tests, including strict terminal source/capture/tenant/ancestry acceptance and rejection. |
| `corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/launch-shape.test.ts` | 0 | 3 dashboard full-handle shape tests. |
| `corepack pnpm --filter @aiengineer/mission-api exec vitest run src/runtime.test.ts` | 0 | 5 API-runtime grant parsing tests, including explicit parseArtifact grant. |
| `corepack pnpm --filter @aiengineer/mission-api typecheck; corepack pnpm --filter @aiengineer/mission-dashboard typecheck` | 0 | API grant enum and dashboard launch gate compile. |
| `corepack pnpm --filter @aiengineer/mission-dashboard build` | 0 | Next production build completed. |

No Temporal, knowledge API, provider, database, or storage call was made. This is source and isolated test evidence only.

## Review hardening, 2026-09-07

- Terminal parse custody now compares the `resultArtifact.parentArtifactIds` unordered set exactly with the unique source/native/projection/transformation closure. Extra parent IDs, duplicated IDs, and missing IDs resolve to `reconciliation_unresolved`.
- The kernel rejects a parse launch when `sourceArtifact.tenantId` differs from the dispatch context before any client/Temporal submission. The dashboard first validates the complete handle then applies the same tenant scope rule. Terminal verification also binds the receipt source tenant to the dispatch context.
- Terminal verification requires distinct projection ordinals and distinct artifact IDs across the source and every native/projection/transformation role. Duplicate ordinal and duplicate role adversarial receipts resolve to `reconciliation_unresolved`.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-kernel typecheck` | 0 | Exact ancestry and tenant/role checks typecheck. |
| `corepack pnpm --filter @aiengineer/mission-kernel build` | 0 | Worker test consumes the hardened kernel distribution. |
| `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` | 0 | 25 tests, including extra-parent, cross-tenant launch, duplicate ordinal, and duplicate role receipts. |
| `corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/launch-shape.test.ts` | 0 | 3 tests, including a cross-tenant complete-handle rejection. |
| `corepack pnpm --filter @aiengineer/mission-dashboard typecheck` | 0 | Dashboard tenant-bound parse launch gate compiles. |

The KS OpenAPI generator was updated independently after the first SDK snapshot. Per coordinator instruction, the contracts tarball will be refreshed as parse-r2; no MC install or broad MC check was run during the KS serial verification window.

## Shared-native PDF correction, 2026-09-07

The initial role-uniqueness rule was corrected after checking the actual KS `VerificationAdmissionService`: canonical PDF text and geometry receipts reuse one full native-output artifact. The terminal boundary now requires every projection to carry that exact full native handle, while ordinals, source/projection/transformation role IDs remain distinct. Result ancestry is the exact deduplicated closure: source, shared native, and each projection/transformation artifact. A two-projection `pdf_text`/`geometry` fixture with the shared native succeeds; a changed second native handle, duplicate ordinal, missing/extra ancestry, and duplicate role all resolve to reconciliation rather than completion.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-kernel typecheck` | 0 | Shared-native terminal rule compiles. |
| `corepack pnpm --filter @aiengineer/mission-kernel build` | 0 | Worker test consumes the corrected distribution. |
| `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` | 0 | 25 tests, including accepted two-projection PDF and rejected changed-native receipt. |

## Result identity closure, 2026-09-07

Terminal verification also rejects a result artifact whose ID collides with any source/native/projection/transformation parent or occurs in its own parent list. The hostile self-parent/source-role collision fixture resolves to `reconciliation_unresolved`.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-kernel typecheck` | 0 | Result identity exclusion compiles. |
| `corepack pnpm --filter @aiengineer/mission-kernel build` | 0 | Hardened distribution built for the worker suite. |
| `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` | 0 | 25/25 focused tests, including the self-parent collision rejection. |
