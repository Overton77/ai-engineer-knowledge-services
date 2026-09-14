---
name: knowledge-ingest
description: >-
  Use when verified facts must be written into the shared knowledge database: compose a
  knowledge-ingestion intent (entities, aliases, identifiers, relationships, two-clock facts,
  events, evidence support, staged candidates, reports) from a sealed knowledge-verify run and a
  knowledge-db snapshot, dry-run it, apply it through the deterministic executor, inspect the
  receipt, recover from stale-head or validation failures, and verify by re-reading. You never
  write to the database yourself; the executor does, as executor_service.
allowed-tools:
  - Bash(knowledge ingest *)
  - Bash(knowledge db *)
  - Bash(knowledge artifact *)
---

# knowledge-ingest — author intents, let the executor write

`knowledge ingest` forwards to the knowledge executor (`KNOWLEDGE_EXECUTOR_URL`). The executor
plans your intent (schema, vocabularies, rules, evidence, subjects, current head), then applies
the admitted proposals in one transaction as the only identity allowed to write canonical facts
(`temporal.begin_batch` → `assert_*` → `commit_batch`). Every apply produces an immutable receipt
whether it succeeds or fails. Failures are instructions.

## Preconditions (all three, or do not start)

- a **sealed** `knowledge-verify` run whose claims you will cite (`{ runId, claimId }`);
- a **snapshot** (`06-snapshot.json`) with `snapshotDigest` and `knowledgeHead.knowledgeSeq`;
- you have read the rules page (`knowledge schema get rules/README.md`) for the entity kinds you touch.

## The proposal rule (overrides every shortcut)

1. **Cite or stage.** Every fact/relationship/event proposal cites ≥ 1 `{ runId, claimId }` from a sealed run.
   Anything you cannot cite becomes `candidate.stage` with a `reason`, or is left out.
2. **Declare time twice.** Every fact has a `worldInterval` (`from` required) and a `temporalBasis`
   (`explicit` with an `extent` quoting the date; `observation_bounded` when the source only proves "true when captured").
   Knowledge time is handled by the executor.
3. **Reference the snapshot you read.** `inputSnapshot` and `expectedKnowledgeHead` come from `06-snapshot.json`. Do not hand-edit them.
4. **One `intentId` per logical change set.** Re-submitting the *same file* is safe and returns the same receipt (`duplicateOf`), even when two submissions run at the same time.
   Changing proposals under the same `intentId` is a new intent; prefer a `-v2` suffix.
5. **Use vocabulary codes exactly** (`streamKind`, `relationshipKind`, `eventKind`, `unit`, `aliasKind`, identifier `scheme`).
   `VOCABULARY_VIOLATION` names the field and the allowed values.
6. **Never include SQL, roles, or receipt ids** in an intent.

## Sequence

### Report packages alongside ingestion

Author `research-report.v1` and call `knowledge report register report.json` during research or after research from preserved inputs. Both modes use immutable revisions, reusable sections, exact block assertion ranges, run-qualified claim digests, evidence manifests and original-question coverage. Keep pending or conflicting findings explicit. `registration: sealed` means structural custody only; check `admission` separately and never publish it as verified knowledge on that basis.

On each related ingestion proposal, add `reportBinding: { reportVersionId, assertionKey? }` to preserve report-to-proposal-to-receipt lineage. The binding supplements the normal evidence references. Use `knowledge report get <reportVersionId>` to reconcile its section, evidence, coverage, artifact and ingestion links. Read the returned artifacts with `knowledge artifact get <artifactId>`. Local `storage_pending` is not remote durability. See the service's `docs/REPORTS.md` for the v1 contract.

| # | stage | command | quality gate (exit 0) | file |
|---|---|---|---|---|
| 1 | compose | write `80-ingestion-intent.json` (`knowledge-ingestion-intent.v1`) from `07-gaps.md` + sealed run + `06-snapshot.json` | file parses | `80-ingestion-intent.json` |
| 2 | plan (dry run) | `knowledge ingest plan 80-ingestion-intent.json --out 81-plan.json` | `plannedOutcome ≠ rejected`; every `review_required`/`held` is one you accept; read `rewrites` and `ruleChecks` | `81-plan.json` |
| 3 | apply | `knowledge ingest apply 80-ingestion-intent.json --out 82-receipt.json` | `outcome ∈ applied \| partial \| noop`; `knowledgeBatch.knowledgeSeq` present when applied/partial | `82-receipt.json` |
| 4 | duplicate check (when asked) | `knowledge ingest apply 80-ingestion-intent.json --out 82b-receipt.json` | `duplicateOf` = first `receiptId`; `head.after` unchanged | `82b-receipt.json` |
| 5 | read back | `knowledge db read-intent 05-read-intent.json --out 83-verify-snapshot.json`; run `verify.suggestedReadIntent` from the receipt | head advanced by your batch; created ids visible | `83-verify-snapshot.json` |
| 6 | summary | `knowledge ingest receipt <receiptId>` if you need it again | — | `90-ingest-summary.md` |

### 1. Compose

```json
{ "schemaVersion": "knowledge-ingestion-intent.v1", "intentId": "<topic>-<asof>",
  "context": { "tenantId": "<from db head>", "correlationId": "<run id>", "actor": { "kind": "agent", "id": "<you>" } },
  "inputSnapshot": { "snapshotId": "<06>", "snapshotDigest": "<06>", "knowledgeSeq": <06> },
  "expectedKnowledgeHead": <06.knowledgeHead.knowledgeSeq>, "onStale": "rebase_if_disjoint", "asOf": "<date>",
  "evidence": { "verificationRuns": [ { "runId": "<sealed run>" } ] },
  "subjects": [
    { "ref": "openai", "mode": "resolved", "entityId": "<from snapshot>", "kind": "organization" },
    { "ref": "offering", "mode": "new", "kind": "model_offering", "displayName": "…", "aliases": [], "identifiers": [],
      "typedPayload": { "model_version_id": "$subject:<ref>", "provider_entity_id": "<uuid>", "offering_key": "api" }, "onMatch": "review" } ],
  "proposals": [
    { "proposalId": "p-01", "kind": "fact.assert_state", "subjectRef": "offering", "streamKind": "model_offering_price",
      "worldInterval": { "from": "2026-08-20T00:00:00Z", "to": null, "bounds": "[)" }, "amount": 2.5, "currency": "USD", "unit": "per_1m_input_tokens",
      "temporalBasis": "explicit", "extent": { "sourceText": "August 20, 2026", "precision": "day", "earliest": "2026-08-20", "latest": "2026-08-20" },
      "belief": "accepted", "evidence": [ { "runId": "<run>", "claimId": "<claim>", "role": "primary" } ] } ] }
```

Choosing the proposal kind:

| you want to say | kind | notes |
|---|---|---|
| "X exists and is a <kind>" | subject `mode: new` (the executor synthesizes `entity.create`) | `typedPayload` keys must be columns of `corpus.<kind>`; `onMatch: review` unless you are sure it is new |
| "X is also called Y" / "X has id Y in scheme S" | `entity.alias` / `entity.identifier` | idempotent |
| "A <rel> B [since/until]" | `relationship.assert` | `worldInterval` required for temporal kinds |
| "X's <stream> is/was V [from D]" | `fact.assert_state` | prices: rule `price.scope_key_is_unit` reuses the key of the subject's existing series for that unit (older data uses `input_tokens`), else defaults `scopeKey` to the unit; a `scopeKey` you give that names another key is rewritten (`reason: existing_series_reused`) |
| "On D, X <event>" | `event.assert` | `occurredDuring` + `precision` |
| "This quote also supports that fact" | `support.admit` | needs `locatorId` and a materialized claim |
| "Record these claims as evidence rows" | `claim.materialize` (+ `evidence.claims[]` text) | needs `context.attemptId`; otherwise `held: attempt_required` |
| "Observe metric M = v" | `metric.observe` | needs `metricDefinitionVersionId` |
| "I found X but cannot resolve/place it" | `candidate.stage` | no evidence needed; give `reason` |
| "Publish this report" | `report.publish` with `markdown` | stored as artifact `knowledge_report_markdown` + `research.report_version` |

### 2. Plan

`plan` writes nothing. Per proposal: `outcome` (`admitted`, `no_op_duplicate`, `review_required`, `held`, `rejected`),
`rewrites` (rules the executor applied), `actions` (the helper calls it will make). `head.rebased: true` means your
snapshot was stale but no touched slot changed, so the executor will use the current head. `errors[]` non-empty ⇒ exit 1 and `apply` refuses.
A price correction lands in the existing series: a rewrite with `reason: existing_series_reused` means the executor will
supersede the current segment under that `scope_key` instead of opening a parallel series beside the stale one.

### 3. Apply and recover

| code | what happened | do |
|---|---|---|
| `REBASE_REQUIRED` | head advanced and a proposal touches a changed slot (`details.whatChanged`, `touchedBy`), or `onStale: fail` | re-run the read intent, compare, adjust or drop touched proposals, update `inputSnapshot`/`expectedKnowledgeHead`, resubmit as `…-v2` |
| `VOCABULARY_VIOLATION` / `RULE_VIOLATION` | a code, unit, status, or currency is not allowed; `details.allowed` lists values | fix the field; if none fits, `candidate.stage` |
| `EVIDENCE_NOT_ELIGIBLE` | run not sealed or claim not in the run | back to `knowledge-verify` (judge/policy/seal), then resubmit |
| `SUBJECT_MERGED` / `SUBJECT_UNKNOWN` / `SUBJECT_MATCH_EXISTS` | entity merged, missing, or already exists | use `details.mergedInto` / the match; re-snapshot |
| `REVIEW_REQUIRED_ONLY` | nothing admissible | report it; do not force |
| `BATCH_OPEN` / `DB_UNAVAILABLE` | transient | the executor already retried; wait and `apply` again (idempotent) |
| `DUPLICATE_PENDING` | the same intent was submitted in parallel and the winning submission had no receipt within 30 s (`details.intentId`) | wait, then `apply` again: it returns the winner's receipt as `duplicateOf` |

A rejected apply still has a receipt (`outcome: rejected`, `failure.code`); record its `receiptId`.

### 5–6. Verify and summarize

`90-ingest-summary.md`: intentId(s), idempotencyKey, receiptId(s) with outcomes, head before → after, per-proposal outcomes and
created ids, duplicate check result, what `entity.what_changed` reported, rejected attempts and why, files written.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| 0 | success — includes `duplicateOf`, `partial`, `noop`, and rebased applies | read `outcome` and `proposals[].outcome` |
| 1 | quality gate failed (`INTENT_SCHEMA_INVALID`, `EVIDENCE_NOT_ELIGIBLE`, `VOCABULARY_VIOLATION`, `RULE_VIOLATION`, `REBASE_REQUIRED`, `SUBJECT_*`, `REVIEW_REQUIRED_ONLY`, `DUPLICATE_PENDING`, plan rejected) | fix per the table and re-run from `plan` |
| 2 | usage / network / executor (`WORKSPACE_STALE`, `HEAD_MISMATCH`, `DB_UNAVAILABLE`, `ROLE_DENIED`) | stop and report |

## MCP equivalents

`ingest_plan`, `ingest_apply`, `ingest_receipt`, `artifact_get` on the executor's `/mcp`.
