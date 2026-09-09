# Security regression evidence map

Run `node scripts/run-verification-security-regressions.mjs` from Knowledge Services after building its workspace dependencies. The runner executes six bounded test groups serially, retains their JSON reports/logs in a unique central `internal/verification-security-regressions-*` directory, hashes the exact selected test sources, and rejects failed or skipped tests. It does not read environment files or invoke providers intentionally; native infrastructure tests remain separate proofs.

The initial run passed **110 tests, zero skipped**. Receipt: `internal/verification-security-regressions-f4809cf4-5719-4f54-a6d5-d9a06191e4c2/receipt.json`. This is local regression evidence, not independent VR-028 acceptance or production deployment evidence.

| Boundary | Executable regression evidence | Additional evidence required |
| --- | --- | --- |
| Acquisition / SSRF | Acquisition tests reject forbidden addresses, redirect pivots, socket re-resolution, bad TLS name options, oversized bodies, decompression and deadlines. | Confirm actual runtime wiring and retained native acquisition proofs. |
| Hostile files | Parser admission rejects mutable image tags, input identity/size failures and pre-create runtime errors. | Current immutable-image Docker network, read-only, resource and cleanup proofs. |
| Source lineage / tenant custody | Admission tests reject source substitution and forged parser-derived envelopes; registered-artifact and fencing tests enforce immutable metadata and ownership. | Retained native Postgres/Storage tenant isolation, orphan/collision and parent-replay proofs. |
| Provider data policy | Public/synthetic classifications, explicit Interfaze ZDR, reservation ownership before dispatch, bounded transport and strict evidence-only output. | Actual configured provider capability/privacy policy and retained live safe fixtures; this suite makes no new paid call. |
| Decision / public HTTP | Exact ownership, reviewer preparation, canonical decision fencing, authorization before hydration and bounded public result routes. | Native recovery and combined signed dashboard proxy proofs; actual human grant/provenance still separate. |
| Dashboard / redaction | Separate dashboard DTO/proxy/body-bound/authentication tests and browser tests. | Current route inventory plus real signed-session proxy evidence, deployed configuration and human controls. |

The older `THREAT-MODEL-DRAFT.md` contains implementation-pending statements from September 5. Use its attack boundaries as a checklist, then bind current implementations to dated evidence above; do not treat those historical statements as a current status report. Final security review must explicitly reconcile remaining native and deployment gaps before changing VR-028.
