---
description: Use when planning scoped knowledge retrieval, inspecting retrieval explanations, or building immutable evidence packets.
license: Proprietary
metadata:
  version: "1.0.0"
  contract: "knowledge-service/v1"
---

# Knowledge retrieval and evidence

Declare the tenant, purpose, admitted vector-store/version, domains, hard filters, query classes, candidate bounds, and required evidence before searching. Validate the retrieval plan, then search through the public client or bounded MCP tool.

Inspect exact, FTS, semantic, graph, rerank, diversity, context, freshness, and filter stages separately. Treat context-only neighbors as context, never proof. Cite immutable locators and expose fit, non-fit, assurance, freshness, contradictions, graph paths, and score-stage explanations.

Request more evidence only within declared bounds. Abstain when coverage is insufficient, identifiers conflict, evidence is unauthorized, or a locator cannot replay. Never infer the existence or count of inaccessible records, bypass tenant filters, query raw vectors/SQL, or turn a retrieval result into a publication decision.
