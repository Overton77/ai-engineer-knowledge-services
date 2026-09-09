# CPH registration successor review — 2026-09-08

The corrected registrar now pins `recordedAt`, uses conflict-safe inserts with stored checks, requires the canonical report receipt kind, checks expected artifact types, and parses exact workflow proof identities. Two narrow stale-row integrity checks remain: compare the existing dataset row's derived slug/purpose exactly, and compare the experiment's full derived name/hypothesis exactly instead of only an `endsWith` suffix. Registration was not executed, so no rerun stability claim is made.

Receipt: `internal/verification-cph-registration-successor-review-20260908.json`.
