# WS-08 request-contract handoff

**State:** ready for coordinator review; routes, application composition, capability checks, and exports are intentionally not included.

## Delivered boundary

`packages/contracts/src/verification/requests.ts` introduces strict, bounded route payload schemas for the service-composition inventory:

- Ten mutations: capture source, extract structured data, verify extraction, claims, report, and metric observations, run/compare a benchmark, replay a run, and request adjudication.
- Six readers: operation, run, run manifest, paginated run cases, case, and evidence.
- A discriminated `VerificationMutationRequestSchema` connects the ten payload types to the existing use-case vocabulary without reviving generic `parameters` admission.

Payloads carry `verificationContractVersion` and bounded registered artifact references, capture/run/case/evidence IDs, or a strict source input where required. Capture source input is discriminated: `acquire` permits a bounded credential-free HTTP(S) URI, while `register` binds a declared source ID and immutable content artifact without pretending an upload needs a URL. DNS, redirect, SSRF, tenant, ownership, and authorization decisions remain application responsibilities.

All schemas are strict. They reject unknown fields, provider endpoint/configuration, credentials, grants, deterministic/policy findings, authority claims, principal/deployment/reviewer identities, and caller-supplied operation context. Benchmark execution is deliberately limited to `offline_recorded`; extraction uses the immutable schema artifact and the `registered_default` profile. Adjudication accepts a target, reason, and registered evidence packet only: it contains no reviewer or promotion/engineering-label field.

`VerificationOperationContext` is deliberately absent from these request bodies. A future HTTP/CLI/MCP composition layer must accept it separately and validate authenticated tenant, actor, capability, idempotency, artifact ownership, deployment identity, reviewer qualifications, and review authorization before execution. These schemas do not authenticate a person, deployment, source, or reviewer.

## Tests and evidence

Focused tests cover valid canonical payloads for every listed route, acquisition and artifact-registration capture shapes, strict rejection of provider/credential/grant/finding/trusted-identity fields, malformed/credentialed source URLs, capture-ID and pagination limits, duplicate run comparison, unbounded review notes, and promotion-label attempts. The initial `new URL(...)` refinement could throw on malformed strings when `safeParse` ran; it was replaced with a guarded refinement and a nonthrowing malformed-URI regression.

Executed from `C:\Users\Pinda\Proyectos\aiengineer\ai-engineer-knowledge-services`:

```text
corepack pnpm --filter @aiengineer/knowledge-contracts exec vitest run src/verification/requests.test.ts
```

Result: exit 0; 1 file, 4 tests passed. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-08-requests-targeted-test-r2.log`; SHA-256 `42f8d0c91dba2b9058c898f27435bf8f4c151199c9b51bb0436cb38d1dd5db8c`.

```text
corepack pnpm --filter @aiengineer/knowledge-contracts typecheck
```

Result: exit 0. Log: `C:\Users\Pinda\Proyectos\aiengineer\internal\ws-08-requests-typecheck-r2.log`; SHA-256 `79e5e52fc15deda19c5eafbe95567dddab9ad6c90e129e0b80e4b23b7f7533d4`.

## Coordinator integration required

No existing exports were changed. After review, add the request schemas and types from `requests.ts` to the appropriate contracts export surface, then bind each API/CLI/MCP route to the corresponding schema before any application or provider invocation. Keep `parseArtifact` and `inspectAuditBundle` as internal/offline application use cases until the public route inventory assigns a bounded endpoint.

## Source hashes

- `requests.ts`: `37cb58f3bb6b750b2d48d12e9eb598b826ffa32cf88965627f8f84d43e719e4f`
- `requests.test.ts`: `8aa3baf39daecc59621b2250983a0ba54b67dda6a2e37b1abcbc20cb4706854b`

## Coordinator acceptance — 2026-09-05

The coordinator independently reproduced the initial malformed-URL TypeError, then accepted the corrected shape boundary after 10 positive/adversarial checks through the public verification index. Receipt `internal/verification-request-contract-review-353ce835-0444-43cf-abdb-12fb1e80f907.json`, SHA-256 `e4562ae6ba5c0296ed23930de37a7a8e02dfc482e15cfe3309b8f73ee254b591`. The coordinator added `export * from "./requests.js"` to `packages/contracts/src/verification/index.ts` and reran the four focused tests and contracts typecheck successfully. The implementation owner is released.

Future integration must map GET path/query parameters into reader inputs without requiring a GET body; the route version can supply the fixed verification contract version. Supported source-kind/projection vocabulary is not a promise that all parser/provider routes are admitted. The runtime capability gate remains authoritative. This accepted preparation does not complete WS-08 or authenticate reviewer identities.
