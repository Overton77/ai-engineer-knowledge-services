<!-- BEGIN GENERATED: knowledge-index -->
# ai-engineer-knowledge-services knowledge index

OKF 0.2 Markdown concepts. Read the matching explanation, then follow its source/test links. These are evidence-backed working-copy descriptions, not new accepted decisions or deployment attestations.

## Find the relevant concept

- **Ownership and caller contracts:** [service-boundaries](service-boundaries.md)
- **Schema, bounded reads, canonical writes:** [schema-read-and-ingestion](schema-read-and-ingestion.md)
- **Capture, prepare, publish:** [preparation-and-publication](preparation-and-publication.md)
- **Search, evidence packets, citation replay:** [retrieval-and-evidence](retrieval-and-evidence.md)
- **Claims, deterministic failures, admission:** [verification-and-admission](verification-and-admission.md)
- **Leases, retries, cancellation, repair:** [durable-execution-and-recovery](durable-execution-and-recovery.md)

## Concepts

- [Knowledge service boundaries](service-boundaries.md) — Ownership and safe entry points for schema navigation, bounded reads, ingestion, and retrieval. [reference; Service Boundary]
- [Schema, bounded reads, and deterministic ingestion](schema-read-and-ingestion.md) — A safe sequence for navigating the pinned schema, creating reproducible reads, and applying admitted knowledge changes. [reference; Playbook]
- [Knowledge preparation and publication](preparation-and-publication.md) — How admitted source material becomes traceable, policy-gated knowledge and a versioned retrieval publication. [reference; Architecture Concept]
- [Retrieval and evidence](retrieval-and-evidence.md) — How policy-scoped retrieval produces bounded, replayable evidence packets instead of unsupported answers. [reference; Architecture Concept]
- [Verification and admission](verification-and-admission.md) — How Knowledge Services verifies evidence and admits it to knowledge effects. [reference; concept]
- [Durable execution and recovery](durable-execution-and-recovery.md) — How verification recovery preserves authority, scope, and bounded repair work. [reference; concept]

## Search

Run from the repository root (PowerShell or bash):

```text
node .agent-docs/cli.mjs search --repo . --query "retry cancellation"
node .agent-docs/cli.mjs search --repo . --query "admission" --format json
rg -n -i -C 2 "admission|deterministic" knowledge -g "*.md"
```

The executable searches registered concepts only, using current files. It ranks title, description, tags, headings, and body matches; returns paths and line snippets; accepts --type, --tag and --limit. It is lexical search, not embeddings. No match exits 1; invalid input exits 2. Try a domain term from the routes or rg when wording differs.

## Maintain this bundle

Edit concept Markdown and its registration in `.agent-docs/config.json`; keep `type`, `title`, and `description` in YAML frontmatter. Types are open vocabulary. Acceptance status stays in the registry. Retain source/test links and identify uncertainties. Build and check with the repository-local CLI. Do not edit this generated listing.

Build validates the local navigation profile and cited local file paths; provenance hashes cited files so changed evidence requires review. It does not prove prose is semantically correct. Reconcile code and accepted architecture rather than refreshing hashes blindly.

[OKF specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md). The local flat-file navigation profile requires titles/descriptions and resolvable local file links beyond OKF’s minimal requirements. No `verified` claim is inferred from formatting checks.
<!-- END GENERATED: knowledge-index -->
