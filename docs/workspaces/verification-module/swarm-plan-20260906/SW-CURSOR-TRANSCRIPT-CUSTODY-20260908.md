# Cursor public transcript custody

Recovered public events from the documented Cursor v1 per-run SSE endpoint for the already archived CPH agent. Three read-only GETs returned32,123 and178 public events for the original report, recovery and public-invocation runs. No new agent/model run occurred. Thinking events and richer duplicate interaction updates were excluded before retention; the endpoint does not supply user prompts. This is an observed public event transcript, not a claim of hidden/internal conversation coverage.

Source: `internal/verification-cursor-public-transcript-4a4a2aed-e11f-4753-ac7c-6b7f8ffbf846.json`, SHA256 `7247fa6081adb6cbfdc6349ea285b338b4ea407582612cf29dcbecfcda85fe24`. Exact Cursor API and fixture bearer scans found no matches before the artifact was written.

Registered restricted content-addressed artifact `547b0e9f-aabb-5d37-a9dd-6d4fd2c28e58`, parented to the exact Cursor report after checking its hash and producer agent identity in canonical custody. Used the existing `source_capture` type for captured external runtime events; the payload carries the explicit `verification-cursor-public-transcript.v1` schema. No new artifact taxonomy or migration is necessary. The sidecar does not change prior sealed manifests or promote the captured content as evidence of domain truth.

Receipt: `internal/verification-cursor-transcript-registration-5b647bf1-929a-4326-874c-ff2d32bad31f.json`, SHA256 `1f15531793d78f6accce967ed11b0f2820e355072d61d3ade4343183036bff54`. Authorized hydration reproduced exact bytes.

Harness corrections retained in this ledger: an initial invented artifact-type name failed its FK before any object-store write; replaced it with the existing source-capture type. Registration then succeeded but the proof called a nonexistent direct hydration method. The corrected proof used `createTrustedArtifactResolver`, authorization then hydration, and reused the same registered content identity. No duplicate artifact or paid call was created.

Primary API reference checked2026-09-08: [Stream A Run](https://prod.cursor.com/docs/cloud-agent/api/endpoints), including public event types, resume and retention behavior. No private SDK interface was used.
