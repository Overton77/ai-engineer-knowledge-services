---
description: Use when planning scoped knowledge retrieval, inspecting retrieval explanations, or building immutable evidence packets.
license: Proprietary
metadata:
  version: "1.1.0"
  contract: "knowledge-service/v1"
---

# Knowledge retrieval and evidence

Declare the tenant, purpose, admitted vector-store/version, domains, hard filters, query classes, candidate bounds, and required evidence before searching. Validate the retrieval plan, then search through the public client or bounded MCP tool.

## Official retrieval operations

The platform CLI commands are `knowledge retrieve plan`, `knowledge retrieve search`,
`knowledge retrieve explain`, `knowledge retrieve run`, `knowledge retrieve packet`, and `knowledge retrieve citations`.
Their MCP equivalents are `retrieval.plan_validate`, `retrieval.search`, `retrieval.explain_run`,
`retrieval.read_run`, `retrieval.read_evidence_packet`, and `retrieval.replay_citations`. The search creates the canonical retrieval run;
the result is an immutable evidence packet. Save its `retrievalRunId`, packet ID, member IDs and
citation locators before answering.

```text
knowledge retrieve plan --context '<OperationContext>' --input '<RetrievalPlan>'
knowledge retrieve search --context '<OperationContext>' --input '<RetrievalPlan>'
knowledge retrieve explain --context '<OperationContext>' --input '{"runId":"<uuid>"}'
knowledge retrieve run --context '<OperationContext>' --input '{"runId":"<uuid>"}'
knowledge retrieve packet --context '<OperationContext>' --input '{"packetId":"<uuid>"}'
knowledge retrieve citations --context '<OperationContext>' --input '{"packetId":"<uuid>"}'
```

Use the accepted search operation ID as `runId` for the run read, then read the returned evidence
packet IDs. An accepted operation alone does not prove that a packet exists.

MCP calls carry the same plan under `input.plan` (or `input`) and an admitted request context; they
do not grant access. `retrieval.build_evidence_packet` exists in the MCP catalog for the packet
operation, but it does not make a caller a publisher or an authority to activate a space.

Inspect exact, FTS, semantic, graph, rerank, diversity, context, freshness, and filter stages separately. Treat context-only neighbors as context, never proof. Cite immutable locators and expose fit, non-fit, assurance, freshness, contradictions, graph paths, and score-stage explanations.

## Citation replay and revoked support

Replay a citation with `knowledge retrieve citations` or `retrieval.replay_citations`, supplying
only the retained `packetId`. The authenticated host resolves its stored representation, byte
digest and exact selector; never supply replacement bytes or a storage address. Check the returned
packet digest, selected-content digests, and every replay failure before citing the result. A later retrieval
must omit support that is revoked or no longer admitted; it may abstain rather than return a stale
fact.

Request more evidence only within declared bounds. Abstain when coverage is insufficient, identifiers conflict, evidence is unauthorized, or a locator cannot replay. Never infer the existence or count of inaccessible records, bypass tenant filters, query raw vectors/SQL, or turn a retrieval result into a publication decision.
