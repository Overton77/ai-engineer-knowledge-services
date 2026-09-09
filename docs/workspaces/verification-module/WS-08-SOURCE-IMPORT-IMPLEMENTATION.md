# Tenant-owned source import for offline benchmark execution

2026-09-05 root decision, grounded in specification tenant-isolation requirements
(lines75,942,1118,1133,1221) and current canonical artifact ownership. This is an
implementation plan, not acceptance of a new import service.

The historical V4 provider checkpoints belong to tenant
`6d057f43-6aaf-48d9-b3ba-374169abb989`; their frozen native source projections
belong to `fbfa12cf-0cef-423d-858e-f7a3e213fa80`. Do not change RLS, pass the
source tenant into a live resolver on behalf of a benchmark request, or relabel
historical artifact handles as belonging to the benchmark tenant.

Use an explicit restricted source import. An authorized operator registers the
exact retained source-preparation manifest and copies of its artifact bytes
under the benchmark tenant. Original IDs, handles and transformation envelope
bytes remain unchanged inside provenance; imported artifact IDs and registered
handles are separate. Importing within the authorized local workspace does not
approve external redistribution or provider upload. Runtime benchmark requests
cannot initiate an import or choose another tenant.

The current retained manifest is
`internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed/manifest.json`
relative to the parent workspace. It contains82 artifacts,16 captures and
26,950,967 artifact bytes; largest artifact4,019,343 bytes. All original handles
have the same source tenant. Its exact byte digest is already pinned by the
frozen dataset's sourcePreparationDigest. Its scope explicitly remains restricted
local preparation, not an approved redistribution or labeled benchmark.

Implement a runtime-owned catalog binding the exact benchmark
tenant/dataset-artifact+digest/offline-experiment-artifact+digest pair to:

- the imported manifest artifact ID/digest;
- a complete unique map from original artifact ID to imported same-tenant
  artifact ID/digest.

Before artifact reads, validate the admitted request/grant/handle pair, frozen
dataset and offline mode. Authenticate only same-tenant imported handles through
the real resolver. Require manifest bytes to hash to sourcePreparationDigest,
parse original artifact/capture schemas, and require an exact map for every
manifest artifact. Verify imported bytes against both registered copy digests
and original manifest digests/sizes. Enforce128 artifacts,8MiB per artifact,
32MiB aggregate and a bounded manifest. Preserve cancellation at awaited reads.

After authentication, construct a private read-only archive repository backed
solely by these already authenticated copies. Its original-identity namespace
is internal to that archive: no live DB/Storage call may receive an original
tenant or original artifact ID. Its authorization ticket, capture lookup and
returned historical handles must all match the validated archive. Disable
parsing, writes and fallback reads. Replay existing transformation admission
with VerificationAdmissionService and the sealed historical parser deployment.

Reuse prepareBenchmarkProjectionDataset for all evidence edges. The original
prepareRegisteredBenchmarkProjections continues to enforce normal same-tenant
request admission; the new low-level helper only factors the existing mechanical
loop. Do not fabricate an AdmittedOfflineBenchmarkInputs object with a different
tenant to get around that gate.

Return prepared mechanics together with the imported manifest/copy references
and original provenance identity. Tests must prove every real resolver call uses
the benchmark tenant, wrong/missing copy grants and modified bytes fail, original
IDs cannot trigger fallback live reads, cancellation is terminal, exact native
selectors pass and intentional locator mutations remain failures. The live proof
should combine these prepared mechanics with EV-062 historical response replay
without another provider request. Durable runner checkpoint/fencing and operation
integration remain subsequent work.
