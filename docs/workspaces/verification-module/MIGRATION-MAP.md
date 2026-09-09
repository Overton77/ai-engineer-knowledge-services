# Verification Migration Map

This map prevents the new Knowledge Services module from becoming a second, divergent implementation. “Port” means preserve behavior with parity fixtures first, then harden behind the target contract. “Reference” means retain as research or test input, not runtime ownership.

## Source-to-target map

| Existing asset | Disposition | Authoritative target | Owning stream | Required proof before retirement |
|---|---|---|---|---|
| `research_ingestion_systems_agent/packages/contracts/src/verification.ts` | port and reconcile | `packages/contracts/src/verification/**` | WS-01 | Golden serialization, DB-taxonomy mapping, compatibility tests |
| `research_ingestion_systems_agent/packages/verification-core/src/index.ts` | port, split, harden | `packages/verification/src/**` | WS-02 | Prototype parity plus adversarial deterministic suite |
| `research_ingestion_systems_agent/packages/verification-core/src/index.test.ts` | port and expand | `packages/verification/test/**` | WS-02 | Same fixtures pass; new monotonic-failure and selector tests pass |
| `research_ingestion_systems_agent/agents/verification/**` | decompose | application use cases, policy, worker handlers, and thin skills | WS-05/08 | No business algorithm remains in an agent prompt or skill |
| `research_ingestion_systems_agent/experiments/interfaze-lab/**` | port as provider/eval fixtures | provider adapter under extraction plus benchmark fixtures | WS-06/07 | Raw bytes/precontext retained, selectors emitted, common conformance passes |
| `research_ingestion_systems_agent/INTERFAZE_EXPERIMENT_DESIGN.md` | reference and supersede | specification §§13 and 15 plus a frozen experiment definition | WS-06/07 | Paired internal pilot report with uncertainty and failure analysis |
| `research_ingestion_systems_agent/VERIFICATION_SYSTEM_TECHNICAL_DECISIONS.md` | reconcile | accepted Knowledge Services ADRs and `DECISIONS.md` | WS-00 | Every conflicting decision explicitly accepted, changed, or rejected |
| `ai-engineer-db-contract/supabase/migrations/*verification*` and related evidence migrations | stabilize in place | canonical DB-contract migrations and generated types | WS-03 | Reviewed migration chain, RLS/constraint tests, pinned revision |
| `ai-engineer-cloud-bucket` verification object conventions | formalize | canonical bucket/policy migration plus artifact mapper | WS-03/09 | Authorization, retention, quarantine, checksum, and orphan tests |
| Cursor Cloud `verify_extraction` work item and direct verifier calls | replace incrementally | versioned Knowledge Services HTTP/client/CLI operation | WS-10 | Cross-repository fixture preserves orchestration IDs and semantics |
| EVE verification or extraction tools | author as bounded consumers | generated client/API or CLI/MCP facade | WS-10 | Framework conformance fixture; no copied verification logic |
| `ai-engineer-mission-control` status scaffold | extend | durable operation dispatch and receipt reconciliation | WS-10 | Temporal replay, cancellation, duplicate, retry, and worker-loss tests |
| `agents_dashboard` read feature patterns | extend | verification experiment feature slice | WS-11 | API-backed drilldown and access/redaction browser tests |

## Migration order

1. Preserve the current repositories and pin a baseline revision or archive digest.
2. Freeze prototype fixtures before changing contracts.
3. Reconcile assertion/claim/verdict vocabulary with the database contract.
4. Port the deterministic core and prove parity without network dependencies.
5. Stabilize provenance persistence and immutable object registration.
6. Port extractors and Interfaze only through canonical provider interfaces.
7. Build the benchmark harness and seal the pilot dataset.
8. Expose one application use case through HTTP, client, CLI, MCP, and worker parity tests.
9. Migrate Cursor and EVE callers; keep old paths in shadow comparison until equivalence is demonstrated.
10. Add dashboard reads, then durable controls; retire duplicated runtime paths only after audit.

## Retirement rule

No source implementation is deleted merely because a target file exists. Retirement requires its acceptance evidence, a replayable comparison artifact, a named approver, and a rollback plan. Historical experiment inputs remain immutable even after runtime code is retired.


EV-092: local 20260906032700_verification_provider_reconciliation_artifact.sql adds dedicated operator-signed accounting decision artifact type only. Applied locally; database-contract0.2.27 vendor/installed190-file parity verified. No remote application, reconciliation ledger or settlement bypass yet.


EV-093: local20260906032800 adds provider reconciliation ledger, handle matching/native guards/atomic apply;329 permits only ledger-authorized settlement without a response while preserving ordinary guards. Applied locally only. DBcontract0.2.28 installed/vendor/canonical192-file parity and five installed SQL bodies verified. Remote unchanged.


EV-094: local20260906033000_verification_provider_reconciliation_success.sql expands the existing terminal reconciliation guard to succeeded operations; all other guards preserved. Database-contract0.2.29 canonical/vendor/installed193-file parity and five installed SQL bodies verified. Local only; remote unchanged.

2026-09-07 runtime-principal artifact registration: canonical20260907013100_verification_runtime_principal_binding_artifact_type.sql applied locally via canonical Supabase runner;140migrations. Data-only artifact catalog insertion, no table/column changes or generated-type rewrite. MigrationSHAf41ce6f1adef662b5be9b96eec83ed114a9ed44ea636375c75fd7f539736f6e4. DBcontract0.2.35 packed/installed offline, tarballSHAaa878b5a7c1630dda351fd20afd91826c50d8933be35981e6b65de4a27e63a37; installedSQL hash matches canonical. Existing generatedtypes diff preserved. Root proof now requires exact catalog code/description before any dispatch.
