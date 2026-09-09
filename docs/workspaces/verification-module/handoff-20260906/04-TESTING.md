# Required tests and proof design

## Known passing boundary at handoff

EV-090:6 actual post-publication/pre-terminal SIGKILL cases,30 checks,44-artifact/17-source audit. EV-091:2 actual dispatch/pre-response SIGKILL cases,6 checks, no redispatch and unknown liability retained. EV-092: signed reconciliation admission negatives. EV-093: failed/cancelled missing-response settlement, rollback/concurrency/role/immutability and visible overrun with future reservation rejection. EV-094:4 success/captured-failure settlements with original publication/receipt/operation/HTTP-read equality. EV-095:4 historical expired decision reads,16 grouped checks including no mutation permit, tenant scope, evidence corruption and query-result drift. EV-096:4 actual HTTP settlements/reads,24 grouped checks and native audit. EV-097: same scope via built CLI and MCP Streamable HTTP,24 grouped checks and native audit. See individual review files for exact limitations.

## Next crash/cancellation matrix

| Window | Required observation | Recovery/cancellation assertion |
|---|---|---|
|Before reservation|Execution/profile identity already bound or explicit rejected state|No supplier call, no liability, no phantom capture.|
|Reserved before dispatch|Original reservation row and live lease|No duplicate reservation; explicit cancel/release behavior proved.|
|After dispatch before response|Original dispatch identity; actual child exit|Existing EV-091 baseline: uncertain retained liability, no redispatch. Add cancellation race assertions.|
|Raw bytes registered before response-capture checkpoint|Actual retained artifact IDs and native registration|Recover only admitted original evidence; no orphan masquerading as complete capture.|
|Capture committed before accounting update|Native status/envelope/raw binding|Use retained response; settle known usage exactly once or retain uncertainty.|
|Accounting committed before interpretation|Budget and provider row|Do not double-settle on replacement.|
|Candidate registered before provenance/lifecycle retention|Partial CAS/native rows|Recover exact candidate/provenance safely or fail with retained history; never silently regenerate another provider output.|
|Retention begun before publication|Lifecycle status, timestamps, artifact set|No forged complete publication; prove idempotent resume or explicit terminal failure.|
|Publication before terminal receipt|Existing EV-090 baseline|One terminal receipt/outbox/event; original signed bytes and higher replacement fence.|
|Cancellation at each window|Actual public/canonical cancellation and worker observation|No post-cancel ordinary authority; unknown costs remain reconcilable through separate operator path.|

For each meaningful case retain before/after operation,step,lease,provider,budget,lifecycle,capture,publication,receipt/event/outbox and artifact records. Count external dispatches independently. Wait for actual child exit, then natural lease expiry. A timeout of the observing tool is not evidence of worker death. An injected transaction exception is useful for rollback but does not prove OS process-loss recovery.

## Extraction and semantic acceptance tests

- Each admitted selector family: golden exact matches, zero/multiple cardinality, repeated excerpts, Unicode/newlines, changed capture/projection, coordinate boundaries, unsupported routes and adversarial source text. Test actual admitted parser routes for HTML/text/JSON/PDF/image/tables/media/repository/datasets rather than claiming the entire union.
- Each accepted leaf: value, normalization/derivation, exact selected fragment and complete native lineage. Arrays/dynamic keys need complete coverage, duplicate/missing index checks and bounded schema expansion. Failure must not produce an accepted candidate.
- Claims/reports: qualifier/negation preservation, exact offsets, reconstruction and selection recall, unsupported/topically-related evidence, contradictions, citation correctness versus completeness, source authority versus world truth, first-party promotion and paper-to-product applicability.
- Evidence-closed semantics: prohibited network/tools, prompt injection in source/provider metadata, independent verifier principal, no override of deterministic failures, bounded output, model/version drift and abstention. Use actual approved gold before quality claims.
- Faithfulness: source ablation/replacement, citation permutation and influence sensitivity. A plausible citation is not sufficient proof of causal grounding.
- Human review: authorization, reviewer conflicts, original evidence/time/version binding, immutable adjudication, later decision coexistence and audit access.

## Accounting/authority extensions

Latest reconciliation proof covers synthetic accepted/HTTP-failure, and earlier proof covers failed/cancelled missing response. Still verify deployment/credential role permissions, real operator configuration, authentic supplier evidence and remaining race/outage cases. Tests should ensure unknown/expired/wrong-issuer/wrong-mission/wrong-provider decisions cannot mutate; full handles and bytes match; actual overrun is not clipped; exact retries converge; conflicting decisions fail; ordinary executor cannot use reconciliation-only native branch; signatures do not grant data access. Historical reads must never mint mutation permits. Read key revocation behavior should be reviewed as an explicit operational policy.

## Benchmarks, reports and offline replay

Use frozen leakage groups and independent human labels. Report denominators, missing/excluded cases, clustered/paired uncertainty, repetitions, multiple comparisons, calibration/risk-coverage, worst material slices, cost/latency/stability and review burden. Adversarial name/algorithm/count/qualifier/citation swaps must degrade results monotonically. Reports require navigable exact assertion-to-fragment links, visible conflicts and medical/informational qualifications. Offline replay must use only exported immutable bytes and reproduce selector/hash/calculation/policy scope. Refresh must propose a new version and drift report without mutating old captures/results. Do not acquire gated reports by bypassing authentication or submitting terms/forms without actual user action.

## Security/consumer/UI/final tests

Use TEST-MATRIX.md's full layer inventory. Include cross-tenant RLS under actual roles, signed URL expiry, missing objects/collisions, SSRF/private-address/redirects, parser isolation, decompression and schema bombs, secret scans and retention/deletion controls. Exercise real Cloud/Cursor/EVE, not only mocks. Browser tests must inspect evidence navigation and control authorization; green API tests cannot establish dashboard acceptance. Final clean-environment audit checks canonical migrations/types/consumer pins and all specification deliverables, including operational shadow gates. Preserve failed proof evidence when it explains a corrective migration.

## Proof reporting convention

State what is real, simulated, injected, historical or human-reviewed. Grouped check counts are report keys, not test case counts. Record source and configuration digests, exact frozen dataset, command and exit, artifacts/signatures, independent audit, limitations and next gaps. Never promote a whole acceptance row solely because a narrow proof passed. Historical source hashes may no longer match after implementation changes; preserve the old evidence and create new evidence for changed code. Current handoff generation is documentation work and does not rerun the full engineering acceptance suite.
