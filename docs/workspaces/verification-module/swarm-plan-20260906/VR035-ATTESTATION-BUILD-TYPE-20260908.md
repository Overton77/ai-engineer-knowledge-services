# Optional audit-bundle attestation

Implementation target: `urn:aiengineer:verification:audit-bundle:v1`.

This build type describes the deterministic assembly of the public, canonical verification audit payload. It does not attest to model correctness, human annotation, admission promotion, or a SLSA assurance level. Existing audit-bundle seals and durable operations keep their existing behavior. Export and inspection are explicit offline operator utilities.

The subject is named `verification-audit-payload` and its SHA-256 identifies the canonical bytes returned by the existing audit-bundle signable-payload projection. It is not the digest of the enclosing JSON file or its detached seal. The expected audit bundle must independently pass the existing signed-bundle inspection with trusted keys before an attestation can be exported or accepted.

The builder identifier is `urn:aiengineer:verification:deployment:` followed by the percent-encoded deployment ID from the authenticated manifest. An explicit trusted builder/key binding must authorize the attestation signer for that exact derived identity. The unauthenticated DSSE key ID is only a key-selection hint, never authority by itself. No caller-supplied replacement deployment or builder claim is accepted.

The statement uses in-toto Statement v1 and SLSA provenance v1. Build parameters bind the canonical manifest and policy digests; resolved dependencies contain the input artifact identities/digests. Raw source content, credentials, private reasoning and arbitrary external parameters are excluded. Inspection reconstructs the expected statement from the authenticated bundle and rejects changed subject, builder, parameters or dependencies, even if an envelope signature is valid.

DSSE signs the pre-authentication encoding of the exact UTF-8 payload type and statement bytes, with lengths measured in bytes. Envelope decoding is bounded and supports standard and URL-safe base64. The same verified payload bytes must be used for statement inspection. Export must not overwrite an existing sidecar; signing keys are supplied through the process environment, never command-line values or emitted metadata.

Primary format references: [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md), [SLSA v1.2 build provenance](https://slsa.dev/spec/v1.2/build-provenance), and [DSSE protocol](https://github.com/secure-systems-lab/dsse/blob/master/protocol.md). These specify the envelope/predicate formats; merely emitting them does not establish a SLSA level.

Required proof: optional-off compatibility; signed export and trusted inspection; altered payload/type/signature/subject/builder/dependencies; unknown keys and mismatched builder grants; malformed or oversized encoding; immutable output; and actual built CLI export/inspect with explicit synthetic provenance.

## Offline operator utility

The optional CLI path is intentionally separate from durable verification use cases:

```text
knowledge verification attestation-export --audit-bundle <signed-audit.json> --trusted-public-keys <keys.json> --trusted-binding <binding.json> --output <audit.dsse.json>
knowledge verification attestation-inspect --audit-bundle <signed-audit.json> --trusted-public-keys <keys.json> --trusted-binding <binding.json> --attestation <audit.dsse.json>
```

`keys.json` is a bounded JSON object of trusted key IDs to public PEM values. `binding.json` has exactly `builderId` and `keyId`; it authorizes a specific signer for the builder ID derived from the signed audit manifest. Export requires `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM` in the process environment and accepts no private-key flag. It verifies the created envelope through the trusted map before exclusively creating the single output file, and returns compact public metadata on stdout. The utility reads only explicit local files; it never loads an env file, contacts a service, replays a run, or signs an existing durable record.
