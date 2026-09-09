# SW-07 VR-013 capability audit — 2026-09-08

## Scope

Read-only audit of acceptance row VR-013: “Semantic verifier is evidence-closed with a bounded tool surface.” The matrix remains `missing`. No status or implementation file was changed, and no paid call was made by this audit.

## Evidence found

The semantic boundary is materially bounded in source and focused tests:

- `packages/verification/src/semantic/verification.ts` requires an opaque process-admitted semantic case, recomputes mechanical eligibility before judge invocation, blinds the judge input to assertion/qualifiers/entity bindings/fragment IDs and exact text, rejects non-empty adapter `toolCatalog`, and validates output fragment references and bounded structure.
- `packages/verification/src/providers/semantic-judge.ts` gives the recorded and NLI adapters `toolCatalog = []`; its focused test asserts the empty catalog and records that the NLI adapter receives only the bounded classifier input.
- `packages/verification/src/providers/gateway.ts` constructs a fixed Gateway request with no `tools` or `tool_choice`, an evidence-only system prompt, strict JSON schema, fixed model allowlist, and request/response bounds. `packages/verification/src/providers/providers.test.ts` asserts the request body has neither `tools` nor `tool_choice`.
- Focused verification/provider tests were rerun read-only: `corepack pnpm --filter @aiengineer/knowledge-verification exec vitest run src/semantic/verification.test.ts src/providers/semantic-judge.test.ts src/providers/providers.test.ts --reporter=dot` -> 3 files, 21 tests passed.

These are mocked or in-process tests. The provider test supplies an injected `fetch`; it does not establish the behavior of the live Gateway or a deployed agent runtime. The recorded/NLI tests use synthetic adapters and do not inspect an external runtime catalog.

There is actual request/lifecycle evidence, but it proves a different boundary. EV-120, retained in `ACCEPTANCE-MATRIX.md` and `SEMANTIC-WORKER-RUNTIME.md`, exercised local Temporal -> KS HTTP -> configured worker -> real Luna, with native provider attempt, request/response capture, semantic observation, signed sealing, and typed terminal reads. EV-121 independently audited the retained receipt and records one settled Luna attempt and one response/observation per claims/report operation. Its limitations remain local-only and do not include a capability-catalog or prohibited-tool evaluation.

## Missing proof and minimal closure

The required matrix evidence is “Capability inspection and prohibited-tool evals.” No retained proof inspects the actual native KS/live-Eve verifier runtime catalog or executes its prohibited-tool/injection cases. The earlier shared-extension concern is superseded by the cutover below: the built verifier catalog now excludes `list_research_records`.

The Eve cutover has since removed the shared extension entrypoint. The active verifier files are `research_ingestion_systems_agent/agents/verification/agent/agent.ts`, `agent/lib/verification-ks-runtime.ts`, and `agent/tools/verify_evidence_bundle.ts`; the built Eve summary lists exactly one authored tool, `verify_evidence_bundle`, and `list_research_records` is absent. The SW-03 ledger records this as a source-level/build-catalog cutover with focused runtime tests, while explicitly leaving the real KS HTTP Eve evaluation open.

The minimal remaining gap is one independent, credential-free native KS/live-Eve proof against the actual semantic verifier composition: launch the verifier with a fixed authorized evidence fixture, record the effective tool catalog, and assert it contains no shell, filesystem, web/search, GUI, or delegation/agent capability. The same proof should run source-text and provider-metadata prompt-injection fixtures and assert unchanged verdict/digest plus zero prohibited-tool invocation attempts. It should retain a receipt with runtime/source/configuration digests and clearly label any model response as synthetic (`mockModel`) or actual live inference. EV-120 can supply the already-proved actual Luna request/lifecycle portion; it cannot substitute for this native Eve catalog/eval receipt.

The current root SDK report-publisher run is separate evidence: it observed local tools `['mcp']`, a custom `report_publisher`, and `settings=[]`, and completed a successful model tool call, but its native path failed before provider dispatch. That local tool surface is a report-publisher harness, not the semantic verifier's bounded API, and does not close VR-013.

Conclusion: VR-013 has strong bounded-core, actual-Luna transport, and Eve build-catalog evidence, but remains `missing` because the acceptance-required native KS/live-Eve capability inspection and prohibited-tool/injection evaluation are absent. No broader semantic quality, calibration, human-label, or provider-promotion claim is implied.

## Executed bounded native capability and injection proofs

Added and executed two new no-cost proof scripts only:

- `internal/prove-verification-eve-prohibited-tools.mjs` created a disposable copy of the actual verification Eve application, retained its tool files, and substituted only a synthetic `mockModel` response. The actual `eve info --json` catalog was exactly `['verify_evidence_bundle']`. The mock emitted one request each for `bash`, `read_file`, `write_file`, `web_fetch`, `web_search`, `computer_use`, `agent`, `Workflow`, and `shared__list_research_records`; the real Eve runtime emitted zero `actions.requested`/`action.result` events for all nine. Receipt: `internal/verification-eve-prohibited-tools-ae8d7603-cf89-4c3d-ab55-e147bd8ea810.json`, SHA-256 `df7d000de3eb1c0bd9beb66f0725b1839c7efcb413984614252d6b2c64f22663`. The disposable fixture was removed. This is synthetic-model capability evidence, not live Eve inference or semantic quality evidence.

- `internal/prove-semantic-prompt-injection-boundary.mjs` exercised the installed `GatewaySemanticJudgeAdapter` with an injected source-fragment string and injected nonnumeric provider metadata under an injected fetch. It verified the fixed system instruction treats content as untrusted, the injection occurs only in the bounded JSON user message, `tools`/`tool_choice` are absent, `toolCatalog` is empty, and the response metadata string is not projected to the result or semantic observation. Receipt: `internal/verification-semantic-prompt-injection-boundary-802c81a4-ca82-4497-b0fc-bfa5ad0be35e.json`, SHA-256 `e3098b8e344525a7dd4b9437232fc1e33154bb2937b8bfd48cb625f04d32442b`. It made one injected in-process fetch and zero network/provider/KS calls.

These proofs materially supply the required effective-catalog and prohibited-tool evidence for VR-013, while leaving live model prompt obedience, full semantic quality, deployment/Cloud, and human/policy admission outside scope. No acceptance status was changed here.
