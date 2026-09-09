# SW-06 parseArtifact Mission Control dispatch independent review

Read-only review completed 2026-09-07 against the MC parse SDK snapshot, kernel dispatch, API grant enum, and dashboard shape gate.

## Findings

### P1 — Terminal parse ancestry is checked as a superset, not the exact canonical closure

The parser terminal result is accepted when `resultArtifact.parentArtifactIds` contains the source plus every native-output, projection, and transformation ID. It does not reject additional parent IDs. The KS parse application creates exactly the unique closure of those parents, so a terminal receipt with broadened or unrelated custody ancestry can be reported by MC as `completed_without_admission`.

Location: `ai-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts:532-533`.

Compare the sorted unique result parent IDs exactly against the sorted unique expected set, and add a forged extra-parent fixture. The existing test exercises only a missing-parent case.

### P2 — Launch accepts a source handle for another tenant

The dashboard full-handle schema and MC strict request schema accept a parse request whose `sourceArtifact.tenantId` differs from the request context/dashboard tenant. The terminal receipt check prevents a successful completed result in this state and KS admission is expected to deny it, but MC still records and forwards a request that violates its own scope.

Locations: `apps/dashboard/src/server/launch-shape.ts:12-27`; `packages/mission-kernel/src/verification-dispatch.ts:308-309`.

Reject before workflow history/enqueue unless `request.sourceArtifact.tenantId === context.tenantId`, and test the dashboard and kernel launch boundaries.

### P2 — Projection identity/ordinal uniqueness is not asserted at terminal observation

The strict result schema bounds projection count but terminal observation does not require distinct projection ordinals or distinct native/projection/transformation IDs. A duplicated projection record can satisfy the current capture/full-handle/tenant checks and parent superset test.

Location: `packages/mission-kernel/src/verification-dispatch.ts:529-533`.

Require the expected canonical ordinal set and distinct artifact IDs/roles before returning `completed_without_admission`; add duplicate-ordinal and duplicate-artifact mutation tests.

## Confirmed boundaries

- The immutable contracts/client tarballs are pinned consistently in the root override plus direct kernel/worker dependencies. Their SHA-256 values match the SW-06 ledger: contracts `529007A81B682D88EFAB5BA1297B35A148FD3B854FFBF8BC52F4FB3CA63FDF8C`; client `776EE04E030D4C77306B32DBD845BBE01AB74889D631E9E2E477B76F30213BC7`.
- `ParseArtifactRequestSchema` is strict and requires a complete artifact handle. The dashboard repeats the full-handle shape gate; parser controls and raw bytes cannot enter workflow history.
- Operation/status correlation binds operation ID, tenant, mission, work item, attempt, expected operation kind, expected terminal receipt kind, strict result operation ID, request digest, source handle, capture ID, and output artifact tenants.
- A valid parse terminal maps to `completed_without_admission`, never policy admission.
- API bearer grants include `parseArtifact` only when explicitly configured.

## Focused verification

| Command | Exit | Result |
| --- | ---: | --- |
| `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` | 0 | 25 passed |

This passing suite does not cover the three mutations above. No broad MC check, Temporal, knowledge API, provider, database, or storage call was made.

## Source snapshot SHA-256

| File | SHA-256 |
| --- | --- |
| `vendor/knowledge-contracts-0.1.0-verification-parse-20260907.tgz` | `529007A81B682D88EFAB5BA1297B35A148FD3B854FFBF8BC52F4FB3CA63FDF8C` |
| `vendor/knowledge-client-0.1.0-verification-parse-20260907.tgz` | `776EE04E030D4C77306B32DBD845BBE01AB74889D631E9E2E477B76F30213BC7` |
| `packages/mission-kernel/src/verification-dispatch.ts` | `E2BADADB01CEB65FFD82BAAA5D408E8AACDA7F2DCA31ADA6DB3ADD6AE1C6F9D6` |
| `apps/worker/src/verification-dispatch.test.ts` | `87CB37CEFDF5F69C99F32E3F3060DEDB94A9369C1C11BCB1D836C46108C5A75E` |
| `apps/api/src/runtime.ts` | `49F4C439B5896DE5A0B32A76C49DAA6DB820FE437A97974334BAE3C833127FEC` |
| `apps/dashboard/src/server/launch-shape.ts` | `CDA40F073110EC924633E00CB45E3A9D8339ED71A18F1110B20840489C04CB8D` |

## Remediation recheck (2026-09-07)

The dashboard owner resolved all three findings in the final snapshot.

- Terminal validation now derives the expected unique parent set and requires equal cardinality, no duplicate actual parents, and membership of every expected source/native/projection/transformation ID. Extra ancestry fails closed.
- Kernel launch validation rejects a parse request whose source-handle tenant differs from context; the dashboard applies the same scope check.
- Terminal validation requires distinct projection ordinals and distinct source/native/projection/transformation artifact role IDs. The worker fixture adds forged extra-parent, cross-tenant, duplicate-ordinal, and duplicate-role cases.

Independent recheck commands exited 0:

| Command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/mission-worker exec vitest run src/verification-dispatch.test.ts` | 25 passed |
| `corepack pnpm --filter @aiengineer/mission-dashboard exec vitest run src/server/launch-shape.test.ts` | 3 passed |

Updated hashes: kernel `EE2FC88CD44E8EE7AE89EC9651B36906EFE0628976E347EB10572801C5E73549`; worker test `9757EE1F079C3B2E91228E515E31AC2CAB6D22CBDFDCE868D86254D5B3C3B0CE`; dashboard gate `BEA1B1A84AA16D3E704098CAD5B68709071D7999096615FA8E1004ACD7213900`; dashboard test `B954127299F04BA3599129283115C8EE14D7D069437E97B0A8F3D6C36E66F7E6`.

## Shared-native projection recheck (2026-09-07)

The prior global native-output role-ID uniqueness defect is corrected. Parse terminal validation now requires each receipt to carry the same complete native-output handle, while projection ordinals remain unique and the source/native/projection/transformation parent closure is deduplicated and exact. The focused fixture accepts a genuine two-receipt PDF text plus geometry result sharing one native output; it rejects changed native output, duplicate ordinal, and projection-role collision. Dashboard-reported focused evidence: mission-kernel typecheck/build and worker dispatch 25/25 pass.

### P1 — terminal result artifact may be its own parent or a role parent

The terminal check does not require `resultArtifact.artifactId` to differ from the source/native/projection/transformation IDs or to be absent from `resultArtifact.parentArtifactIds`. A forged receipt can reuse a parent role ID for the result and include itself in its own ancestry while satisfying the current expected-parent set. Reject a result artifact ID that appears in the expected/actual parent closure and add a hostile receipt test before treating receipt ancestry as closed.

Snapshot: `ai-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts` SHA-256 `05AD95B88A162C3F663CEF80ACF6F53BD2736BCB8882E603D05FBF297BAD6BC2`; `ai-engineer-mission-control/apps/worker/src/verification-dispatch.test.ts` SHA-256 `149D79E94BC493D2BF667C7861D388C40993A50CE5AEB7B17E14682A942354F4`.

## Final terminal-identity recheck (2026-09-07)

The remaining P1 is fixed. The predicate now rejects a terminal `resultArtifact` whose ID appears in the expected role-parent closure or in its declared parent list. The hostile source-role/self-parent fixture resolves to `reconciliation_unresolved`. Together with the prior exact full-native-handle, unique-ordinal, distinct source/native/projection/transformation role, and exact deduplicated ancestry checks, no receipt false-admission path was found in this bounded parse terminal predicate.

Dashboard-reported focused evidence remains mission-kernel typecheck/build and worker dispatch 25/25, all passing. Rechecked source hashes: `packages/mission-kernel/src/verification-dispatch.ts` `7252A3C85A9DD6C64C488206574ED3E68C0D1BBA438DA60F8BAD3BD90F0123DB`; `apps/worker/src/verification-dispatch.test.ts` `33EB186518EE9F45F1D6263669C2375B9FB685446BC15CFD236174B36252E4BD`.
