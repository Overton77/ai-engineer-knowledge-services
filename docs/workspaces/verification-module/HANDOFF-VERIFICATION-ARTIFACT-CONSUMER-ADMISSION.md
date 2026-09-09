# Verification artifact consumer admission handoff

Bounded database-owner handoff for the downstream half of the shared-bucket compatibility correction. This slice adds consumer-side admission after the coordinator-owned artifact marker/backfill migration. It does not apply a database migration, alter provider/runtime code, or claim remote rollout.

## Boundary and inspected writers

The additive canonical migration is `20260906021000_verification_artifact_consumer_admission.sql`. It uses the marker and immutable metadata established by `20260906020000_verification_artifact_contract_marker.sql`; it does not duplicate storage access or parse artifact bodies in SQL.

The exact type rules follow current writers and schema fields:

- verification runs bind `verification_policy` and `verification_run_manifest` by stored digest, plus `verification_bundle` and `deterministic_verification_result` by exact type;
- v1 dataset versions bind `evaluation_dataset_manifest` by digest;
- case inputs bind `evaluation_case_input`; synthetic and agent-generated dataset versions bind their legacy-named `gold_artifact_id` to the current engineering-expectation type `evaluation_case_input`, while human-reviewed and human-adjudicated versions bind it to `evaluation_gold_label`;
- evaluation labels, grader versions, experiment arms, and scores bind `evaluation_gold_label`, `grader_manifest`, `evaluation_arm_manifest`, and `deterministic_verification_result` respectively, using their stored digest columns;
- v1 evaluation runs bind `verification_run_manifest` and `verification_policy`;
- every provider attempt requires a `verification_provider_request` bound by request digest. A response must be a `verification_provider_response_envelope` whose immutable parent array is exactly ordered `[that request, an admitted verification_provider_raw_response]`;
- v1 source captures bind `source_capture` by digest and media type; v1 locators require admitted capture and representation artifacts plus the exact metadata-consistent generated edge from representation to capture.

The dataset label-provenance branch authenticates which artifact vocabulary is legal. It does not establish that a human actually reviewed a label; that fact still requires the review record and hydrated artifact evidence.

## Admission behavior

`orchestration.verification_artifact_is_admitted` returns true only when the referenced row is same-tenant, marked `verification.v1`, `available`, and joined to immutable verification metadata. Optional type and digest arguments enforce the consumer's stored contract.

Every existing verification v1 consumer is preflighted before triggers are installed. The migration refuses convergence instead of silently blessing an unmarked, unavailable, metadata-free, wrong-type, wrong-digest, wrong-dataset, or wrongly related reference. Legacy source, locator, verification-run, and evaluation paths retain explicit early branches keyed by their existing contract-version fields. The provider accounting tables were introduced solely for bounded verification provider calls and have no legacy contract column, so every non-null provider artifact reference is checked.

Future writes are guarded at the tables that consume artifact IDs. The migration replaces the existing capture, locator, verification-run, and dataset-manifest validation functions without removing their prior tenant, deployment, mission, type, digest, media, availability, or legacy behavior. It adds insert/update triggers for the remaining v1 evaluation consumers and provider accounting.

The generic artifact metadata remains authoritative for parent/signature identity. The immediately preceding marker migration validates historical closure and exact generated edges, makes future parent-edge completeness deferred to transaction end, and validates lineage inserts against immutable metadata. The consumer migration relies on those invariants and additionally checks the relationships that the consumer schema itself names: locator capture descent, case-to-dataset-version identity, and provider request-to-envelope order.

## Proof fixture

`../../../../internal/verification-artifact-consumer-cases.sql` is rollback-only and intended for the coordinator's retained isolated full-chain harness. It creates marked root and child registrations with exact generated edges, then exercises 39 assertions:

- unmarked, metadata-free, pending, cross-tenant, wrong-type, and wrong-digest common admission failures;
- a positive legacy capture path, positive v1 capture and locator paths, and rejection of an unmarked v1 capture and unbound locator representation;
- a valid artifact-backed verification run and metadata-free-result rejection;
- valid dataset manifest, synthetic/agent engineering-expectation case, human-gold case, label, grader, experiment-arm, eval-run, and score bindings, with wrong digest/type and cross-dataset-version negatives;
- valid provider request reservation and ordered response-envelope accounting, plus missing persisted request bytes, raw-response substitution, request-digest mismatch, cross-request envelope substitution, and reversed-parent-order rejection;
- `SET CONSTRAINTS ALL IMMEDIATE` before rollback, so positive child registrations must satisfy the preceding migration's deferred edge-completeness rule.

Current immutable source candidates:

- canonical consumer migration SHA-256: `3e8abdf25c3c82eb0e4132aafdde137e5ca25f631f4a6fcc851b4c0376e903ea`;
- rollback proof SHA-256: `f0820ab14f38750e04a46a0d8e90ed1522cf5ebb9f489209e97f3e19cd3af59b`;
- coordinator marker/backfill migration SHA-256 independently source-reviewed here: `3129d4146ae1aff050462c4f1ed3c58a41939a910251dbd2acc5ddbc089df7c0`.

Static owner checks found 72 unique UUID literals, 39 explicit proof increments, balanced SQL delimiters, and no migration diff whitespace errors. The first coordinator execution against the superseded migration/proof pair correctly exposed a missing producer fixture before consumer assertions ran; that failure is preserved separately and is not acceptance evidence.

After the producer fixture and persisted-request guard were frozen, the owner used the coordinator-authorized isolated runner against the retained disposable `supabase_db_vfy-populated-010660a7` container. Reapplying the idempotent final migration definition passed; receipt `../../../../internal/verification-isolated-sql-proof-699efbb9-ecca-4164-b42c-04854937d2cf.json`, SHA-256 `8384148698c49060d423ad731b1b9877397c05cf712f1088717a75d181cbc5d1`. The final rollback proof then passed all 39 assertions and `SET CONSTRAINTS ALL IMMEDIATE`; receipt `../../../../internal/verification-isolated-sql-proof-211f5b21-b0ea-4cb3-9dd5-2e9803703a4b.json`, SHA-256 `da12e0a7ed525533966a45311cc8b1dde3e16a87a1464e952ce83e3d0f56f693`. Both receipts record zero shared and remote writes and confirm the owned container was stopped. This iterative retained-schema run did not rewrite the migration ledger; EV-037 now supplies independent fresh-chain and local convergence acceptance.

The independent populated 92-chain preserved all 236 legacy identities and passed seven marker/backfill probes, nine runtime cases, and all 39 consumer assertions: `../../../../internal/verification-populated-chain-audit-populated-fb51c87a.json`, SHA-256 `a87a64b2811afdc5ffd2825fbc50f202d0d8be2150398c3aa35f39225bbb7d29`. Incremental shared-local convergence then retained the same 886 artifacts and 886 metadata rows while advancing the ledger from 90 to 92; before/after receipts and hashes are recorded in EV-037. No remote write occurred.

## Compatibility and remaining work

Coordinator-owned proof maintenance removed two pre-contract shortcuts after this migration was frozen. `scripts/prove-verification-provider-accounting.ts` now uses real local Supabase Storage plus the production composer to register input, request, raw response, and ordered response envelope; it reserves against the exact request ID, settles against the envelope, records zero external provider dispatches and synthetic billing, and closes the database in `finally`. Source-review SHA-256: `2950ffe0ab4c0849e74716ee9c8ce70c5f1670910ac8839de7fcd39cccbebf94`.

`scripts/prove-verification-persistence.ts` now registers an exact `evaluation_dataset_manifest` plus distinct synthetic input and engineering-expectation `evaluation_case_input` artifacts. It also makes its wrong-CAS and cross-tenant-capture probes reach the named invariants instead of unrelated lifecycle/producer checks. Source-review SHA-256: `d54f4565bce2510cd31be32964fa21e547e1b01bc9ddc01c8c2bca07346e79dd`. The admission owner reviewed both deltas against the preserved originals with no blocking source finding; execution evidence remains coordinator-owned.

The migration authenticates registry state, type/digest columns, metadata presence, and named relationships. It does not hydrate object bytes or validate response-envelope JSON, benchmark semantics, human-review truth, or verification-bundle contents; application replay retains those duties. Canonical vendor 0.2.8 parity passes, the real Postgres/private Storage proof passes 26/26, durable synthetic provider accounting passes with zero dispatches, and read-only post-migration custody resolves all 709 benchmark artifacts and 117 attempts; EV-037 records the exact receipts and hashes. Remote exact-ledger verification and rollout, hydrated body semantics, and production service promotion remain coordinator gates. The admission owner itself performed no shared database migration, build, provider call, or benchmark execution.
