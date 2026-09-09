# WS-01/02 foundation handoff

**State:** ready for coordinator review; acceptance is not claimed.  
**Implementation owner:** verification-foundation-agent  
**Date:** 2026-09-05

## Delivered boundary

WS-01 adds `verification.v1` schemas beneath the existing service `contractVersion: "v1"` envelope. Captures contain registered, content-addressed artifact handles and never inline source content. The contract covers sources/captures/artifacts/lineage, all specified selector families, assertions and metric observations, evidence edges, append-only judgments with five orthogonal properties, deterministic results, operation receipts/events/errors, run manifests, and frozen benchmark/compare inputs. Contract generation now emits standalone JSON Schema and OpenAPI components for the verification surface.

WS-02 adds the private `@aiengineer/knowledge-verification` package and a pure deterministic facade. It has one workspace dependency, `@aiengineer/knowledge-contracts`, and no provider, database, environment, transport, or network code. It verifies hydrated bytes against registered digest and length, requires projection parent/signature binding, resolves text/position/multi-fragment/JSON Pointer selectors, validates injected admitted-resolver outputs against capture/artifact/selector/selected-byte hashes, binds metric facets to selected source bytes, replays exact decimal calculations through verified observation IDs, rejects dependency cycles, and makes semantic eligibility false on every deterministic failure or review state.

## Stable interfaces for dependent workstreams

- `verifyDeterministicBundle(input, options)` is the core entry point.
- `DeterministicVerificationInput` carries a `VerificationBundle`, hydrated artifact bytes, and `RuntimePrincipalBinding` supplied by trusted application composition. Caller strings alone are not treated as authenticated deployment identity.
- `DeterministicSelectorResolver` is the WS-04 extension port. Its output must bind capture ID, representation artifact ID/digest, canonical selector digest, resolver version, and selected bytes. The core recomputes selected-byte hashes. Built-ins cover `text_quote`, `character_position`, `multi_fragment_text`, and `json_pointer`.
- `DeterministicVerificationResult.semanticEligibility` is the only deterministic gate to later semantic stages. `deploymentSeparation.status` reports whether runtime-bound producer/verifier IDs and principal digests establish separation.
- `canonicalizeJson`, `digestCanonicalJson`, and `sha256Digest` provide RFC 8785/signable JSON and canonical `sha256:<hex>` representation. `fromPrototypeSha256` and `toPrototypeSha256` are the explicit compatibility boundary for legacy bare hex.
- Verification contracts and their stable types/schemas are re-exported by the package facade for first-party composition. Cross-repository callers still use future WS-08 HTTP/client/CLI/MCP surfaces.

## Compatibility and review closure

The prototype repository was not changed. Its 5/5 baseline remains preserved. The new frozen fixtures retain the same exact-quote pass, offset-drift failure, lossy-normalization review, same-deployment failure, and metric-arithmetic pass outcomes while closing the prototype's direct-metric source-binding gap. Golden result digests make drift explicit.

Coordinator findings F-01 through F-12 have implementation regressions recorded in `FOUNDATION-REVIEW.md`. F-02 is closed at the transport taxonomy layer; canonical DB enum/migration mapping remains WS-03. Trusted runtime principal resolution remains WS-08. Selector implementations beyond text/JSON remain WS-04. Assertion decomposition and semantic/authority judgments remain WS-05.

## Evidence

The authoritative commands, exact results, log locations, SHA-256 hashes, frozen fixture hash, and result digests are recorded in EV-007 through EV-009 in `EVIDENCE-LOG.md`.

- Contracts: generation exit 0; typecheck exit 0; 20/20 tests.
- Deterministic core: typecheck/build exit 0; 16/16 tests.
- Independent selector probe: exit 0 for astral and CRLF regression cases.
- Full monorepo: `corepack pnpm verify` exit 0; typecheck 41/41, test 41/41, build 24/24.

## Deliberately open work

No provider, persistence, semantic judgment, policy admission, benchmark runner/statistics, application orchestration, HTTP/client/CLI/MCP, worker, or dashboard implementation is included. Artifact authorization/tenant registration and trusted principal resolution must happen before calling the pure core. Non-text/JSON selectors remain ineligible until WS-04 supplies admitted deterministic resolvers. Human or model semantics may add restrictions after `semanticEligibility: true`; they cannot reverse a mechanical failure.
