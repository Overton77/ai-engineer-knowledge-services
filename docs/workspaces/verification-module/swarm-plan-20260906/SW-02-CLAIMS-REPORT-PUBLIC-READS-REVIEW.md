# SW-02 claims/report public reads review

Scope: frozen local public read transport only. This review covers API startup/runtime/routes, generated OpenAPI route declarations, typed client, CLI, MCP, and the retained claims/report terminal reader. It excludes real external MCP agents, remote deployment, new verification execution, parser/provider calls, and transport write paths.

Reviewed current source hashes are recorded in the source proof receipt `../internal/verification-claims-report-read-transports-20260907-r1.json`; key files are contracts reader `da6373b138e2be375d60e3285dece2675e3ea36cc263d9b93ce805afb9e96c47`, application reader `cba47832704fb24a37cf1b94b1b5dd313320b17154b5a58eeb8513f6406bb1bf`, persistence reader `3d68432068bb1ae145f3d409c69d6093b79e01b8bfc0cf26577826eab85037cf`, API read runtime `76688438f4872e8d961010354a02ca84d6c392359aa837e8438511c83586cba7`, and proof script `7a278c7f6d4a24b9cfaa2e8f20467b522cdf4308bf937893c4101bf432d1e48c`.

## Findings

No actionable P1/P2 was found in the bounded surface. API startup requires server-owned public keys, Storage credentials, and ownership grants before composing the reader. Routes require authenticated read authority, validate family-specific compact schemas, and map nonterminal/integrity conditions without returning terminal bodies. The generated OpenAPI declares `GET /v1/verification/claims/{operationId}` and the analogous report route. Typed client calls, CLI read commands, and MCP read tools preserve an operation ID plus authenticated context; no adapter accepts a raw bundle/result body.

## Independent execution

After Sol reported frozen dist, I ran:

```powershell
corepack pnpm exec tsx scripts/prove-verification-claims-report-read-transports.ts ../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json ../internal/verification-claims-report-read-transports-independent-20260907-r1.json
```

Exit `0`. Independent immutable receipt: `../internal/verification-claims-report-read-transports-independent-20260907-r1.json`; SHA-256 `a6219798a866eda8715e8cd482dc4fdeaec5375feb3dfae82782589954f0e2e3`.

All 11 checks passed: database default read-only; server-owned signature/ownership trust; exact claims/report HTTP, typed client, CLI and MCP reads; compact output; unauthorized/missing/wrong-family/wrong-tenant/unowned-actor denial; unchanged native operation/artifact counts. It reports zero parser and provider dispatches.

## Limits

This is local API plus in-process CLI/MCP adapter evidence. It is not a remote deployment, external MCP-agent, concurrency/interleaving, OS-crash, provider, or new verification execution proof.
