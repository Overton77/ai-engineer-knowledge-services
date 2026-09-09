# SW-VR023 Cursor public-call acceptance audit — 2026-09-08

Verdict: **proved** for the exact VR-023 row: “Cursor Cloud invokes the service/CLI without copied algorithms and propagates orchestration identity.”

The retained actual Cursor Cloud run `run-883e42c7-6506-4718-b2d1-ae576ff5901c` finished in 68,466 ms. The public caller proof recorded unauthenticated `401`, launch `202`, duplicate `202` with the same workflow, and terminal completion for operation `168a79b1-c346-514b-a0e5-2ee3852b047a`, receipt `fd8ba504-bc5a-5f7f-a99b-e26e1c538427`; it reports zero gateway calls. The launch fixture carries tenant, mission, work-item, attempt, and correlation context. Read-only local custody confirms the exact operation is `verification_report`, status `succeeded`, with the same tenant/mission/work-item/attempt and an idempotency key derived from that identity; the receipt is succeeded, fenced at 852, and references result artifact `9b075fd8-a238-5a4a-a2c5-c65a77ab0f5c`.

The typed terminal is bound to the same tenant and operation and carries the sealed run, manifest, deterministic result, and report/claim artifacts. The terminal’s review disposition (`SOURCE_AUTHORITY_WITHHELD` and `REPORT_CITATION_SEMANTICS_UNASSESSED`) is the expected verification outcome and does not weaken the orchestration acceptance. The fixture implementation is a thin bridge to the production host and public HTTP routes; no verifier algorithm is copied into the Cursor caller.

Spec binding: `docs/specifications/verification-module.md` §22 requires thin fixture-tested skills with exact CLI/HTTP invocation, contract/capability interpretation, artifact registration, and no verifier algorithms; the acceptance matrix identifies WS-10 as a real cloud fixture and manifest inspection. This proof satisfies that bounded requirement.

The fixture was stopped within the approved window, full ngrok capture was disabled before launch, local inspection was disabled, and offline endpoint lookup returned `404 ERR_NGROK_3200`. Endpoint closure is cleanup evidence, not a failed public-call proof. No endpoint was reopened, no model run was started, and this audit made no DB mutations.

Immutable review receipt: `internal/verification-vr023-final-acceptance-audit-20260908/receipt.json`, SHA-256 `CFD472F7F03F10ABA53429620BB46E915AD4C8C559D9448F3D7F30973BB2AC5B`.
