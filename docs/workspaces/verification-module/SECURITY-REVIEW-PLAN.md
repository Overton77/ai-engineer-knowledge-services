# Verification security review plan

Coordinator pre-implementation analysis, 2026-09-05. Controls below require executable evidence; this document alone proves none of them.

## Trust boundaries and required negative tests

| Boundary | Attack | Required behavior and proof |
| --- | --- | --- |
| Authenticated caller to application | Caller forges tenant or verifier deployment | Resolve tenant/capabilities and verifier identity from trusted runtime principal; reject mismatched envelope. Same-deployment rejection is required in schema, engine and canonical persistence. Different caller-supplied strings alone do not prove deployment independence. |
| Object store to hydration | Missing, changed, cross-tenant, oversized bytes | Authorize tenant, verify digest and byte count on every hydration, reject mutable substitutions. Bind parser output to a registered parent artifact and transformation signature. |
| Selector to evidence | Invented parser geometry, ambiguous quote, CSS fallback drift | Resolve from captured canonical projections; caller-provided occurrence count/selection hashes cannot act as trusted resolution. Verify page/coordinate bounds, matching basis, selected digest and lineage. |
| Extracted value to evidence | A valid quote is unrelated to the requested number/entity/unit | Replay value derivation and operand references, and require semantic review for unsupported direct bindings. Pointer validity is not value validity. |
| Source text to judge | Prompt injection requests browsing, secrets, delegation or altered findings | Judge receives a fixed, bounded evidence input with no arbitrary tool capabilities; parse strict output and validate every returned fragment ID. Test injected source/provider metadata and fabricated citations. |
| Semantic output to admission | Judge calls broken evidence supported or exceeds authority | Mechanical failures remain final. Interested-party entailment remains separate from corroboration/world correctness. High-risk conflicts require qualified review. |
| Provider request/response | Unsafe remote references, unbounded schema, retention mismatch, leaked headers | Validate schema/URL/data policy before spending; bounded response/time/retries; ZDR enforced when required; raw output/precontext restricted and registered; compact public projections scrub secrets and private reasoning. |
| Persistence to API | Orphan artifact, cross-tenant relation, mutable historical result | Canonical schema only; append-only evidence with tenant-composite references; registration verification before receipt success; collision and replay tests against actual Postgres/storage. |
| Dataset to experiment | Mutated label, source-family split leakage, fake human labels | Immutable hashes cover cases, captures, labels, variants, graders/policies. Check duplicate/source clusters across splits. Machine labels are explicitly machine labels; locked human review cannot be inferred. |
| Worker to durable orchestration | Duplicate delivery, stale lease, cancellation during inference, worker loss | Reuse existing operation ledger, fencing and outbox; deterministic step keys; stop on cancellation; classify quality failure terminally; reconcile without duplicate admitted runs. |
| Review/UI to canonical evidence | XSS from source, arbitrary file path, unauthorized override | Escape report content and URLs; route-only server access and capability authorization; immutable review history with actor/reason/version; no direct client DB mutation. |
| Replay to policy | Rehydration silently fetches current URL or uses changed policy/model | Offline replay uses sealed bytes and policy artifact; missing provider snapshot reported explicitly. Drift creates new observation/version and revalidation event. |

## Known pre-existing implementation constraints

- Runtime artifact storage verifies digests, but a write must be coupled to `orchestration.artifact` registration by the verification persistence path.
- Prototype checks are deliberately narrower than the final specification. Its direct-metric source-value/units checks are insufficient; legacy parity does not authorize those gaps in the new admitted contract.
- Existing provider acquisition adapters and parser services must be reviewed at the actual network/body/parsing boundary. A type advertising a size limit or a sandbox policy is not proof that execution enforces it.
- Do not put full copyrighted corporate captures in a redistributable test fixture. Restricted capture digests and small evidence projections must retain explicit rights status.

## Rollout posture

Keep new provider/model/policy registrations at lab/offline until their own measured gates pass. Require explicit qualified/human approval for high-risk release and promotion. The unfinished research systems cannot provide production-shadow evidence yet; integration tests must be reported as integration tests.

## Coordinator bounded MCP hardening — 2026-09-05

The MCP HTTP host now disables raw Fastify request logging and returns fixed error codes from its HTTP error handler instead of exception messages. Startup failure output uses a fixed code. A resolver exception carrying a synthetic credential URL and malformed JSON carrying private text both produce content-free responses in injection tests. MCP tests passed 10 with one database integration test skipped; typecheck passed. Receipt: `internal/verification-mcp-error-boundary-20260905-0819.json`. An initial test assumption about the disabled logger's level property was removed; behavior assertions target HTTP output.

This is a bounded coordinator change, not independent WS-09 acceptance. Review the MCP SDK tool-error boundary, serverless initialization failures, structured telemetry, and actual admitted verification tool responses separately during WS-08/09 integration.
