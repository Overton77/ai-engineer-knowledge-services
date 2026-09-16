# Acquisition examples

Runnable, mocked demonstrations of the internal acquisition and inspection fallbacks. Default examples need no vendor key.

From `packages/acquisition`:

```bash
pnpm exec tsx examples/01-http-acquire.ts
pnpm exec tsx examples/02-upload-acquire.ts
pnpm exec tsx examples/03-inspect-bytes.ts
pnpm exec tsx examples/04-http-then-inspect.ts
pnpm exec tsx examples/05-paper-resolve-then-http.ts
pnpm exec tsx examples/06-http-policy-failure.ts
pnpm exec tsc --noEmit -p tsconfig.examples.json
```

| File | Sequence | What is mocked |
|---|---|---|
| `01-http-acquire.ts` | plan → execute → verify | injected `fetch` |
| `02-upload-acquire.ts` | local fixture file + attestation | none (real file under `examples/fixtures`) |
| `03-inspect-bytes.ts` | read + search + observe | none |
| `04-http-then-inspect.ts` | acquire then inspect | injected `fetch` |
| `05-paper-resolve-then-http.ts` | resolve identity → one HTTP target | fixture paper resolution + injected `fetch` |
| `06-http-policy-failure.ts` | private DNS answer | mocked resolver |

Expected shape: JSON on stdout with a sealed digest or a policy error, `artifactCount: 1` on success, and no secret values in inspection output.

Platform `source inspect` is not admitted. Agents inspect sealed bytes with executor `verify_read_capture` / `verify_search_capture` or this package API.
