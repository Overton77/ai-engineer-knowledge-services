# SW-04 human review v2 remediation

The v1 review package remains historical and is not modified. Version 2 recomputes the pack digest on import, requires exact candidate/fragment/source/projection/selector custody binding, validates ISO submission timestamps, and derives submitted annotations only through an offline HTML export.

The v2 generator stages all three files in a unique sibling directory and renames it only after all writes complete. It refuses evidence over the D-013-authorized 2,000 UTF-16-character local-review limit rather than truncating it. This permits the frozen 1,235-character excerpts without hiding evidence.

HTML submission payloads record a reviewer-provided identity and qualification plus current timestamp. They do not establish that the identity belongs to a human; an authenticated operator attestation is still required at the eventual import boundary. Labels remain blank by default.

The immutable v2 catalog was generated with 180 blank candidates: pack SHA-256 `61e8523a1c7a135bd3ccf617010b87921e11a3aed627bf2adff01f6ce8c07ebf`, HTML SHA-256 `978bf7a8a27875b16d2fc4010fac68f4adc6ac8fa935991e2e1d9625b8f7a4c4`, template SHA-256 `b3610d359ba99048d24e93ffb7a7916767bf9ceeb0d750242d61999dc5c4294`. `internal/verification-human-review-v2-synthetic-submission.json` is a non-human synthetic browser-export fixture and must never be imported as a human annotation.
