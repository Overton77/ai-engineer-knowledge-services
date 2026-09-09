# Coordinator integration findings

2026-09-05, coordinator; implementation planning evidence, not acceptance proof.

- Local Docker Supabase services are running (`supabase_db_aiengineer`, storage, auth, REST). Use additive canonical migrations and isolated verification fixture tenants; do not reset the existing database or touch production research records.
- Existing runtime `ArtifactStore` supplies local and Supabase content-addressed bytes and digest verification. Verification needs a registered ledger wrapper: a bucket write alone is not relational evidence.
- Existing application `KnowledgeOperationPort`, `operationStepsByKind`, production capability admission maps, persistence operation service, leases/outbox and reconciliation must be composed, not duplicated.
- Existing operation envelope uses `v1`; verification payloads need explicit `verification.v1` without silently redefining service-wide context.
- Credentials are present (values never printed) in Knowledge Services `.env` for Interfaze, AI Gateway, Firecrawl, database/Supabase, Cursor, Temporal. Live proof is feasible; actual connectivity and quotas still need testing.
- The pre-existing `available_env.md` explicitly permits Cursor, EVE, and Vercel AI SDK agent tests and asks to try GPT 5.6 Luna or Terra. Discover actual model availability before selecting live-test models; retain requested/returned identity and typed unavailability rather than silently substituting. Existing unrelated retrieval judge script uses `openai/gpt-5.4-mini`, which is a migration reference, not a mandate for the new pilot.
- Live Gateway catalog discovery succeeded (HTTP 200) using `node --env-file=ai-engineer-knowledge-services/.env internal/verification-discover-models.mjs`. `openai/gpt-5.6-luna`, `openai/gpt-5.6-terra`, and `anthropic/claude-haiku-4.5` are listed. Frozen metadata/pricing candidates: `../../../../internal/verification-model-catalog-20260905.json`, SHA-256 `fe77376edc2a390d7039b1ba154c1a3e785dee0c98bdd2d96b7c8cbc01ce5845`. Coordinator selects Luna as initial extractor baseline and Haiku 4.5 as the initial explicitly cross-family judge candidate, subject to actual conformance. No claim is made about unknown internal model families behind Interfaze.
- Prototype EVE repo requires reading its technical decisions and installed eve docs before code changes. Cursor repo requires its environment preflight and thin CLI skills. Dashboard requires installed Next docs and a running-page check using its `next-dev-loop` skill (locate before edits).
- Official Interfaze documentation checked 2026-09-05: `https://interfaze.ai/docs/run-tasks`, `/structured-output`, `/security`. Fixed-task calls use `<task>name</task>` system content and empty/any schema with task-native results. Task allowlist must omit browsing/search, GUI, forecast and shell. Sensitive requests require `x-interfaze-zdr: true`; sensitive production data remains unadmitted pending provider policy review.
- Prototype may remain intact until parity proof and a documented consumer cutover; do not remove historical experiment inputs.
- Real labels cannot be described as human-reviewed unless a human actually reviews them. Production-shadow, expert adjudication, live cloud execution and benchmark accuracy gates require their own evidence, irrespective of passing local tests.

## Sequential ownership plan

1. Sol: contracts + deterministic prototype port (WS-01/02).
2. Sol: provenance + canonical persistence + real local DB/storage proof (WS-03).
3. Sol: selector families + claims/evidence-closed policy (WS-04/05).
4. Terra/Sol based on complexity: provider adapters/conformance + live probes (WS-06/09).
5. Sol: frozen diagnostics pack + statistical experiment harness + real paired pilot (WS-07).
6. Sol: shared application/service surfaces and integration (WS-08/10).
7. Terra: dashboard read/review slice (WS-11).
8. Independent Sol audit (WS-12), coordinator fixes and reruns unresolved gates.

Coordinator prepares source capture inputs while foundation work proceeds, and reviews each handoff before assigning dependent implementation.
