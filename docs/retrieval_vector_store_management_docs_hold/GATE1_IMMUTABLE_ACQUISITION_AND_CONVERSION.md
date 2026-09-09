# Gate 1 — immutable acquisition and conversion evidence

Status: implementation proved; bounded live proof passed for exact HTTP and Firecrawl. Unstructured was not configured in the supplied environment, and its absence is recorded rather than masked.

Date: 2026-09-03 (America/New_York)

## Implemented routes

- Direct HTTP exact capture validates HTTP(S), port, host, literal/DNS addresses and every redirect hop; requests identity encoding; enforces time, byte, redirect and decompression bounds; redacts response credentials/cookies; and hashes the received bytes before transformation.
- Firecrawl uses a configured HTTPS endpoint and secret reference, separately validates the target against the egress policy, denies provider redirects, bounds/decompression-checks its response, removes credential-shaped fields and seals provider-native plus extracted artifacts.
- Manual upload accepts only a pre-registered upload ID and safe relative path, validates declared digest, type, byte bounds and the operator attestation, and leaves the result at candidate authority.
- Repository acquisition requires a full immutable commit SHA, validates the provider-resolved SHA, rejects traversal/symlinks/oversize archives, records source paths, license/lock/LFS/submodule observations and emits secret-like findings without storing secret values.
- Paper acquisition admits only normalized DOI, arXiv or OpenReview identifiers, requires the provider result to match that identity and records publication/correction/revision metadata separately from acquired representations.
- Local, in-memory and Supabase Storage adapters implement the same tenant-scoped content-addressed contract. Supabase objects use private bucket paths, `x-upsert: false`, bounded reads and post-download digest verification. Credentials exist only in the final adapter.
- Conversion routing records the deterministic candidate order, typed provider outcomes, selected admitted fallback and receipt digest. Provider error bodies and secret values are excluded.

## Bounded live evidence

Receipt: `catalog/gate1-live-evidence.json`

| Check | Result |
| --- | --- |
| Official source | LangChain documentation URL already approved by embedding bundle `kTnfJszFxCg` |
| Exact HTTP | Passed; 988,338 bytes sealed as `sha256:da879dc174374fbb4803a231dc7efbe4efb42b584876db57b5f77c7dd1aac785` |
| Firecrawl | Passed with HTTP 200; provider-native JSON, Markdown, HTML and raw HTML sealed; four artifact digests recorded in the receipt |
| Unstructured | `not_configured`; no API URL, key or template ID was present, so no live invocation was attempted |
| Managed fallback | Passed; typed `policy_denied` outcome followed by admitted local conversion; deterministic routing receipt `sha256:1f217cdfab9b8c00b15fbf5c606052d730a7984a329a763f8049cb61452c4f0f` |
| Supabase Storage | Adapter and security behavior proved with injected HTTP contract tests; no live object mutation was performed |
| Canonical publication | False |
| Receipt secret scan | Clean |

The live receipt digest is `sha256:3fb0be07fe8283559ec758441ee339eefce9f7b772b814c6dd32ee11098b8f26`. Live responses are not checked in; only safe digests, sizes, typed outcomes and verification checks are retained.

## Verification coverage

Deterministic tests cover authentication-reference matching, credential redaction, SSRF and special IP ranges, DNS/redirect revalidation, traversal and symlink rejection, request/result/upload/archive size bounds, decompression ratio, content-addressed idempotency and tamper detection, immutable repository commit identity, scholarly identifier normalization/mismatch, and deterministic managed-provider fallback.

The final repository verification passed 37/37 typecheck tasks, 37/37 test tasks and 22/22 builds. A direct aggregate Vitest run passed 29/29 files and 94/94 tests; the acquisition package contributes 14 focused tests.

Run:

```bash
corepack pnpm verify
corepack pnpm test:live:gate1
```

The live command reads secrets from the workspace `.env`, emits no secret values and writes only the safe exploratory receipt under `catalog/`.
