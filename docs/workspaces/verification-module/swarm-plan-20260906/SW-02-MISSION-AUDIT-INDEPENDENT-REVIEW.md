# SW-02 Mission Control audit independent review

## Prepared scope

This review will independently audit the immutable receipt emitted by `scripts/prove-verification-audit-mission-control.ts`. It will not accept receipt booleans as evidence. The companion auditor, `../internal/verification-mission-audit-independent-audit.mjs`, will use the direct local configuration helper, force a database read-only session, and write a separate immutable receipt only after SQL and Storage readback succeeds.

## Required receipt inputs

The producer receipt must supply:

- source receipt path and SHA-256, tenant ID, configured public-key ID/material reference, and canonical claims/report source manifest handles;
- each Mission-Control-created audit operation ID, family, expected audit manifest handle, terminal result artifact handle, and expected external execution/ownership context;
- cancellation and denied-operation IDs; and
- no secret values. The independent auditor will derive canonical output/input/event hashes and fenced receipt details from PostgreSQL itself.

## Planned readback

For each operation: exact operation/step/request hash, authenticated context, mission/work/attempt and Mission Control `externalExecution` mapping; one matching receipt; canonical terminal body/output hash; successful event transition and decimal-string fence; full result artifact registration/bytes; parent and transformation binding; signed source audit manifest Storage bytes and Ed25519 verification; and exact native verification-run bundle/result/policy/manifest lineage.

It will additionally verify cancelled operations have no receipt or producer-attempt artifact, denied IDs have no operation, and Storage registrations are available and exact. It uses the canonical audit inspector only for signature validity and will not rerun verification algorithms.

## Limits

Temporal history/replay correctness belongs to root's independent Temporal audit. This SQL/Storage audit cannot establish remote behavior, operating-system crash recovery, parser/provider execution, or a new semantic decision.

## Independent execution

Command:

```powershell
node ../internal/verification-mission-audit-independent-audit.mjs ../internal/verification-audit-mission-control-20260907-r2.json ../internal/verification-mission-audit-independent-20260907-r2.json
```

Exit `0`. Output `../internal/verification-mission-audit-independent-20260907-r2.json`; SHA-256 `c1419f1a3800a4c09197cde93d0f87c561391cfd7a0f87cb94d8ee2d7c9e2b2d`.

Read-only SQL/Storage audit verified two operations: exact MC external-execution workflow binding, receipt/result artifact identity and canonical bytes, signed source manifests, policy outcomes, successful fenced events, and Temporal receipt/history hashes with replay metadata. Parser/provider counts are zero. No cancellation/denial case was asserted because the producer receipt explicitly scopes those to EV111.

### Correction and superseding audit

The earlier r2 receipt was incomplete: it did not independently compare the native operation context, step/request hashes, receipt ID/input/output hashes, or event transition. Do not use it for full ownership/custody acceptance.

The auditor now independently queries and validates the native operation kind/status, mission/work/attempt, actor identity, ownership mode, external run, durable audit reference, canonical request and step hashes, receipt ID/input/output hashes, exact one result parent, source audit digest, event step/from/to/guarded output/fence, and signed manifest validity. Superseding execution:

```powershell
node ../internal/verification-mission-audit-independent-audit.mjs ../internal/verification-audit-mission-control-20260907-r2.json ../internal/verification-mission-audit-independent-20260907-r4.json
```

Exit `0`; r4 SHA-256 `ba4d5f20dc555830b1683b01772273d611a00bd339305455416fe8dd25720604`.
