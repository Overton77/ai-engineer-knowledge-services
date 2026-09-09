# WS-04 parser implementation handoff

Coordinator authored; independent review pending. This is not a whole-workstream completion claim.

Owned files: `services/verification-parser/**`, `packages/conversion/src/verification-parser*`, narrow conversion facade export. The extraction agent owns separate verification extraction files. Root used existing horizontal conversion boundaries and did not add process access to the deterministic core.

## Delivered implementation

`SandboxedVerificationParser.parse({kind,bytes,parentDigest,signal?})` executes only an immutable deployment-selected image. It checks source bytes and digest before starting Docker, applies fixed container/process limits, records native output and transformation signatures, and removes each isolated job container. The Python route uses pdfplumber 0.11.9 and html5lib 1.1. Runtime image at proof: `sha256:9dff779c9d5df3b80876b1017da24befdd241bdc28950e084c504e158e08c906`.

Output projections intentionally remain `unknown[]` until strict canonical projection admission by the application. This is necessary because successful parsing is distinct from registered provenance. The next integration must register raw bytes, native output, canonical projection bytes and transformation edges through WS-03; it must not accept caller-authored metadata as trusted lineage. Actual repository commits, dataset versions, API pages, transcripts and provider projections need their own acquisition/admission proof; this route supports PDF/HTML only.

The integration reviewer must also exercise CAS reuse: artifact identity is tenant+byte digest while full producer/time/parent metadata is immutable. A second capture with identical bytes should reuse its existing registered handle, preserving the original metadata and recording the new capture separately. A byte-identical projection from a different parent may collide with immutable lineage; test and resolve this explicitly through an authenticated transformation/projection envelope or supported separate lineage record. Do not overwrite artifact metadata, invent provenance, or silently treat the first parent as the second. Existing replay invariants must remain intact.

## Actual proof and remaining review

- `../../../../internal/verification-parser-real-proof.mts`: parsed the real 4,019,343-byte, 24-page TruAge PDF and real TruDiagnostic HTML. Every returned projection passed `parseCanonicalProjection`. PDF physical page 2 preserves a visual residual. Wrong input digest and malformed PDF rejected.
- `../../../../internal/verification-parser-resource-proof.mjs`: independent child probes using the same pinned image/container restrictions confirmed network unreachable, root writes denied, address-space rejection, temporary filesystem full, and CPU hard-limit kill (exit 137 at about 16.5 seconds). The first CPU harness incorrectly expected only SIGXCPU/152; its log is retained and the corrected probe explicitly accepts the observed hard-limit path.
- `../../../../internal/verification-parser-boundary-proof.mts`: synthetic 41-page PDF rejected, active real-PDF cancellation propagated, no remaining job containers, parsed mixed HTML text preserved source order and hidden content failed selection.
- Conversion package tests: 9/9, including pre-process identity/size/image checks; typecheck passed during implementation.

Native PDF/HTML outputs and real source bytes remain restricted outside the repository. No patient-specific recommendation or medical interpretation is produced. HTML computed layout and PDF visual/graph values are explicitly unassessed. An independently authored review must inspect limits, error/cancellation paths, strict output admission, code/image identity, and end-to-end persistent lineage before acceptance. Supply-chain dependency artifact hashes and production deployment remain unproved at this handoff.

## Completed evidence hashes

- `../../../../internal/verification-parser-real-proof-20260905.json`: `106cb460cbdf993f1fc4bf0ec9c68652bba8d67be8759c42d04d7e8ace6a1150`.
- `../../../../internal/verification-parser-resource-proof-20260905.json`: `35af1e2613e9cf7f982c5dc4356ab2cd42890aff731d4784ca325c7c6d275834`.
- `../../../../internal/verification-parser-boundary-proof-20260905.json`: `6ecba90f93208224a2003f99a09dc6d11bdf2bef851b93cbd8c2b8c89fd940f4`.
- `../../../../internal/verification-parser-conversion-tests-20260905.log`: `b80e0a008b4a2205276a48fd003cae2c248cdd5ec842a9b30ebd89e28ccfa0b0`.

## Wall-clock deadline proof

`../../../../internal/verification-parser-timeout-proof.mts` runs the production TypeScript adapter against a deliberately stalled harness-only image, records `PARSER_TIMEOUT` after 45,304 ms including cleanup, and confirms no job container remains. The production parser image is unchanged. Fixture image: `sha256:dabe39c032a423334ec1198872666fee173554b3fd5f4d7ee7e780c3ba3cec6f`.
- `../internal/verification-parser-timeout-proof-20260905.json`: `c1de298639d445c00c40985db680f854837b31d644618b83cf6b926c4b827134`.
- `../internal/verification-parser-typecheck-20260905.log`: `f8bf1dfef684df77848b6ce6954ba9c59ad569679b4385cdbe3066463249561a`.
- `packages/conversion/src/verification-parser.ts`: `665ba7a0f108e5ebba2d06b3daf089d587d39d43c42241b8c385b153b46e6fbd`.
- `services/verification-parser/parser.py`: `2a33168d2c3067b05a44d29794612e54d2f87e7eed8051ed17b07491444d33ef`.
- `services/verification-parser/requirements.txt`: `ed1e535a6b004f1c399ea6308b71b518475395b4fc1225baada46baf9d82bbcb`.

## Refined operational probes

The r3 root-filesystem probe attempts a write to normally world-writable `/var/tmp` and requires EROFS (30), proving read-only enforcement rather than relying on ordinary user permissions. The r2 boundary probe measures cancellation plus cleanup separately from the subsequent HTML test: 1,506 ms. Original completed receipts remain byte-identical; these refinements have separate receipts.

- `../../../../internal/verification-parser-resource-proof-20260905-r3.json`: `c1b58884f1e04b7bdcdbdf9b3b19a282cecf781415adbbc21b61090f03aafa18`.
- `../../../../internal/verification-parser-boundary-proof-20260905-r2.json`: `da49593d8153c5699e961156500da41cae389036b82ccc9755756c129196e30f`.
