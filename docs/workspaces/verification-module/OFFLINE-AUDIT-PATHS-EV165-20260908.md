# Verification audit paths

## EV-165 - executed audit paths - 2026-09-08

The installed offline audit retains the actual corrupted HTML selector and its native EVIDENCE_RESOLUTION_FAILED rejection. A separate publication-eligibility policy replay abstains with UNKNOWN_CRITICAL_FACTS for pace-definition-source. This preserves the captured semantic verdict and is neither publication nor a human-gold correctness claim. Existing internal policy decisions remain 25 review / 13 fail.

Retained proof: internal/verification-offline-demo-EV165-audit-paths-20260908.json, SHA256 3faf8218e8185e2798e5e2272ee97db04087bee283820c4453125d5ddd195d68. Networking disabled, zero provider calls, 30,913 ms, expected exit 2, 33 files, 19 field leaves, 40 native claims, 3 reports, 38 claim semantic replays and 29 report diagnostics. No acceptance promotion: 31 proved / 8 partial / 7 missing.

Validation: 20 of 21 relevant tests passed initially; the lone stale audit-string expectation was corrected and its exact frozen-v1 target passed. Final policy suite 5/5 and application build passed, including the post-proof invalid-purpose guard. The mutation-report synthetic selector fixture was corrected for the added required selector field. Accidental CRCRLF source newlines were normalized without altering prior sealed snapshots.

Remaining engineering includes the two v1 semantic cases whose earlier provider outputs failed strict schema consistency, full provider/structured coverage and final quality acceptance. A new two-case scope preserves exact original case objects, validates all 40 dataset records first, excludes all 38 successful cases and reserves at most 10,000 micro USD for two calls. Scope proof passed offline; no new provider calls yet. Human review remains deferred. Previously completed remote migrations, Cloud/Cursor lifecycle and dashboard evidence need not be repeated.
