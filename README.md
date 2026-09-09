# AI Engineer Knowledge Services

TypeScript monorepo for the AI Engineer knowledge-preparation, retrieval, evidence, evaluation and publication bounded context.

## Runtime boundaries

- `apps/api`: versioned Fastify HTTP API; suitable for Vercel Fluid Compute or a Node container.
- `apps/mcp`: stateless Streamable HTTP MCP facade over the same application service.
- `apps/worker`: durable knowledge-operation worker process; deploy as an always-on AWS container.
- `apps/cli`: machine-readable operator and developer CLI.
- `services/docling`: reserved pinned Docling Serve deployment boundary.

The HTTP and MCP transports do not own business rules. Cross-repository callers use the published HTTP contract/client; first-party transport handlers invoke `packages/application` directly.

## Start

```bash
corepack pnpm install
corepack pnpm verify
corepack pnpm dev:api
```

## Operator documentation

- `docs/operations/runbooks.md` — incident detection, containment, retry/repair authority, and verification evidence.
- `docs/security.md` — authentication, capability admission, parser isolation, redaction, and callback signing.
- `docs/architecture/0001-runtime-and-deployment.md` — Node 24, Fastify, MCP, and deployment baseline.
- `docs/architecture/0002-deterministic-preparation.md` — preparation pipeline.
- `docs/architecture/0003-embedding-retrieval-evaluation.md` — embedding, retrieval, and evaluation.

### Verification module

- `docs/verification/README.md` — current operator and integrator guide (architecture, surfaces, acceptance state).
- `packages/verification/README.md` — algorithm package facade and invariants.
- `skills/knowledge-verification/SKILL.md` — agent skill for invoking verification HTTP/CLI/MCP.

## Deterministic preparation pipeline

The local preparation path is implemented as small, independently testable packages:

- `runtime`: content-addressed artifacts plus an operation, step, lease, event and receipt ledger;
- `acquisition`: admitted acquisition contracts, an SSRF-safe exact HTTP adapter and deterministic fakes;
- `conversion`: deterministic text/transcript/Markdown/HTML conversion and Unstructured/Docling provider boundaries;
- `documents`: immutable structural nodes and verifiable source locators;
- `chunking`: admitted profiles, reconstructable spans, quality checks and duplicate/boilerplate handling;
- `projections`: evidence-validated procedures for the seven public domains and faithful source-native sections;
- `application`: `vetOnly` and `preparePreview` orchestration that deliberately stops at a review proposal. It does not embed, publish or write canonical records.

`knowledge-testkit` discovers and validates the three versioned embedding bundles from the sibling research-starter repository. CI uses their captured text and deterministic fakes; it does not require arbitrary live web access. Canonical database migrations remain owned by `ai-engineer-db-contract`.

## Gate 6 operations

- Versioned agent procedures: `skills/manifest.json`
- Admitted runtime profiles: `catalog/capability-profiles.v1.json`
- Pinned Docling service: `services/docling/compose.yaml`
- Deployment and rollback: `docs/verification/DEPLOYMENT.md`, `docs/architecture/0001-runtime-and-deployment.md`
- Security boundary: `docs/security.md`
- Incident and reconciliation drills: `docs/operations/runbooks.md`
