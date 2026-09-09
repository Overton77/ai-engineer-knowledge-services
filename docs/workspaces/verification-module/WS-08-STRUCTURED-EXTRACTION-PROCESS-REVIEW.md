# Structured extraction public worker and process recovery

EV-090, coordinator review, 2026-09-06. This evidence joins public submission, configured worker execution, actual post-publication process death, canonical terminal completion and authenticated public reads. The full verification mission remains active.

The final proof creates six fresh operations through the typed client and actual loopback HTTP endpoint: Gateway and Interfaze, each with accepted output, HTTP failure and schema failure. Server-owned ownership grants bind the original mission/work item/attempt and deployment. Exact submission retries return the same operation. Nonterminal result reads fail closed.

Each operation first runs in its own hidden Node process using `--import` with the installed tsx loader. There is no intervening CLI wrapper process. The child uses the configured extraction factory, actual activity registry and canonical worker. Its explicit synthetic transport reports dispatch over local IPC; no supplier request is made. The worker retains the native source chain, response, candidate or failure, execution and signed publication. At the boundary immediately before `completeStep` or `failStructuredExtractionStep`, a test proxy reports the actual lease and waits.

The parent sends SIGKILL to that worker process and awaits its exit, asserting the reported signal. It verifies the operation remains running with no terminal receipt, then waits 2.2 seconds for the child's two-second lease to expire. It does not heartbeat or shorten the killed child's lease. A replacement canonical worker recovers the committed publication, completes under a later fencing token and performs no new dispatch. Final public reads return the original receipt output and compact custody reference. Completed operations cannot be claimed again.

The final proof has 30 checks, six synthetic dispatches, two succeeded operations and four failed operations, each with exactly one terminal receipt. Accepted calls settle at ten synthetic micro-units each. Four failures retain 100 reserved micro-units each as unknown liability; actual cost remains null and supplier billing is not claimed. A preliminary 24-check public-worker proof used the prior in-process stop injection and remains separately retained; its operations and accounting are historical, not the final six-case cohort.

The independent native audit hydrates 44 actual Storage objects, verifies canonical bytes, full metadata/handles, Ed25519 signatures and tamper rejection, execution/publication/failure native signatures and ancestry, and all 17 listed source files against retained bytes and current workspace hashes. It compares each public projection to the actual canonical receipt reconstructed by SQL and checks operation, step, event, outbox, released replacement lease and original provider accounting. Tenant isolation and raw receipt access denial remain intact. Process death is asserted by the parent's live child-process exit handling; the audit does not retroactively observe OS exits.

Evidence in parent `internal/`:

- `verification-structured-extraction-process-recovery-39188231-7bdd-435a-8df3-fe66f6421425.json`: SHA256 `e77f7c8241a9eb37d24f3fbdbebb0c141434bad629a9ff8822644c572d68365a`.
- `verification-structured-extraction-process-recovery-audit-20260906.json`: SHA256 `f555b7b42cfdffd93b64c1277fd91b8a70a46a043ea174769836f361669d0471`.
- Preliminary `verification-structured-extraction-public-worker-64a888ca-32be-4bf5-9148-e7089e0c3614.json`: SHA256 `87d9660d5dda586b7470ed2519523d12d825d1649d86c9821840c86ff0a0c2bb`.

Both new proof tsconfigs pass. No production package code, migration or dependency was changed in this session; EV-089's 72-task workspace result remains the applicable package validation. The new executable proofs and independent audit supply the additional evidence.

Reproduce from KS with `node ../internal/verification-run-local-proof.mjs structured-extraction-process-recovery`. Audit with helper mode `structured-extraction-process-recovery-audit` and `VERIFICATION_EXTRACTION_WORKER_RECEIPT` set to the final proof filename. Credentials come from local Supabase CLI status; never load the remote KS `.env`. Private signing material is transferred only in local IPC and is neither logged nor retained.

Limits: this is synthetic transport under explicit test composition, not production API bootstrap or supplier deployment. It proves the post-publication/pre-terminal crash window only. Dispatch without response capture, partial response/candidate retention, cancellation and separately authorized reconciliation remain required. Dynamic evidence arrays, semantic claims/report/adjudication, canonical cases/scores, disconnected replay, production security/authentication, runtime cutovers, dashboard, human review and final acceptance audit remain incomplete. No whole acceptance row is closed by this evidence.
