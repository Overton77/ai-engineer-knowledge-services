# Preparation MCP reference

## Executor MCP (`apps/verification-executor`)

- `source_prepare_captured` — pinned convert + chunk on an existing text/Markdown capture
- `content_link_plan` / `content_link_apply` / `content_link_receipt`
- `content_summary_prepare`

Hosts without `source_prepare_captured` reject it. Do not substitute a local converter.

## Platform MCP (`apps/mcp`)

- `document.convert` → `transformation`
- `chunk.preview` → `chunk_preview`
- `chunk.create_intent` → `chunk_set`
- `promotion.submit` / `promotion.status`

Unstructured Transform MCP and Firecrawl MCP are attached by the **agent host**, not nested inside `@aiengineer/knowledge-mcp`. After those skills run, import a receipt and convert stored bytes.
