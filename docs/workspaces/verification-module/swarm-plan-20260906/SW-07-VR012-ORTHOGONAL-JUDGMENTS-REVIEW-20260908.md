# VR-012 orthogonal judgments review — 2026-09-08

## Scope

This review evaluates the architectural separation required by VR-012: evidence support, world correctness, attribution faithfulness, source authority, and provenance integrity. It does not evaluate human-gold labels, calibration, or whether a particular real-world claim is true.

## Evidence

`internal/verification-vr012-orthogonal-judgments-audit-11873a35-bc3e-49b5-8b13-4190ff640915.json` passed with SHA-256 `52a4733ba1e10afceefb46bb0c7a4d0fae3a02f1c33af286572c4bd60b2526d9`.

The audit binds two strict contract representations. `OrthogonalJudgmentSchema` has five required `PropertyObservationSchema` fields; `SemanticAssessmentRecordSchema` has five required semantic-status fields. The focused contract regression rejects a missing dimension and an invented aggregate field, while allowing independent values.

Policy keeps the dimensions separate. Critical world-correctness and provenance states gate the policy decision; source authority is independently derived from source vectors and recorded with its own withholding code. Attribution faithfulness is neither converted into source authority nor substituted for evidence support. The focused policy suite passed 10 tests, including the independent critical correctness, provenance, and faithfulness controls.

The public dashboard terminal projection keeps deterministic semantic eligibility and sealed policy outcome distinct, and benchmark output exposes source-authority assessment separately. It intentionally omits raw semantic/provider material instead of publishing an aggregate score. The dashboard package suite passed 35 tests across 10 files.

## Conclusion

Recommend VR-012 **proved for the architectural separation row**. No field collapse was found at the strict contract, policy, or compact dashboard projection boundaries.

This does not establish that an assessment is calibrated, human-gold validated, or factually correct in the world. It also does not turn the compact dashboard projection into a public semantic-rationale API.
