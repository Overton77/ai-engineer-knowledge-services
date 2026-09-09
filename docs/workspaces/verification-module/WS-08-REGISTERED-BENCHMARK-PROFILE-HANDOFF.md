# WS-08 Registered Benchmark Profile Admission Handoff

Updated 2026-09-05.

`RegisteredBenchmarkProfileCatalog` accepts only trusted runtime grants keyed
by the exact tenant, registered frozen dataset artifact/digest, and registered
offline experiment artifact/digest. A grant contains named registered profile
file references; the constructor copies and freezes each nested reference.

`RegisteredBenchmarkProfileAdmission.load(admitted, tenantId, signal?)` first
defensively checks that the admitted request, grant, and handles all describe
that same pair, reasserts the frozen dataset seal, and requires the offline
experiment to bind to that dataset manifest. It resolves the profile grant
before any artifact authorization.
It then authenticates the registered manifest, derives the manifest's exact
listed file names, and verifies the fixed V4 catalog seal before it hydrates
the manifest-listed files. It rejects missing or extra configured references, and
sequentially authorizes and hydrates each named artifact. Each registration is
required to match the tenant, ID, declared digest, byte length, and recomputed
SHA-256. Bounds are 128 files, 8 MiB per file, and 32 MiB total.

The hydrated bytes are passed only to
`admitDiagnosticsExtractionExperimentFiles`, which preserves the fixed V4
seals and private WeakMap-backed authority. The return value exposes only that
authority, the original sealed extraction experiment for later checkpoint
binding, and compact registered profile references. It contains no raw bytes,
does not read a filesystem path, grant network access, or perform provider
calls. The caller's offline experiment is also required to bind to the sealed
profile dataset manifest.

Focused tests use actual V4 catalog fixture bytes through a memory resolver.
They cover successful byte admission, missing exact-pair grant before I/O,
modified registered bytes, sanitized cancellation, and mutation of the raw
trusted-grant object after catalog construction, plus a tampered admitted
dataset/experiment binding before I/O. Cancellation is also checked after each
awaited authorization and hydration, before any retained bytes are used.
