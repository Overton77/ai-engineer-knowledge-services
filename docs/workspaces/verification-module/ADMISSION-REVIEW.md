# Coordinator admission review

Bounded native PDF/HTML admission is accepted after the following review fixes. This is not a whole-module completion claim.

| Finding | Reviewed resolution |
| --- | --- |
| Resource preflight could allocate an entire oversized array or UTF-8 string before rejecting it. | Collection work is bounded before pushing children, string length before encoding, and native/envelope byte length before decoding. Parsed native/envelope data is preflighted before canonicalization. |
| Deployment and policy configuration retained mutable caller references. | Constructor snapshots configuration and freezes the nested deployment limits. |
| Cancellation between parsing and persistence could still return admission receipts. | Abort state is checked between phases, between writes, and before return. Already persisted candidate artifacts remain registered; whole-operation transactional finalization belongs to the service layer. |
| Content-addressed reuse ignored governance and transformation bindings. | Reuse now requires matching encryption, retention, classification, ordered parents, and transformation signature, while preserving original producer/time metadata. |

Independent coordinator execution through rebuilt public package exports passed 18/18 real local Postgres/Storage checks and confirmed 15 transformation lineage edges. It used the actual restricted 24-page PDF and HTML captures, and tested exact fields, value/locator corruption, tenant isolation, ambiguous selectors, visual residual abstention, cross-parent envelope forgery, classification downgrade, and lineage rebinding.

Receipt: `internal/verification-admission-proof-20260905-30c8e1aa-d740-4817-a5cc-aca3153d1e45.json`, SHA-256 `1c7a612a1a756bdd2226bc6848901f258a128a03f8fa8c9fea7d249b38f58120`.

Log: `internal/verification-coordinator-admission-proof-20260906-r2.log`, SHA-256 `e03570badad2eaa215508289d12664f2f7a69dd4e8d04de93f598714414917dd`.

Reviewed application source SHA-256: `de6c330b2a4dfcdfd5d066a8bb92474513d8cc624067ac5594535d8f67bd2242`. Reviewed persistence source SHA-256: `a2729799a0f1451ac0cf3db00ed0585893aee5f4c49ac6c080763006e91dac7c`.

The earlier coordinator r1 attempt failed because public exports still referenced stale built packages; its failure receipt is retained separately. The successful r2 run followed rebuilding. EV-023 independently proves the new 79-migration chain against an isolated empty database.

## Remaining integration boundary

`hydrateAdmittedProjection` actively validates the parent-specific envelope and native/projection bytes. General `replayAuditBundle` currently hydrates a capture's projection directly and does not call this admission service. The eventual application replay path must enforce the transformation binding before accepting a parser-derived selector. Registered bytes and pure selector resolution alone do not establish that derivation. Unsupported modalities, whole-operation finalization, semantic consistency, transports, retention lifecycle, and remote production behavior remain outside this acceptance.
