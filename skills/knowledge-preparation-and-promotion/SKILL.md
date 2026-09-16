---
description: Use when converting vetted sources, comparing representations, designing chunks or projections, and submitting a promotion proposal.
license: Proprietary
metadata:
  version: "1.2.0"
  contract: "knowledge-service/v1"
---

# Knowledge preparation and promotion

Follow this loop without skipping a gate:

```text
establish source identity
→ fetch only what is necessary to vet
→ inspect source/capture quality and risks
→ convert with a pinned admitted adapter
→ inspect or compare representations
→ identify useful canonical knowledge and faithful evidence
→ select admitted domain, chunk and projection procedures
→ preview and inspect chunks/projections
→ state expected users, queries, benefits, limitations and exclusions
→ submit an immutable proposal
→ submit the proposal or review decision through the admitted platform command
→ stop at the authority boundary
```

## Link content to canonical knowledge explicitly

When the trusted host exposes `source_prepare_captured`, prepare an existing native text capture
with the executor CLI `knowledge source prepare-captured <captureId> --title '<title>' --version '<version>'`
or the corresponding executor MCP operation. This reads the retained capture, validates its remote
custody, and runs the pinned conversion and chunk procedures. Keep the returned representation,
chunk-set and durable receipt identifiers. Repeating the exact request reconciles those receipts.
The operation supports plain text and Markdown captures; it does not acquire a new source or admit
the resulting representation. Independent representation review is still required before promotion.
Hosts without this capability reject the operation rather than substituting a local converter.

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

The platform CLI has `knowledge promotion propose`, `knowledge promotion review`, and
`knowledge promotion status`. The equivalent MCP catalog exposes `promotion.submit` and
`promotion.status`. A successful submission is an operation receipt, not selection, evaluation,
activation, or publication. There is no public `promotion select` command and no
`promotion_selection_select` MCP tool; do not substitute a capability catalog or an internal host
helper for either one.

```text
knowledge promotion propose --context '<OperationContext>' --input '<promotion proposal input>'
knowledge promotion review --context '<OperationContext>' --input '<promotion decision input>'
knowledge promotion status --context '<OperationContext>' --input '{"operationId":"<uuid>"}'
```

Keep proposer and reviewer identities distinct. Selection, evaluated publication, pointer activation,
revocation, and rollback are host-owned transitions; use the publication and retrieval procedures
only after an independently authorized host exposes their admitted operation.

Authored text and derived text must remain distinguishable. Preserve exact locators, attribution, representation lineage, procedure versions, warnings, and uncertainty. A revised proposal is append-only and uses a new guarded digest. Never approve your own proposal, publish a vector-space version, infer acceptance from processing success, or use arbitrary converter code.
