# Portable generated-report semantic fixture audit — 2026-09-08

## Verdict

The portable loader is structurally suitable for an offline replay fixture, with a qualified custody boundary. It does not perform provider/network access. The replay adapter supplies a local `fetch` over retained raw bytes and uses an offline artifact sink (`packages/application/src/verification-diagnostics-generated-report-semantic-fixture.ts:71` onward).

## Verified controls

- Manifest schema is strict, bounded, and fixture-digest sealed. The seal covers the manifest with `fixtureDigest` removed (`:7-18`, `:48-51`).
- The manifest is pinned to the freshly prepared plan's dataset digest, original run manifest digest, plan digest, complete plan value, and entry count (`:51-52`). This preserves original run identity and prevents replay against a different prepared plan.
- Artifact paths are confined below the fixture root; symlinks and non-regular files are rejected, and each file's byte length and SHA-256 are checked (`:28-32`). Filename convention binds artifact kind and digest.
- Duplicate entry digests and duplicate artifact kind/digest/file identities are rejected; every declared artifact must be referenced by a plan record (`:52-54`, `:64-65`).
- Each record is bound positionally and by entry/report/assertion identity to the prepared plan. Request bytes are regenerated and compared byte-for-byte with the retained request; raw response and judge output are decoded and observation-revalidated (`:54-63`).
- Replay is bound through a private `WeakMap` to the exact prepared object and plan digest, and completes only when every entry succeeds with zero external requests (`:68-71`).

## Qualification

The fixture itself contains request, raw-response, and judge-output artifacts, but not private source capture bytes. Source/projection custody therefore remains a precondition supplied by the freshly prepared plan and EV162 preparation path; this loader does not independently hydrate or re-check the private capture registry. That is compatible with a portable semantic replay fixture, but the fixture must not be treated as a standalone source-custody proof. No retained fixture files were present locally to audit beyond the loader contract, so no fixture digest or case-count claim is made here.

The loader's strict plan equality and artifact closure prevent replay substitution, while the remaining source custody is deliberately delegated to the caller's authenticated preparation. This is the only material limitation found in the bounded review.
