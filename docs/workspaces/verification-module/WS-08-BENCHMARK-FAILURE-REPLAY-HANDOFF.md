# Registered benchmark failure-replay handoff

Coordinator review and EV acceptance remain pending. This slice adds the
application boundary needed to admit captured failed provider checkpoints in a
registered offline benchmark. It makes no transport, migration, provider-dispatch
or benchmark-quality change.

`RegisteredBenchmarkReplayAdmission.load` retains its successful-only return type
and behavior when the trusted grant contains no failed checkpoints. It now rejects
a failure-bearing grant with `BENCHMARK_REPLAY_FAILURE_AWARE_LOAD_REQUIRED` rather
than silently discarding failures. The new `loadWithFailures` method returns a
discriminated `outcomes` list:

- `outcome: "observed"` carries the existing immutable successful observation;
- `outcome: "failed"` carries the exact checkpoint reference, case/role/provider/
  model and source binding, captured failure class/code/adapter code/HTTP status,
  `automaticRetry: false`, original attempt/accounting/latency/completion values,
  and replay accounting of exactly one memory fetch and zero external requests.

Both checkpoint schemas pass the same registered-artifact authorization, complete
handle comparison, byte digest, size and aggregate bounds. The loader requires the
exact grant run-identity digest, profile dataset and experiment digests, frozen
case digest, registered source-input handle, and role/provider/model plan. It
deduplicates case/role across successful and failed rows and requires every role
for one case to retain the same full source binding.

Failed request, raw-response and response-envelope artifacts are authenticated
from their packed full handles and registered bytes. The response envelope must
be canonical JSON with only its declared keys, exact request/raw IDs and digests,
ordered parents and the provider transformation signature. The request digest is
recomputed and the existing wire-request assertion runs before the existing real
adapter replays the captured HTTP status. HTTP, response-schema and extraction
field-matrix failure branches must reproduce their exact supported failure. No
observation is invented for a failure and no adapter retry is allowed.

The current adapter replay helper does not expose retained precontext bytes when
the adapter rejects. A failed checkpoint carrying paired precontext therefore
fails closed with `BENCHMARK_REPLAY_FAILED_PRECONTEXT_REPLAY_UNSUPPORTED`. All
seven current pilot failures contain the six-artifact chain without precontext.
Successful replay continues to verify paired precontext bytes and envelopes.

`RegisteredDiagnosticsOfflineBenchmark` calls the failure-aware method when the
runtime port supplies it, while preserving compatibility with successful-only
legacy test ports. Only observed entries enter `composeDiagnosticsRecordedArm`.
For failure-bearing runs, provenance contains all checkpoint wrappers in
`checkpoints`, the successful `replayedObservationCount`, and separate
`replayedFailureCount` and `failedCheckpoints` values. This makes every failed
wrapper a parent of the publication provenance artifact through the existing
builder. When there are no failures, the preparation provenance retains its prior
field set and checkpoint semantics.

Focused replay coverage passes 29 tests. It executes all seven actual retained
schema-failure checkpoint shapes and checks exact failure/status/accounting,
memory-only replay, response-envelope content and parent lineage, packed-byte and
grant digest drift, run identity, profile role, failure attribution, cross-outcome
case/role deduplication, cross-role source binding, cancellation, success-only
compatibility, provenance and the rejected-precontext limitation. The complete
application suite passes 142 tests; application typecheck and build pass.

The focused tests intentionally read the pre-existing restricted local fixture
pack at
`../../../../internal/verification-benchmark-extraction-live-feeb824c-e4d0-597f-abd7-7667fa080869`.
This follows the earlier successful-checkpoint test pattern and exercises the
actual seven failure shapes, but it is artifact-backed local evidence rather than
a hermetic clean-checkout unit suite. Private payloads were not copied into the
repository. The registered Storage/canonical-worker proof owned by the coordinator
is the separate runtime authority for the full 117-call set.

The retained inputs are historical provider attempts. Their accounting records
remain under each failure's `historical` field; `externalProviderRequests: 0` and
the per-failure replay counters describe this offline execution. This does not
reinterpret historical cost as a new charge or claim human gold, source authority,
calibration, population inference or promotion readiness.

## Configured runtime evidence

The coordinator's first configured canonical-worker execution passed after the
application build. Receipt
`../../../../internal/verification-full-retained-replay-worker-4262c342-dde5-4beb-ac6c-9aeca16882bd.json`
has SHA-256
`eb1df113c0e9ac24d17143c60b1ecfc8657a6ffd5f844c962da041a65f04ce57`.
Operation `cfbe707b-a1df-48b7-8807-4ca0841f707d` has one canonical success receipt,
172 benchmark checkpoints and four arms. Its registered publication provenance
contains all 117 replay wrappers, 110 admitted observations and seven separate
failed checkpoints with the captured tuples and historical accounting. The
publication signature and runner semantic digest verify. The full canonical
provider-attempt and budget JSON hash is unchanged before and after execution,
and the publication records zero external provider requests. Human-gold,
source-authority and calibration claims remain false.

That execution uses the coordinator's registered preparation receipt
`../../../../internal/verification-full-retained-replay-preparation-7156f117-fc95-4270-9b96-ad9574d3b3f7.json`,
which independently hydrated 709 registered Storage artifacts against full
handles and packed bytes. Coordinator native readback, full-workspace validation
and acceptance remain separate work; this handoff makes no EV claim.
