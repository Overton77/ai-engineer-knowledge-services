# SW-15.9.5 v1/v4 input identity mapping — 2026-09-08

The machine-readable mapping beside this ledger compares the frozen v1 catalog with pilot-v4 by canonical assertion text, selected fragment text, and selected-content digest. Requested-field profiles are included only when recoverable from a retained v4 field ledger; the frozen v1 catalog does not contain a provider request/field-plan artifact.

- v1 cases: 40; v4 cases: 43.
- Content identity matches: 21; of these, 20 have a retained v4 requested-field profile and 1 have no profile because only typed failure checkpoints are retained.
- v1 cases without a v4 content match: 19.
- v4 cases without a v1 content match: 22.
- Retained extraction provenance is the sealed pilot-v4 fixture sha256:6124fac14ef6b3c320c4a00c6efa57f6027adad1cbc88038af1762e7dbe04101; this mapping does not promote pilot-v4 records to v1 evidence.

A content match proves reusable assertion/fragment input identity only. It does not prove equal case IDs, input-manifest artifacts, source/projection custody, requested-field profiles, or v1 acceptance eligibility. The v1 requested-field profile and v1 provider checkpoint closures remain unavailable locally, so targeted replay reuse is limited to content-matched cases with an explicit provenance gap.
