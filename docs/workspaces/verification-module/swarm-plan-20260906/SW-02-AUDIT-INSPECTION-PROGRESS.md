# SW-02 audit inspection progress

## Scope

Implement an isolated application service for `inspectAuditBundle` using the native registered-artifact resolver, canonical audit inspection/signature validation, and recorded policy replay. The service must bind the exact tenant and full artifact handle, accept no caller trust material, return only a compact summary and immutable proof handle/reference, and expose no raw evidence or credentials.

Owned new files:

- `packages/application/src/verification-audit-inspection.ts`
- `packages/application/src/verification-audit-inspection.test.ts`

Shared indexes and transports remain owned by the parse integration coordinator. No database, Storage, provider, Docker, or infrastructure mutation is authorized.

## Status

In progress: inspecting native loader, audit seal/inspection, signature trust, policy replay, and existing public read schemas before implementation.

## Implementation update

The isolated service now:

- parses the existing strict public request and server-owned operation context;
- authorizes before hydrating the exact registered audit artifact;
- binds tenant, artifact ID, digest, byte length, bytes, canonical JSON encoding, media type, creation time, transformation signature, and complete audit parent set;
- invokes canonical `inspectAuditBundle` with a required server-configured signature verifier and requires `signatureStatus: verified`;
- resolves deterministic runtime/projection trust through a server-owned port only;
- invokes existing `replayVerificationAudit`, which rehydrates retained source/policy/input artifacts, reruns deterministic verification, validates recorded policy inputs, and replays the canonical policy decision;
- rejects unsupported request/bundle versions, invalid requests, artifact-integrity failures, corrupt bundles, untrusted signatures, replay failures, cancellation, and deadline expiry under distinct stable codes whose messages contain no resolver, bundle, or key detail;
- combines the caller signal with a server-enforced inspection deadline, passes that signal into the trusted replay configuration and artifact resolver, and races every authorization, hydration, verifier, trust, and replay await against it;
- returns only a compact run/replay digest summary and the storage-safe immutable audit artifact reference (no object key, evidence body, policy body, credentials, or caller trust material).

Focused tests cover successful signed replay, absence of raw/storage fields, strict rejection of caller key material, exact request/registration digest drift, unsupported versions, malformed bundles, unsigned bundles, retained policy-input byte tampering, cancellation during replay hydration, resolver abort propagation, and service deadline expiry.

## Verification evidence

All commands ran from `ai-engineer-knowledge-services`.

| Exact command | Result |
| --- | --- |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-audit-inspection.test.ts` | exit 0; initial 3 tests passed |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | exit 0 after the initial implementation |
| `corepack pnpm --filter @aiengineer/knowledge-application build` | exit 0; ESM build and declarations after the initial implementation |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-audit-inspection.test.ts` | exit 0; final 4 tests passed after adding malformed-bundle and tenant-drift coverage |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | exit 0 on the final isolated source |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-audit-inspection.test.ts` | exit 0; 6 tests passed after typed failures and bounded cancellation/deadline remediation |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | exit 0 after typed failures and bounded cancellation/deadline remediation |
| `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-audit-inspection.test.ts` | exit 0; final post-install run, 6 tests passed in 1.42 s |
| `corepack pnpm --filter @aiengineer/knowledge-application typecheck` | exit 0; final post-install signal-aware source |
| `git diff --check -- packages/application/src/verification-audit-inspection.ts packages/application/src/verification-audit-inspection.test.ts docs/workspaces/verification-module/swarm-plan-20260906/SW-02-AUDIT-INSPECTION-PROGRESS.md` | exit 0; no whitespace errors |

The application build lock is released to the parse integration owner. That owner will add the single shared application index export and run the integrated build; no shared index was edited in this slice.

## Source SHA-256 snapshot

```text
f51e5de12cb67f1171e16f898e0db87fa5828406768e7d22c4541a3a8ab9b4e0  packages/application/src/verification-audit-inspection.ts
d2c923699e53fb931c2c9abbd1ad97d577d6c0b23408f7dc3786cf1b491f12f1  packages/application/src/verification-audit-inspection.test.ts
```

## Wiring handoff and limits

The shared application index needs `export * from "./verification-audit-inspection.js";`; this instruction was sent to the shared-index owner. Public transport remains intentionally disabled. Before future worker/API/client/CLI/MCP wiring, add a strict public contracts result schema matching `VerificationAuditInspectionResultSchema`, configure a server-owned Ed25519 public-key verifier, and implement the trusted runtime/projection replay binding. Never accept keys, trust grants, runtime principals, or projection admission from an inspection request.

No database, Storage, provider, Docker, environment, or infrastructure mutation was attempted in this isolated audit-inspection slice. On 2026-09-07 root reported that direct loopback PostgreSQL and Storage preflight now succeeds and the canonical vocabulary migration is applied; native proof remains a separate root-coordinated step after the pinned dependency reinstall.

## Independent review (2026-09-07)

The independent review is recorded in `SW-02-AUDIT-INSPECTION-INDEPENDENT-REVIEW.md`.

- Exact registered-handle custody, tenant binding, server-owned key/trust authority, replay comparison, and compact output were confirmed in source and focused tests.
- Both P2 follow-ups are implemented and passed the final post-install focused test/typecheck: the combined cancellation/deadline signal reaches trust resolution and every native replay resolver call, while an application race bounds adapters that have not yet adopted the signal; the public application error carries only a stable typed code and exposes no underlying failure text.
- Independent evidence: `corepack pnpm --filter @aiengineer/knowledge-application exec vitest run src/verification-audit-inspection.test.ts` (exit 0, 4 passed) and `corepack pnpm --filter @aiengineer/knowledge-application typecheck` (exit 0).

## P2 remediation recheck (2026-09-07)

The prior cancellation and typed-error P2s are resolved. Final source composes caller abort and a bounded deadline, requires signal-aware resolver/trust ports, races all asynchronous inspection work, and passes the guard into replay hydration. It returns a safe typed taxonomy without raw resolver or custody details. Independent recheck: focused test exit 0, 6 passed; application typecheck exit 0. Details and final hashes are in `SW-02-AUDIT-INSPECTION-INDEPENDENT-REVIEW.md`.
