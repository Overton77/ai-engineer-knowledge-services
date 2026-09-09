# Live diagnostics refresh

With a running worker and an API configured with the server-owned `diagnostics-companies` capture profile, set `KNOWLEDGE_API_URL` and `KNOWLEDGE_API_TOKEN` and run:

```powershell
knowledge benchmark capture diagnostics-companies --propose-version diagnostics-companies-v2
knowledge benchmark diff diagnostics-companies-v1 diagnostics-companies-v2
```

Capture loads the pinned packaged v1 registry and attempts all sixteen sources sequentially. Each source has a bounded deadline covering submission and terminal polling (`--timeout-ms`, default 60000, maximum 60000). Tenant and operation identity come from authenticated API responses and must remain consistent. Requests contain no caller-authored operation context and use no model provider.

The default candidate directory is `.knowledge/benchmark-proposals/diagnostics-companies-v2` under the current directory. `--output` selects another directory; existing output is refused before acquisitions begin. The writer creates `proposal.json`, `source-outcomes.json`, and `manifest.json` using exclusive staging and verifies their hashes before publication. It never overwrites v1 or an existing proposal.

Successful captures retain compact immutable artifact references. Failed submissions and terminal reads retain a safe code and phase; an accepted operation whose terminal capture could not be read retains its operation ID. An unavailable source remains in the sixteen-source result. Capture exits 2 with `refresh_incomplete` when any source is unavailable, or 0 with `proposed_review_required` when every source was captured. Neither status grants review or publication authority.

The pinned `tru-sample-report` source uses the PDF capture request and retains both ordered text and geometry projection/transformation references in the proposal. The other fifteen sources use HTML. Proposal verification rejects a missing or altered PDF geometry reference; existing HTML proposal material retains its original representation.

The proposal retains historical case references and requires fresh selector validation, source/license and drift review, gold-label updates, and leakage review. It does not copy historical selectors or labels onto new content, and it does not create a runnable frozen v2 benchmark.

The diff command prefers a sealed frozen v2 catalog when present. If it is absent, it can read the default refresh proposal (or `--proposal-root <parent-directory>`), verify all three files, and recompute the proposal from pinned v1 inputs and recorded capture outcomes. Its result is explicitly a refresh-proposal comparison. A successful diff means the comparison is valid; unavailable capture outcomes remain visible.

Native receipt `internal/verification-benchmark-refresh-native-f5041526-f829-4aef-a3e2-a0bafd9fe25f.json` records the built CLI against a listening API and real canonical worker, PostgreSQL, Storage and parser: sixteen acquisitions attempted, thirteen captures retained, three unavailable, seventy-eight registered artifacts, and capture exit 2. The unavailable sources were `paper-noise`, `paper-rectification`, and `tru-sample-report`. Their precise underlying acquisition/parser errors were not retained by that harness, so no more specific cause is claimed. The isolated database/dump were removed and no model calls were made. Full refresh acceptance remains incomplete.

Independent audit `internal/verification-benchmark-refresh-independent-audit-f5041526-f829-4aef-a3e2-a0bafd9fe25f.json` verified every retained Storage object (6,166,298 bytes), proposal recomputation, file manifests, and the outcome-to-exit-code relationship. Installed diff receipt `internal/verification-installed-refresh-proposal-diff-143ce592-bc1a-43b2-b08b-114f0801c878.json` verifies the exact v1-to-v2 command against this live proposal with no API credentials.

Successor native run `297768a3-8d7c-447d-800c-363cece8084b` captured fourteen sources, including the 4,019,343-byte sample PDF and both native projections. Its retained operation receipts identify `paper-noise` as `SOURCE_ACQUISITION_HTTP_STATUS` and `paper-rectification` as `SOURCE_ACQUISITION_REDIRECT_NOT_ADMITTED`. Capture still exits 2. The PDF independent audit with the same run ID verifies all eighty-six artifacts (12,626,421 bytes), proposal recomputation, and installed offline diff using an explicit proposal root. The isolated database and dump were removed; no model-provider calls occurred. Full source coverage and a reviewed runnable successor remain unfinished.
