# Skills

This directory is the source of truth for the six versioned Knowledge Services skills listed in `manifest.json`. Consumers pin a released version and may add runtime-specific wrapper instructions, but must not fork authority, evidence, tenant, or publication semantics.

Every skill uses the public v1 HTTP/client or bounded MCP surface. None authorizes raw SQL, secrets, private bucket listing, direct vector writes, self-approval, or publication.

`knowledge-verification` covers admitted verification through the `knowledge` CLI and `knowledge_verify_*` MCP tools (claims, citations, extraction, report, benchmark, replay, adjudication).
