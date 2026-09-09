# VR-045 refresh/diff/replay closure review

Receipt: [verification-vr045-refresh-immutability-audit-5e224c29-d8b4-4b4c-9a90-5aee2f2e0680.json](../../../../../../../internal/verification-vr045-refresh-immutability-audit-5e224c29-d8b4-4b4c-9a90-5aee2f2e0680.json), SHA-256 `34ffc7c9f89b9d4fad5342d859fdaa879460ee039913a2449ec839059b80ea0c`.

EV128 performed the explicit live-refresh path through the configured API, canonical worker, PostgreSQL, and Storage: 16 source attempts, 13 captured, 3 retained unavailable, and 78 registered artifacts. The native command returned `refresh_incomplete`/exit 2; the installed local proposal diff returned exit 0 because it validated the review-required comparison, not a quality or promotion outcome.

The proposal has independent evidence of exact recomputation from pinned v1 baseline data and recorded outcomes, all 78 hydrated object bytes/digests/lengths, and a three-file byte manifest. The installed diff is explicitly `kind: refresh_proposal`, with `frozenDatasetCreated:false`, `humanApprovalGranted:false`, and `externalRequests:0`.

The missing local immutability control was added to the version-diff fixture. It snapshots every v1 manifest file before writing the separate v2 proposal and executing the diff, then compares each original byte sequence after both steps. The focused CLI test passed 6/6.

**Recommendation:** record VR-045 proved for its exact immutable-refresh/diff row. It does not claim a frozen v2 dataset, source/license/gold/leakage approval, or all-source availability. The canonical v1 catalog remains unchanged.
