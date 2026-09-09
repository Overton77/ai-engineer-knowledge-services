# SW-06 claims/report dispatch source review

Reviewed `ai-engineer-mission-control/packages/mission-kernel/src/verification-dispatch.ts` after the final root change.

The claims/report terminal branch uses the published strict EV103 operation-result schemas and requires receipt operation ID and canonical request digest equality. It derives the expected input handle from the request, verifies the report and ledger handles for report operations, requires every exposed result/manifest/assertions/source/report handle to be tenant-bound, and requires the terminal result artifact to name the sealed manifest as a parent. It maps only `fail` to `quality_rejected` and `review`/`abstain` to `review_required`; forged pass outcomes and malformed terminal receipts fail closed as `reconciliation_unresolved`. The dispatch branch does not resubmit a terminal quality/review receipt.

The adapter preserves client context identity: tenant, mission, work item, attempt, correlation, deterministic dispatch key, and Mission Control external execution. It does not import KS workspace source; it relies on vendored client/contracts packages.

The source change is bounded to receipt-envelope consistency and dispatch disposition. It does not duplicate claims/report verification algorithms. The focused unit test parses fixtures through the same strict vendored schemas and covers outcome, binding, tenant, and lineage-parent rejection paths.

Limit: this is not a Temporal or KS runtime proof. A live CPH integration remains necessary to establish durable activity retries, signed receipt delivery, and public API execution.
