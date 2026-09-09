# VR-002 and VR-004 independent review

Reviewed 2026-09-08 against the current acceptance matrix and verification-module specification. This review used retained native evidence only. It made no provider, source-acquisition, database, storage-write, or human-label action.

The machine audit is [verification-vr002-vr004-independent-audit-a64c59e1-333c-47f9-a58e-8ee552845ece.json](../../../../../../../internal/verification-vr002-vr004-independent-audit-a64c59e1-333c-47f9-a58e-8ee552845ece.json), SHA-256 `992cb1ae1b7191ccd066a8cbcc75ff6a22e90b35b29ad04e2c82ac4f7abecacb`.

## VR-002 — recommend proved for the row's boundary

The retained native Eve negative control has a deterministic `LOCATOR_UNIQUE` failure, `semanticEligibility: false`, and zero provider attempts, observations, and response captures. This directly supports the matrix condition that deterministic checks run before semantic judgment. The associated signed terminal and EV137 reference hashes match their retained evidence.

The retained policy-boundary replay reads the signed native evidence through local CAS, replays the policy result as `fail`, then shows that two synthetic semantic-result reversals remain `fail`. Four attempted synthetic policy outcome reversals (`pass`, `pass_with_warnings`, `review`, and `abstain`) all return `POLICY_OVERRIDE_FAIL_CLOSED`; only preserving `fail` is allowed, and no override record is persisted. This satisfies the stated non-override boundary. It does not establish a human override workflow or claim that synthetic mutations were native model outcomes.

## VR-004 — recommend proved for the row's boundary

The retained capture replay is bound to the EV136 signed native report receipt and source snapshot. It made 22 loopback CAS reads, no writes, and re-read 14 signed/registered artifacts. The replay performs native projection re-admission plus semantic and policy replay, retaining a `review` policy outcome rather than relabeling it as admitted.

Six exact tamper controls cover digest, byte-length, and registration mismatch for both a source-content and canonical-projection artifact. All reject with the expected error. The original signature verifies; a changed payload fails verification. The optional unsigned inspection is explicitly synthetic and is not treated as whole in-toto/SLSA evidence.

The original execution's source files are preserved in `internal/verification-retained-capture-replay-source-0ba5d845/manifest.json`; this is necessary because a later application build changed the live dist hash. The preserved manifest exactly equals the replay receipt's source list and every preserved source digest matched.

## Limits

These recommendations cover only the literal VR-002 and VR-004 boundaries. They do not promote VR-035, Cloud deployment, human review, or semantic-quality acceptance. Earlier compile/JSON harness failures remain retained and were not counted as passing evidence.
