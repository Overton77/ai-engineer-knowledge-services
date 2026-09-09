# Structured extraction terminal receipt draft

This bounded contract derives a terminal pre-event payload only from a retained
structured-extraction publication already authenticated by its Ed25519 custody
seal. The helper does not write storage, call a provider, persist a receipt, or
complete an operation step.

`VerificationStructuredExtractionResultSchema` is a strict
`verification-operation-result.v1` shape. It binds the exact operation ID and
canonical request digest from the publication. Its output is permanently
limited to `unverified_candidate` and `shape_only`, compact candidate,
provenance, optional precontext and execution artifact identities/digests, the
publication seal payload digest, and provider-call digest. `resultArtifact` is
the complete registered publication artifact handle. There is no terminal
`outputDigest`, quality claim, semantic-verification claim, or source-authority
claim.

`createStructuredExtractionOperationResult({ manifest, artifact, verifier })`
strictly snapshots inputs before its signature-verifier await. It checks the
canonical signable publication body against the seal digest and native Ed25519
signature, recomputes the provider-call digest, and checks canonical full
publication bytes, artifact digest, byte length, completed timestamp, ordered
parents, and SQL-reproducible transformation signature. It returns a frozen
strict payload. An unknown signing key, a tampered body, malformed candidate
status, or mutation after the snapshot is denied.

Canonical operation receipt/step guards remain a persistence concern. This
helper is valid only after the SQL publication prerequisite has admitted the
retained publication under the canonical live lease; it does not make
`extractStructuredData` terminal or publicly readable.

## STATUS

2026-09-06 UTC: bounded contract, application helper, generated contract
artifact, and focused native-Ed25519 tests are ready for root integration and
actual local proof. No persistence, migration, publication-builder, storage,
network, or operation-step code changed in this slice.
