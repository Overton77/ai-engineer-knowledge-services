# Next implementation: benchmark publication and operation wiring

Coordinator investigation, 2026-09-05. The checkpoint store and registered offline executor are prerequisites; the following work is still required for an admitted `runBenchmark` operation.

## Canonical records

Keep `evaluation.verification_benchmark_run` as aggregate durable execution state linked to its canonical knowledge-service operation. Publish one truthful `evaluation.eval_run` per actual `evaluation.experiment_arm`, with an explicit immutable benchmark-to-arm/run relation. Do not invent an aggregate experiment arm or evade verification-v1 constraints by inserting null contract versions.

The existing canonical schema has several substantive requirements that must be handled explicitly:

- `eval_dataset_version` needs a registered frozen dataset manifest, original version/digest, case count and honest label provenance. The current V4 input is engineering expectations, not human gold. Its canonical provenance must not become `human_adjudicated` or `human_reviewed`.
- Verification-v1 `eval_case` currently requires `gold_artifact_id`; V4 cases with engineering expectations have `goldArtifactId: null`. Review and evolve this constraint to distinguish a registered engineering expectation from human gold, preserving denial for mislabeled human-gold rows. Do not register an engineering expectation as human gold simply to satisfy the FK/check.
- Every real `experiment_arm` needs its immutable configuration artifact and exact configured identity. `eval_run` needs the same dataset/version and arm plus a real attempt, policy artifact, run manifest, timestamps and status. Bind those relationships atomically; same-tenant FKs alone do not establish matching dataset/version/experiment relationships.
- Existing artifact-consumer triggers require admitted `evaluation_arm_manifest`, `verification_run_manifest` and `verification_policy` artifact types. The new `verification_benchmark_run_manifest` is the exact runner payload, not automatically a replacement for the generic verification manifest.
- The existing `VerificationRunManifestSchema` can reference dataset/experiment and output artifacts, but also requires a deterministic result, policy outcome, complete lineage and runtime/code identity. Its `calls` records describe actual dispatched calls with positive reservations. An offline replay must not invent calls or new reservations; historical call provenance belongs in retained input references and benchmark result attribution.

## Publication ordering and retries

Compute summary and comparison-ready dimensions from the authenticated completed runner result. Register immutable result/provenance/manifests through existing CAS and custody admission. Under the exact live operation lease/fence, atomically bind all canonical per-arm records, aggregate manifest and sealed state. A retry must reuse the same identities and artifacts; conflicting bytes/configuration must fail. Cancellation or a stale fence may leave an unlinked CAS object, but cannot publish a canonical run. A sealed run should become publicly visible only after the operation's terminal receipt, following the existing visibility rule.

## Runtime and surfaces

Add the trusted benchmark configuration/catalog to configured runtime readiness. Admit `verification_benchmark` only with the full executor, durable store, policy/identity authority and publisher available. Route `runBenchmark` through the shared application operation service and worker registry, then HTTP/client/CLI/MCP. Public input remains only registered dataset and experiment references plus offline mode; no raw bytes, caller-supplied checkpoint plans or caller-supplied authority.

Prove actual worker process death after a durable checkpoint, natural lease expiry, replacement with a higher fence, preserved original timing and single canonical publication/receipt. Also prove cancellation, duplicate submission, unavailable configuration and tampered retained input behavior. The current in-process interruption proof does not substitute for this process-recovery test.

Finally admit recorded failed-call checkpoints and repeat the full retained pilot matrix without new provider calls, then implement `compareBenchmarkRuns` against two independently admitted/sealed runs. Human gold, billing reconciliation, calibration, production/shadow deployment and the remaining verification operations retain their separate acceptance gates.
