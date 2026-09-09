# WS-08 Recorded Benchmark Response Replay Assessment

Updated 2026-09-05. Response-envelope custody validation is now implemented;
no replay implementation, provider call, filesystem loader, migration, or
transport path is admitted here.

## Current supported boundary

`hydrateRegisteredBenchmarkObservations` authenticates a tenant-scoped
observation artifact, its observation digest, and retained request/raw/envelope
artifacts. For `verification-provider-response-envelope.v1` it requires exact
canonical JSON with exactly its five fields, binds its request/raw artifact IDs
and raw digest to the actual observation parents, requires ordered
`[requestArtifactId, rawResponseArtifactId]` envelope parents, and verifies the
existing `verification_provider_response_envelope.v1` transformation signature.

The request digest is intentionally recomputed as `providerDigest(parsed request
JSON)`, rather than compared to the request artifact's byte SHA. Provider wire
bytes can have noncanonical JSON member order while the adapter's request digest
is semantic/canonical. The loader tests that distinction. It deliberately still
returns `replayRequired: true`.

`replayDiagnosticsCapturedResponse` proves the existing Gateway and Interfaze
adapters can replay **test-provided** raw bytes with an in-memory `fetch` and
zero external requests. Its test covers accepted payloads, wrong models, HTTP
500, malformed Interfaze precontext, and all three diagnostics roles. It is not
a production replay composer because it receives `httpStatus` and a V4
`DiagnosticsExtractionAuthority` as direct parameters.

## Blocking authority gaps

No safe implementation can derive those parameters from the retained artifacts
today:

1. The v1 envelope contains request digest/ID and raw-response artifact
   ID/digest, but not HTTP status. Raw JSON must not be used to infer status: a
   non-2xx response can contain an otherwise schema-shaped payload. Existing
   retained `DiagnosticsBenchmarkLiveCallCheckpointSchema` does retain a
   successful `providerHttpStatus` and has been adapter-replayed by
   `scripts/prove-verification-benchmark-extraction-live.ts`; that checkpoint
   must be granted and authenticated for a future composition.
2. `VerificationBenchmarkExperimentDefinitionSchema` binds an offline dataset,
   runner, arms, and observation references. It carries no trusted replay
   profile or profile artifact digest.
3. Existing V4 authority comes from `loadDiagnosticsExtractionExperiment` and
   an in-memory provenance capability constructed from a local catalog, grant,
   registry, and experiment files. It cannot be reconstructed from a public
   request, a generic dataset, or a provider observation. The existing V4
   experiment itself declares `allow_listed_providers`, so it cannot silently
   become the public `offline_recorded` profile.

Therefore an observation must remain unavailable to `composeDiagnosticsRecordedArm`
until adapter replay has produced a validated output under a trusted profile.
Neither its self-declared provider/model/role nor parsed raw output grants that
authority.

## Minimal next design

Introduce a registered, canonical **offline replay profile artifact**. The
runtime-owned profile must map the already admitted tenant/dataset artifact/
experiment artifact pair to exact:

- replay profile artifact ID/digest and profile version;
- role -> provider/model/adapter configuration/output schema/prompt digests;
- an artifact-backed reconstruction of the V4 case/grant authority used by
  `createDiagnosticsExtractionProviderInput` and
  `assertDiagnosticsExtractionWireRequest`;
- exact allowed case IDs/digests and a no-network policy; and
- an exact trusted call-checkpoint artifact/digest for each replayable
  observation, including its recorded successful HTTP status.

The existing v1 envelope now authenticates the request/raw response lineage. A
future profile/checkpoint grant must additionally bind status and V4 authority;
their absence from the envelope alone does not require a new provider-envelope
version. The HTTP status cannot be optional for replayable observations.

A future `replayRegisteredBenchmarkObservation` can then, in order:

1. obtain the profile only from trusted runtime mapping, never observation JSON;
2. validate the profile and response envelope against the tenant, admitted
   dataset/experiment, and observation role/case/digests;
3. validate retained request bytes with the profile's existing wire-request
   assertion, and require its semantic digest to match the authenticated
   envelope/observation request digest;
4. invoke `replayDiagnosticsCapturedResponse` with the retained raw bytes and
   trusted checkpoint HTTP status using only an in-memory fetch; require exactly one
   memory fetch and `externalRequests: 0`;
5. parse the resulting output with the role schema, compare it exactly to the
   recorded observation output/digest, and return a compact replay proof. Any
   difference remains replay-required/terminal rather than trusted output.

This design reuses the existing adapters, wire assertions, and output schemas.
It does not copy parsing or provider logic and performs no paid/network call.

## Validation required when implemented

Use actual Gateway, Interfaze, and Haiku adapter payload fixtures. For each,
prove a matching retained request/envelope/status/profile succeeds with zero
external requests. Reject a changed HTTP status, envelope parent/transform
signature, request digest or bytes, raw digest, profile binding, model/role,
case digest, and replayed output. Retain the current response-replay tests as
adapter conformance tests; add custody tests at the new envelope/profile
boundary. Existing observations without the new envelope must remain
`replayRequired: true` and must not fall back to unvalidated output.

## Root follow-through: sealed profile byte admission

Root extracted admitDiagnosticsExtractionExperimentFiles from the existing filesystem loader. It accepts a byte map, recomputes the original fixed V4 seals and every catalog/grant/registry/schema/plan binding, and constructs the same private WeakMap-backed authority. The filesystem loader delegates after validating the catalog seal before reading its listed files. Two tests cover authority equivalence, ownership of retained bytes, missing files and modified grant bytes. This is a reusable prerequisite, not registered replay admission or a new network grant.

The next composition should hydrate the exact profile files through registered handles and runtime-owned grants, then admit them with this function. Retained successful-call checkpoints already preserve providerHttpStatus, observation identity, source bindings and complete artifact bytes. Their own checkpoint digest and registered wrapper must be granted and checked against the offline experiment, original sealed experiment and replay authority. Reuse these records without silently converting their historical allow_listed_providers execution policy into current network permission. Current replay remains memory-only.
