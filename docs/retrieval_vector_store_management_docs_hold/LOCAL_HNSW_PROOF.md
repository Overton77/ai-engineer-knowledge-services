# Local HNSW plan and recall proof

`scripts/prove-local-hnsw.ts` creates 6,000 deterministic 1,536-dimensional
half-vectors in a PostgreSQL temporary table, builds an HNSW cosine index, and
analyzes three queries with a five-percent selective filter. The whole fixture
runs inside one transaction and the table is dropped on commit. It does not
write canonical tables, object storage, or remote infrastructure.

For each query the proof records `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for
the HNSW path, forces the correctness oracle to disable index and bitmap scans,
records its sequential-scan plan, and computes Recall@20 from result-ID
overlap. Query-vector literals are redacted from plans to keep the receipt
compact; plan shape, filter counts, timing, and buffer observations remain.

Run it against the adjacent local Supabase database only:

```powershell
$statusText = supabase --workdir ..\ai-engineer-db-contract status -o json 2>$null
$localStatus = $statusText | ConvertFrom-Json
$env:POSTGRES_URL = $localStatus.DB_URL
corepack pnpm run prove:hnsw-local
```

The checked-in receipt is `catalog/local-hnsw-proof.json`. The runner fails if
any ANN plan does not use the HNSW index, any exact plan is not forced to a
sequential scan, or average Recall@20 is below 0.8. This is local performance
and recall evidence, not canonical publication authority.
