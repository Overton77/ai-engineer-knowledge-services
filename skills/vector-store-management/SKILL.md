---
description: Use when creating or operating official, exploratory, or user-managed vector stores through Knowledge Services.
license: Proprietary
metadata:
  version: "1.0.0"
  contract: "knowledge-service/v1"
---

# Vector-store management

Choose the store class explicitly: `official`, `internal_exploratory`, or `user_managed`. Preserve its owner, tenant, visibility, lifecycle, purpose, retention, admitted domains, embedding profile, and publication authority. Never move content or identifiers across classes implicitly.

Use idempotent API or MCP operations to create a store, add exact document-version IDs, observe ingestion, search, evaluate, and reconcile. Propagate tenant, actor, reason, expected contract/capability versions, operation/attempt/work-item, correlation/causation, and external workflow run IDs. Retry ambiguous mutations only with the same idempotency key.

Agents may submit intents and proposals but cannot approve or publish. Only an eligible deterministic executor may materialize an approved guarded digest. Never write canonical tables or vectors directly, list private storage, submit raw SQL, reveal secrets, or treat `internal_exploratory` fixtures as canonical knowledge.
