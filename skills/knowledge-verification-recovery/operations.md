# Recovery operations — implemented catalog

Every row below is an operation of the verification executor's registry
(`apps/verification-executor/src/knowledge/recovery-host-operations.ts`). One definition feeds three
surfaces: the CLI subcommand, `POST /knowledge/<operation>` and the MCP tool of the same name.
Nothing else is a recovery endpoint; a contract name such as `verification-recovery-plan.v1` is a
schema, not a command. `node skills/check.mjs` fails when this file drifts from the catalog.

CLI conventions: positionals are consumed in order; `--kebab-flags` become camelCase input fields
and parse as JSON when they can; the flags marked *(file)* take a path whose JSON becomes the field.
Add `--out <file>` to write the JSON document and print a compact summary, `--remote <url>` /
`--token` to drive a running executor instead of a local one.

| Operation / MCP tool | CLI | Input fields |
|---|---|---|
| `recovery_status` | `knowledge recovery status` | — |
| `recovery_submit` | `knowledge recovery submit <runId>` | `runId` (uuid) |
| `recovery_observe` | `knowledge recovery observe <runId>` | `runId` (uuid) |
| `recovery_read` | `knowledge recovery read <caseId>` | `caseId` |
| `recovery_probe` | `knowledge recovery probe <representatives.json> --case-id <id> --dependency-id <id> [--control-id <id>]` | `caseId`, `dependencyId`, `representatives[]` *(file)*, `controlId?` |
| `recovery_plan` | `knowledge recovery plan <actions.json> --case-id <id> --expected-revision <n> --probes <probes.json> --reservation <reservation.json>` | `caseId`, `expectedRevision`, `actions[]` *(file)*, `probes[]` *(file)*, `reservation` *(file)* |
| `recovery_claim` | `knowledge recovery claim <caseId> <planDigest> [--lease-ms 30000]` | `caseId`, `planDigest` (`sha256:…`), `leaseMs` 1000–300000 |
| `recovery_execute` | `knowledge recovery execute <claim.json> --original-id <id> --reservation <reservation.json>` | `claim` *(file)*, `originalId`, `reservation` *(file)* |
| `recovery_reconcile` | `knowledge recovery reconcile <caseId> <planDigest>` | `caseId`, `planDigest` |
| `recovery_wait` | `knowledge recovery wait <caseId> <checkpointId> --expected-revision <n> --reason "<text>"` | `caseId`, `expectedRevision`, `checkpointId` (uuid), `reason` |
| `recovery_resume` | `knowledge recovery resume <authority.json> --case-id <id> --expected-revision <n>` | `caseId`, `expectedRevision`, `authorityArtifact` *(file)* |

## Operations recovery uses but does not own

| Purpose | Operation | CLI |
|---|---|---|
| Read retained capture bytes before repairing a selector | `verify_read_capture` | executor HTTP/MCP only |
| Read or register a diagnostic artifact | `verify_get_artifact`, `verify_register_artifact` | executor HTTP/MCP only |
| Read a ledger artifact by id | `artifact_get` | `knowledge artifact get <artifactId>` |
| Preserve an external provider attempt / lead decisions | `source_import`, `source_select` | `knowledge source import <receipt.json>`, `knowledge source select <request.json>` |
| Re-assess a report after repaired claims | `report_assess` | `knowledge report assess <reportVersionId>` |
| Rebind report citations and canonical links | `content_link_plan`, `content_link_apply` | `knowledge content plan <intent.json>`, `knowledge content apply <intent.json>` |
| Checkpoint a wait | `checkpoint_commit`, `checkpoint_head`, `checkpoint_read`, `checkpoint_restore` | `knowledge checkpoint commit <request.json>`, `knowledge checkpoint head <scope.json>`, `knowledge checkpoint read <request.json>`, `knowledge checkpoint restore <request.json>` |
| Escalate a held item (platform distribution) | `knowledge_request_adjudication`, `knowledge_get_adjudication` | `knowledge adjudication request …`, `knowledge adjudication get …` |

## MCP

The executor's `/mcp` registers every operation above under its own name with the same input object,
for example `recovery_read` `{ "caseId": "…" }`. Adjudication tools are on the platform MCP server.
There is no recovery tool that closes, cancels or admits a case: `recovery_close`, `recovery_cancel`
and `recovery_admit` do not exist, and a case reaches `complete` through reconciled canonical
results only.

## Configuration the host owns

`KNOWLEDGE_RECOVERY_CONFIG_JSON` plus `KNOWLEDGE_ARTIFACT_STORAGE=supabase` enable the recovery host;
without them the operations answer `RECOVERY_HOST_NOT_CONFIGURED` or
`RECOVERY_HOST_REMOTE_CUSTODY_REQUIRED` (exit 2). Original questions, requirements, limits, budgets
and verdicts come from that configuration and from canonical records — never from a request field.
