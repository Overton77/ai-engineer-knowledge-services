---
description: Use when converting sealed captures, inspecting nodes, previewing admitted chunks, and submitting a promotion proposal.
license: Proprietary
metadata:
  version: "1.4.0"
  contract: "knowledge-service/v1"
---

# Knowledge preparation and promotion

Follow this loop without skipping a gate:

```text
you already have a sealed capture, or you imported a Firecrawl / Tavily / Unstructured receipt
→ inspect bytes (identity, media type, rights). Do not convert if identity or rights fail
→ convert stored bytes: text stays local; PDF goes Docling unless policy and budget allow Unstructured
→ inspect nodes and fidelity. If fidelity is low, alternate_conversion
→ select an admitted chunk profile. Preview. Require qa.valid
→ promotion propose. You do not publish
```

Inspect bytes is acquisition. Inspect nodes is preparation. Conversion success, a routing receipt, and a chunk preview are not admission. A seal is not admission.

## Conversion route we own

Knowledge Services converts **already stored** artifacts. It does not fetch a URL and it does not re-host Unstructured or Firecrawl MCP.

| Path | When |
|---|---|
| Deterministic text (`deterministic-structural-text@1.0.0`) | Markdown, VTT, plain text, JSON. Never call Docling or Unstructured. |
| Docling Serve (`docling-serve`) | Default binary fallback for PDF / Office / hard HTML. Costs the box, not a vendor invoice. |
| Unstructured Transform | Only when `managedProcessingAllowed` is true and budget says yes. Cite their [agent guide](https://docs.unstructured.io/agent-guide). |

The routing receipt records `candidateRoute`, typed `attempts`, `selectedProviderKey`, and `fallbackUsed`. Secrets never appear in the receipt. Runnable mocked copies: `packages/preparation/examples`.

Vendor MCP stays in the **agent** toolbox. After their skill runs, `source import` the self-reported receipt, then convert the stored markdown or native bytes. Do not wrap Transform inside `@aiengineer/knowledge-mcp`.

## Two binaries

| Surface | Binary | Convert / chunk |
|---|---|---|
| Executor | `knowledge` / `knowledge-verify` | `source prepare-captured` for existing plain text or Markdown captures only |
| Platform | `ks` (API client) | `ks knowledge document convert` (`transformation`), `ks knowledge chunk preview`, `ks knowledge chunk build` |

Hosts without `source_prepare_captured` reject it rather than substituting a local converter. Platform `document inspect` and `chunk inspect` are not admitted; inspect nodes from the conversion output or an executor read of sealed bytes.

Worked command bodies: [cli-reference.md](cli-reference.md), [mcp-reference.md](mcp-reference.md), [examples.md](examples.md).

## Prepare an existing text capture

When the trusted host exposes `source_prepare_captured`, prepare an existing native text capture
with the executor CLI `knowledge source prepare-captured <captureId> --title '<title>' --version '<version>'`
or the corresponding executor MCP operation. This reads the retained capture, validates its remote
custody, and runs the pinned conversion and chunk procedures. Keep the returned representation,
chunk-set and durable receipt identifiers. Repeating the exact request reconciles those receipts.
The operation supports plain text and Markdown captures; it does not acquire a new source or admit
the resulting representation. Independent representation review is still required before promotion.

## Chunk with an admitted profile

`chunkDocument` is the only writer of preview or persisted chunk spans for this pipeline. Select a named admitted profile (`heading-sections-v1`, `transcript-topics-v1`, `atomic-claims-v1`, `code-symbols-v1`, `table-row-groups-v1`, `tool-capabilities-v1`, `entity-facets-v1`). Preview requires `qa.valid`. Failed QA tries the next admitted profile or an alternate admitted converter. Do not invent a session-local splitter.

## Link content to canonical knowledge explicitly

Preparation does not link anything by itself. Canonical close-out is a typed `content-link-intent.v1`
applied through the executor distribution: `knowledge content plan <intent.json>` validates it
read-only against the pinned host, snapshot, admitted evidence and canonical targets;
`knowledge content apply <intent.json>` applies the admitted operations under an exact
knowledge-head lock and preserves the immutable intent, plan and receipt; a replay reconciles the
original receipt instead of writing again. `knowledge content receipt <receiptId>` re-authenticates
the retained bytes, intent authority, dependencies and the exact canonical row effects.

The seven operation kinds are `document.entity.link`, `chunk.entity.link`, `chunk.claim.link`,
`chunk.relationship.link`, `summary.materialize`, `summary.source.link` and
`projection.target.link`. Entities must exist before the claims and relationships that name them;
the intent pins `contract.migrationHead`, `contract.workspaceFingerprint`, `contract.policyDigest`,
the `inputSnapshot` artifact and `expectedKnowledgeHead`, and `onStale` is always `fail` — a stale
head means re-read and rebuild, never overwrite.

## A summary needs an independent review before it links

`knowledge content prepare-summary <operation.json>` renders exact admitted text with its retained
qualifications into a **pending** summary representation. Pending is the whole point: the current
admission of a representation is the latest independent guarded decision, not the label the row was
created with. A `summary.materialize` link requires an accepted independent representation review,
and `summary.source.link` must name the real source nodes the summary was derived from. You may not
review your own summary, and a summary that silently drops a qualifier is a defect rather than a
shorter summary.

## Budgets, exclusions and compact responses

State the budget before generating anything and keep membership inside it: exact selected content,
exact exclusions with reasons, and the estimate you reserved. Write previews and manifests to files
and carry handles (`receiptId`, `artifactId`, digests, counts) rather than pasting content. Charge
conversion, preview, linking and review work to the caller's budget and report usage; unknown usage
is unknown, never zero.

## Submit only the proposal and review operations

The platform CLI has `ks knowledge promotion propose`, `ks knowledge promotion review`, and
`ks knowledge promotion status`. The equivalent MCP catalog exposes `promotion.submit` and
`promotion.status`. A successful submission is an operation receipt, not selection, evaluation,
activation, or publication. There is no public `promotion select` command and no
`promotion_selection_select` MCP tool; do not substitute a capability catalog or an internal host
helper for either one.

```text
ks knowledge promotion propose --context '<OperationContext>' --input '<promotion proposal input>'
ks knowledge promotion review --context '<OperationContext>' --input '<promotion decision input>'
ks knowledge promotion status --context '<OperationContext>' --input '{"operationId":"<uuid>"}'
```

Keep proposer and reviewer identities distinct. Selection, evaluated publication, pointer activation,
revocation, and rollback are host-owned transitions; use the publication and retrieval procedures
only after an independently authorized host exposes their admitted operation.

Authored text and derived text must remain distinguishable. Preserve exact locators, attribution, representation lineage, procedure versions, warnings, and uncertainty. A revised proposal is append-only and uses a new guarded digest. Never approve your own proposal, publish a vector-space version, infer acceptance from processing success, or use arbitrary converter code.
