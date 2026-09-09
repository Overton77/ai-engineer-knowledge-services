# VR035 offline CLI attestation progress — 2026-09-08

Scope: optional local CLI export and inspection of the verification package’s DSSE/SLSA audit-bundle attestation. This is an offline operator utility, not a durable verification use case.

Implemented:
- `knowledge verification attestation-export` requires exact, non-duplicated `--audit-bundle`, `--trusted-public-keys`, `--trusted-binding`, and `--output` arguments. It reads the signing key only from `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM`.
- `knowledge verification attestation-inspect` requires the same signed-bundle/trust inputs plus `--attestation`; invalid or tampered input is a compact `verified:false` result with exit 1.
- The CLI delegates statement construction, DSSE PAE signing, signature verification, expected-bundle reconstruction, and builder/key binding to `createVerificationDsseSlsaAttestation` and `inspectVerificationDsseSlsaAttestation`. It performs no local canonicalization or cryptography.
- Local files are opened and stat-checked through one descriptor, then read into a fixed `max+1` buffer; symlinks, nonregular files, oversized inputs, and observed path/descriptor identity or size changes fail closed. Export pre-verifies the created envelope against the trusted map, then uses one exclusive (`wx`) envelope write. Compact metadata is stdout only, eliminating a two-file partial write. No env-file loading, network, API, DB, provider call, or automatic signing is present.

Validation:
- `corepack pnpm --filter @aiengineer/knowledge-cli exec vitest run src/verification-attestation.test.ts --maxWorkers=1` passed 2/2. The flow uses ephemeral Ed25519 keys, a signed synthetic audit bundle, CLI wrapper export/inspection, built-CLI dispatch, tamper rejection, no-overwrite behavior, and strict-argument errors.
- `corepack pnpm --filter @aiengineer/knowledge-cli typecheck` passed.
- `corepack pnpm --filter @aiengineer/knowledge-cli build` passed before the final built-CLI export assertion was added; rebuild is the final pending local validation.

Limits: the CLI proves format export/inspection only. It does not claim a SLSA level, human provenance, a server deployment, durable attestation persistence, remote execution, or verification admission.
