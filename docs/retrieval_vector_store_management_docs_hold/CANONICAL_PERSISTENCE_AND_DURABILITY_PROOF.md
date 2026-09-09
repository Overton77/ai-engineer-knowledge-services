# Canonical persistence and durability proof

This proof is local-only and writes exclusively to the dedicated test tenant
`00000000-0000-7000-8000-000000000001` with store class
`internal_exploratory`. It never targets shared infrastructure or
`official_canonical`.

## Architecture

- `@aiengineer/knowledge-persistence` implements tenant-scoped PostgreSQL
  transactions for operations, steps, collision-safe events, leases and
  fencing, receipts, outbox delivery, reviews, publication/rollback RPCs,
  retrieval, artifacts, and evidence packets.
- Source bundles are stored as immutable, digest-addressed objects in the
  private local Supabase `source-captures` bucket. Canonical artifact metadata
  records the bucket, object path, byte length, and SHA-256 digest.
- The deterministic loader maps exactly three validated embedding bundles to
  the canonical `internal_exploratory` publication path (41 claims and 41
  half-vector embeddings). Generated database columns are left to PostgreSQL.
- The API returns a bare, schema-validated `EvidencePacket` from persisted
  state. When `POSTGRES_URL` is present, the normal API bootstrap installs the
  PostgreSQL resolver. Local bearer identities resolve to explicit actors and
  tenant grants; every API action is denied unless a role or scope admits it.
- The standard worker selects PostgreSQL plus private Supabase Storage by
  default, reconciles on startup, heartbeats fenced leases, and drains on
  shutdown. In-memory persistence requires explicit development/test mode.

## Reproduce locally

Start the adjacent local database contract first. Derive runtime values from
local Supabase status; do not copy credentials into source files or receipts.

```powershell
$statusText = supabase --workdir ..\ai-engineer-db-contract status -o json 2>$null
$localStatus = $statusText | ConvertFrom-Json
$env:POSTGRES_URL = $localStatus.DB_URL
$env:SUPABASE_URL = $localStatus.API_URL
$env:SUPABASE_SECRET_KEY = $localStatus.SERVICE_ROLE_KEY
corepack pnpm run prove:canonical-durability
```

The runner refuses database targets other than `127.0.0.1:54322`/`localhost`
and Storage/API targets other than `127.0.0.1:54321`/`localhost`.

Validation commands:

```powershell
corepack pnpm verify
$env:RUN_LOCAL_PERSISTENCE_TESTS = '1'
corepack pnpm --filter @aiengineer/knowledge-persistence test
corepack pnpm --dir ..\ai-engineer-db-contract exec supabase test db
corepack pnpm --dir ..\ai-engineer-db-contract run types:check
```

## Recorded proof

The machine-readable, secret-free receipt is
`catalog/canonical-durability-proof.json`. The accepted run records:

- a unique, non-secret `proofRunNamespace` that isolates every local acceptance
  execution while preserving immutable prior operations, publications, packets,
  artifacts and receipts;

- a real `apps/worker` process publishing 3 immutable Storage objects and
  41/41 canonical vectors, then exiting with its operation succeeded;
- a fresh process reconstructing solely from PostgreSQL plus private Storage,
  retrieving the maintained DoD query, and producing a typed five-member
  evidence packet whose normalized members cite accepted, byte-identical
  source-native representations and document nodes;
- matching ANN and forced-exact top results;
- publication of a replacement, rollback to the immutable source publication,
  and rebuild/publication from stored objects and receipts;
- stale-lease rejection with a higher recovery fencing token, provider and
  reranker fallback recovery, and fenced outbox claim/extend/nack/reclaim/ack;
- a narrowly scoped local database pause classified as
  `DATABASE_UNAVAILABLE`, followed by successful reconnect; and
- a real API process plus a separate TypeScript client process retrieving the
  persisted bare evidence packet over HTTP. The ephemeral bearer token is not
  written to the receipt.

The separate local HNSW receipt is `catalog/local-hnsw-proof.json`. It uses a
transaction-scoped 6,000-row half-vector fixture, records three
`EXPLAIN (ANALYZE, BUFFERS)` HNSW plans under selective filters, compares ANN
against forced exact search, and rolls the entire fixture back. The accepted
run observed Recall@20 of 0.9333 average and 0.85 minimum.

## Deployment-only constraints

- Shared/remote infrastructure was intentionally not mutated, so production
  credentials, external identity-provider claims, managed queue delivery, and
  deployment topology remain environment acceptance work.
- `annNearest` and `exactNearest` remain diagnostic comparison helpers; public
  retrieval continues to resolve an active publication through the guarded
  hybrid RPC.
- The HNSW evidence is intentionally local and transaction-rolled-back; each
  deployed Postgres environment still needs its own plan/recall acceptance
  because planner decisions depend on its statistics and hardware.
