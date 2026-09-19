# Verification examples

Run from the repository root with Node >=24 and installed workspace dependencies:

```sh
corepack pnpm --filter @aiengineer/knowledge-verification examples
corepack pnpm --filter @aiengineer/knowledge-verification typecheck
corepack pnpm --filter @aiengineer/knowledge-verification test
```

[selectors.ts](selectors.ts) supplies a readable fixture for each of the **12 selector kinds**.
[run.ts](run.ts) prints one JSON result per kind, followed by ambiguous-quote recovery.
[selectors.test.ts](selectors.test.ts) runs the same fixtures in the ordinary package test suite;
the package typecheck includes all examples. No credentials, network, files, or parser process
are needed. The resolvers are real; HTML/PDF/image/table/transcript/repository/dataset/API
projections are synthetic parser outputs, not a raw-media ingestion demonstration.

Expected output: twelve `resolved` results with coordinate ranges; repeated `42` is
`ambiguous`, then resolves after adding source context. Structured results intentionally
retain locator metadata: they are not interchangeable with scalar extraction values.

These are internal algorithm examples. External agents use the
[executor CLI example](../../../apps/verification-executor/examples/README.md) or the admitted
platform HTTP/client/CLI/MCP contracts, never imports from this package.

[CAPABILITIES.md](CAPABILITIES.md) reviews assertions, verification, media diversity,
current limitations, and the distinction between resolvers and admitted acquisition.
The [review record](../../../docs/operations/reviews/verification.md) records requirements,
changes, validation and consumer distribution state.
