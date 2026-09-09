# VR001 single-algorithm-owner audit

Date: 2026-09-08. This is a bounded current-source audit, not a claim that all
historical copies or all SHA-256 calls in the workspace are eliminated.

## Scope and method

Read-only `rg` audits covered active source and package edges in Knowledge
Services, research ingestion, Mission Control/dashboard, Cursor/Eve-facing agent
code, the application, and dashboard. Tests, fixtures, `internal`, `dist`,
`.turbo`, and dependencies were excluded. Searches covered selector resolution,
bundle/evidence verification, arithmetic replay, normalization, and SHA helpers.

## Findings

- The active deterministic selector, decimal replay, and bundle algorithms are
  owned by `ai-engineer-knowledge-services/packages/verification/src`.
- `research_ingestion_systems_agent/packages/verification-core/src/index.ts` is
  a facade only: it imports KS compatibility APIs, validates the legacy schemas,
  and has no local selector, arithmetic, evidence, or hash algorithm.
- The only active legacy experiment consumers are `source-attribution-lab` and
  `mission-intake-lab`; both import that facade. Root's supplied consumer
  typecheck receipt reports both successful.
- Mission Control/dashboard has no active legacy locator or bundle-verifier
  implementation. Its SHA-256 uses are workflow/idempotency, serialized-history,
  or token-digest helpers, not selector or evidence-verification algorithms.
- The Eve runtime has a local sorted-JSON plus SHA-256 helper for matching an
  authenticated grant request. This is transport identity logic, not a
  deterministic evidence/selector owner; it must not be treated as an equivalent
  provenance or verification algorithm.
- `interfaze-lab` and mission-intake SHA helpers are unrelated schema/id helpers.

The audit therefore supports the limited VR001 conclusion: there is one active
owner for the migrated legacy verification mechanics, KS compatibility APIs. It
does not prove universal canonical-hash ownership across unrelated transports.

## Inputs and machine receipts

Root verification input `internal/verification-prototype-final-root-tests-20260908.json`
SHA-256: `7a6e3b81594eb835eb736ba0e9c1492a5e02d385fabc5387166224b15480f70c`.

Consumer typecheck input
`internal/verification-prototype-consumer-typechecks-20260908.json` SHA-256:
`51806f8f7f2987e3c34a30011db0ea7b279b5f623146dfd72f10f496e55a3735`.

Rollback for the compatibility facade remains the immutable snapshot and path
recorded in `VR033-PROTOTYPE-CUTOVER-COMPLETION-RECEIPT.md`; this audit changes
no production code.
