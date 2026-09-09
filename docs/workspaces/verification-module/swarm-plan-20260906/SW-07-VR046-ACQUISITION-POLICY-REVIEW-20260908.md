# VR-046 frozen acquisition policy review

This bounded local review evaluates only the VR-046 rule for the frozen
`diagnostics-companies-v1` source manifest: a gated sample report must remain
unavailable unless an authenticated user performs the required access action.
It does not alter the acceptance matrix or authorize acquisition.

## Evidence

- Specification §15.9.1 explicitly prohibits bypassing authentication,
  automating email capture, or accepting terms for a gated report.
- The frozen source ledger has 16 entries and source-preparation digest
  `sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e`.
  Its only sample-report entry is the anonymously reachable
  `tru-sample-report` PDF. It has no Generation Lab sample-report entry.
- `SOURCE-CAPTURE-NOTES.md` records the exact distinction: the Tru PDF could be
  captured anonymously from its referring page, while Generation Lab
  sample-report links point to a form anchor and no form was submitted or gate
  bypassed.
- The server-owned `TrustedVerificationSourceAcquirer` performs only a fixed
  `GET`, with fixed `Accept`, identity encoding, and user-agent headers. It has
  no caller-provided authentication, cookie, form, terms-acceptance, or method
  control.
- A new focused negative test passes those controls from an untyped caller and
  proves they are rejected as `SOURCE_ACQUISITION_REQUEST_INVALID` before catalog
  lookup or transport invocation. The focused suite passed 5/5.

The executable audit
`internal/audit-verification-acquisition-policy-vr046.mjs` rereads those files
and writes the machine receipt
`internal/verification-acquisition-policy-vr046-da5a20ba-0227-45c1-a3ab-075fc8df8254.json`.
All eight checks passed. The receipt retains file hashes, the frozen public PDF
handle/digest, and zero acquisition network calls, user actions, provider calls,
or persisted captures.

The earlier `728ee9ef` receipt is retained as a pre-TypeScript-fix record and is
superseded by the `da5a20ba` receipt above.

## Conclusion

For the present frozen v1 manifest, the implementation and retained source
evidence establish the intended refusal boundary: a gated Generation Lab report
is neither an admitted source nor reachable through caller-supplied credentials,
form fields, terms acceptance, headers, or a POST override. A future supported
authenticated-user acquisition path would require separate authority, terms, and
catalog evidence; this review does not invent one. Matrix status is intentionally
unchanged pending the coordinator’s acceptance decision.
