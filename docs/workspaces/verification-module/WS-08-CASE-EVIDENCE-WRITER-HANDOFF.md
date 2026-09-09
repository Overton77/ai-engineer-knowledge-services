# WS-08 Case Evidence Writer Handoff

## Scope

Added the bounded authored-case persistence writer:

- `packages/persistence/src/verification-case-writer.ts`
- `packages/persistence/src/verification-case-writer.test.ts`

No exports, migrations, API routes, CLI/MCP wiring, or sealed metric writers were changed.

## Interface

`new PostgresVerificationCaseWriter(database, audits).recordCase(input: unknown)` accepts only this strict shape:

```ts
{
  tenantId, runId, caseRunId, caseKey,
  inputArtifact: { artifactId, digest, mediaType, sizeBytes },
  resultArtifact: { artifactId, digest, mediaType, sizeBytes },
  evidence: [{ evidenceId, evidenceKey, ordinal, artifact: { artifactId, digest, mediaType, sizeBytes } }],
  createdAt
}
```

It returns `{ caseRunId, evidenceIds }`, where IDs are ordered by ordinal. IDs are UUIDs; keys are raw-length 1..255 and nonblank; ordinals are unique integers 0..255; evidence is capped at 256; `createdAt` must be canonical ISO-8601. Unknown fields are rejected before the audit port is called.

## Acceptance and serialization

The writer first loads the authorized audit bundle and rejects any tenant/run or `verification.v1` binding mismatch. It defensively rejects retained handles from another tenant and duplicate artifact IDs with inconsistent digest, media type, or size. Input/result/evidence references must exactly match retained manifest handles, including ID, digest, media type, and size. Evidence may use only retained input/output artifacts.

Within the tenant transaction it locks the canonical `evidence.verification_run` row. It then locks the case identity (`caseRunId` or `(runId, caseKey)`) and all evidence rows. A first write inserts the entire graph. A retry succeeds only if the case and every evidence row, including timestamps and membership, are exact; changed, removed, or added evidence returns a drift error and never appends rows. The migration remains the authority for artifact admission, digest, tenant, and parent constraints.

This writer creates only explicit artifact-based case/evidence rows. It does not map evaluation runs, scores, locators, findings, or judgments.

## Focused validation

From `packages/persistence`:

```text
corepack pnpm run typecheck
corepack pnpm exec vitest run src/verification-case-writer.test.ts
```

Both pass. The focused suite has 13 unit-only tests covering exact retry, parent locking, case/evidence drift including removal/addition, pre-I/O strict rejection, tenant/run binding, foreign/inconsistent audit handles, exact compact membership, empty-case append prevention, and unavailable parent rejection. It uses injected SQL/audit fakes only; it does not prove the live database path.
