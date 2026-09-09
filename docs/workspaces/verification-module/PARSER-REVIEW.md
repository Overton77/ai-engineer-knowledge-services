# Independent WS-04 native parser review

## Decision

Accept the coordinator-authored native PDF/HTML parser as a bounded WS-04 component after the deadline fix below. This decision covers the immutable image and source versions listed here. It does not accept image/OCR, repository, dataset, API, transcript, media, office-document, or general provider routes, and it is not a full WS-04 completion decision.

## Review findings

The TypeScript adapter verifies the caller bytes against the expected parent digest before process creation. It invokes a deployment-selected immutable image by digest with no network, a read-only root filesystem, no mounts, an unprivileged user, 512 MiB memory, one CPU, a 64 MiB temporary filesystem, 32 PIDs, and fixed input/output/page limits. The Python process additionally enforces a 15-second soft and 16-second hard CPU limit, 40 pages, 8 MiB input, and 4 MiB output. Each invocation receives a unique container name and cleanup is attempted on success, rejection, cancellation, and timeout.

Two defects were found and fixed in `packages/conversion/src/verification-parser.ts`. The phase deadline helper previously returned at least one millisecond after the shared 45-second execution budget had expired, so a later Docker phase could still be launched; it now throws `PARSER_TIMEOUT` before launching that phase. Cleanup also previously masked a Docker failure before container creation as `PARSER_SANDBOX_CLEANUP_FAILED`; the adapter now preserves the original pre-create failure while still attempting cleanup, and continues to require successful cleanup once creation is confirmed. The service README states the measured boundary accurately: create/start/inspect/output share the 45-second execution deadline, while best-effort cleanup has its own 10-second bound. The review does not claim that cleanup is always contained inside 45 seconds.

The raw parser result remains untrusted `unknown` data. Strict projection shape, parser identity, options identity, source binding, residual, and lineage admission is performed by the application described in `HANDOFF-WS-04-ADMISSION.md`.

The acquisition dependency was also inspected independently. Its single abort controller and deadline race cover DNS completion, fetch headers, redirects, and body reads; it checks the signal after DNS before fetch, cancels a stalled body, and does not store a response after timeout. The three focused deadline tests pass. DNS planning and artifact-store latency remain separate boundaries.

The exported `DEFAULT_EXTRACTION_SCHEMA_LIMITS` initializer was inspected after the coordinator follow-up and is frozen with `Object.freeze`, so a caller cannot mutate shared hard-cap defaults at runtime.

## Independent adverse evidence

`node scripts/prove-verification-parser-review.mjs` used the production image and independently confirmed:

- exact local image identity `sha256:9dff779c9d5df3b80876b1017da24befdd241bdc28950e084c504e158e08c906`;
- network access is unavailable;
- a write to `/var/tmp` fails with read-only-filesystem error 30;
- cancellation of an active real 24-page PDF parse returns in about 1.3 seconds;
- a synthetic 41-page input is rejected; and
- no review container remains.

Evidence: `../../../../internal/verification-parser-independent-review-20260905-621bfb7b-4baf-4a53-a5f0-20e0c20d938b.json`, SHA-256 `9f6fbb862e0c9849e32fb1fbbf5942f5b1778bab7f38e4df81083ec7c75d312e`. Conversion tests pass 10/10, including the pre-create error-preservation regression.

The implementation-owner EV-016 receipts cover the remaining memory, temporary-disk, CPU-hard-limit, malformed-input, HTML hidden-content, and 45-second stalled-container cases. This review matched the service source, dependency, Dockerfile, and image identities and independently repeated the meaningful network, filesystem, cancellation, and page-limit cases rather than treating owner receipts alone as acceptance.

Final reviewed hashes:

- `packages/conversion/src/verification-parser.ts`: `9b4570752636995388b6af2825a0b22db5a8f83d695ac04aed7f06cf78d4e42d`;
- `services/verification-parser/parser.py`: `2a33168d2c3067b05a44d29794612e54d2f87e7eed8051ed17b07491444d33ef`;
- `services/verification-parser/requirements.txt`: `ed1e535a6b004f1c399ea6308b71b518475395b4fc1225baada46baf9d82bbcb`;
- `services/verification-parser/Dockerfile`: `b37dab8b43ddd28dbe35cdbf989c02aadfebb1c5ef4b89e342c0fbe3b5e301e5`.

## Residual scope

HTML computed layout, external CSS/JavaScript, and browser execution are explicitly residual. PDF graphs, diagrams, and visual-only values remain residual even when the page has a text layer. The parser supports local native PDF and UTF-8 HTML bytes only. The Docker daemon and deployment configuration are trusted operational inputs. Pinned Python versions do not establish wheel hashes, an SBOM, or supply-chain signatures. Remote production deployment and production timeout behavior have not been proved.
