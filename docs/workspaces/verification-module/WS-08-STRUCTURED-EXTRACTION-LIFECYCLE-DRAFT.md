# WS-08 structured extraction candidate lifecycle draft

Updated 2026-09-06 UTC. This active draft owns the bounded durable checkpoint
between canonical structured-extraction dispatch and final result publication.
It does not authorize step or operation success; migration 315's terminal guard
remains unchanged.

## Intended boundary

The lifecycle is initialized before provider dispatch from a live
`extract_and_register` lease. Its immutable identity binds the canonical
operation and step request digest, operation producer attempt, capture/source
projection chain, registered producer profile and extraction schema, prompt,
and schema digest. Database timestamps use UTC millisecond precision so the
retention timestamp can be used unchanged as the candidate builder's
`createdAt`.

After a canonical provider response capture exists, `beginRetention` attaches
that exact operation-bound capture and original dispatch fence while the same
step is live. `completeRetention` accepts only the application builder's
unchanged `RetainedStructuredExtractionCandidate`, verifies its full
provenance, and records exact candidate, optional precontext, and provenance
artifact references. SQL independently enforces artifact admission, exact
ordered parent arrays, and the exported pipe-hash transformation convention.
The retained output remains `unverified_candidate`.

Exact retries return the original database timestamps and references. Identity,
capture, candidate, provenance, lease, operation, source, profile, schema,
request, dispatch fence, and timestamp drift fail closed. Recovery under a
replacement live lease reads the same checkpoint without redispatch.

## Focused evidence

The following commands pass in `ai-engineer-knowledge-services`:

```powershell
corepack pnpm --filter @aiengineer/knowledge-persistence exec vitest run src/verification-structured-extraction-lifecycle.test.ts
corepack pnpm --filter @aiengineer/knowledge-persistence typecheck
corepack pnpm --filter @aiengineer/knowledge-persistence build
```

The focused suite passes six tests covering replacement-lease recovery with a
stable start time, malformed/stale lease rejection before lifecycle access,
immutable identity drift, exact capture retry with its stable retention time,
candidate payload drift before a transaction, and exact retained retry with its
stable completion time.

The coordinator then applied migration 317 locally and ran an actual canonical
operation proof through both Gateway and Interfaze adapters with injected
synthetic transport and zero supplier requests. All 13 named checks pass,
including distinct operation/step digests, capture before accounting settlement,
direct SQL artifact and identity substitution denial, stable database times,
replacement-fence recovery without dispatch, cancellation, and migration 315's
unchanged terminal-success denial. The independent audit hydrated and checked
19 actual Storage artifacts, both distinct candidate chains, ordered metadata,
and canonical lifecycle/capture custody.

Evidence in parent `internal/`:

- `verification-structured-extraction-lifecycle-db3aba97-5728-4e7a-9f13-c430c2785083.json` — SHA-256 `7efce23d37bf17197c95a6ec4c0b78e3fc2a2c01c19a946c7c0dfce7208defee`;
- `verification-structured-extraction-lifecycle-audit-20260906.json` — SHA-256 `5cf54b800a210087ed377e47ef095bdbf437acc64187314aaab4eb0d8cdcc8c3`.

This is a retained unverified-candidate checkpoint, not final operation
publication. Provider failure outcomes, final result publication, success
receipts, configured transports, and terminal operation guards remain separate
work.


Coordinator supersession: the stronger applied-SQL-body audit found the helper's parenthesized composite-access edit landed after local application. Coordinator restored317 to the actual applied SQL (both spellings behaved equivalently), and reran the proof. The final accepted proof will be `verification-structured-extraction-lifecycle-4ef9e506-d4ca-44ce-9387-488c7f4ae24e.json`; the earlier db3aba receipt/source hashes and audit hash above are historical, not current-source acceptance. The final audit additionally checks both applied SQL bodies and actual same/foreign-tenant app_reader isolation. See the coordinator lifecycle review for final hashes/status.
