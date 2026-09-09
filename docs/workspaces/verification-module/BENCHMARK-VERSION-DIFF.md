# Local benchmark version diff

The installed CLI supports `knowledge benchmark diff <previous-version> <proposed-version>`. It loads sealed catalog directories from its packaged assets by default. For separately prepared local catalogs, use `--catalog-root <directory>`; both named versions must be children of that directory.

For example, the repository's existing sealed pilot catalogs can be compared with:

```powershell
knowledge benchmark diff diagnostics-companies-pilot-v3 diagnostics-companies-pilot-v4 --catalog-root ./catalog/verification-benchmarks
```

The command checks bounded file manifests, file lengths and hashes, directory containment, dataset version identity, frozen case/dataset digests, and successor lineage. It reports changed cases, source preparation, and pending review counts. It performs no network requests and requires no API credentials. Success returns exit 0; missing or invalid catalog input returns exit 2 with `BENCHMARK_DIFF_ERROR`.

The packaged diagnostics v1 remains unchanged. The live refresh command now writes an immutable, review-required v2 proposal. When a frozen v2 catalog is absent, the exact v1-to-v2 diff command can validate that proposal from `.knowledge/benchmark-proposals/diagnostics-companies-v2`, or a parent selected with `--proposal-root`. It recomputes the proposal from pinned v1 inputs and recorded capture outcomes. Missing proposals and corrupt existing frozen catalogs fail explicitly. A successful diff grants no source/license approval, human gold labels, or publication authority.

Receipt `internal/verification-installed-benchmark-version-diff-be14f0c4-ae74-436b-9fe5-6d99f5c9fbca.json` records the built CLI executing outside the repository with a minimal environment and no API credentials: the real sealed pilot v3-to-v4 diff succeeded; missing packaged v2 returned exit 2. CLI suite: 32 tests passed.

Successor receipt `internal/verification-installed-refresh-proposal-diff-143ce592-bc1a-43b2-b08b-114f0801c878.json` records the exact installed v1-to-v2 syntax with the default proposal location, using byte-identical copies of the actual live proposal. It preserves thirteen changed sources, three unavailable, and all pending reviews. The current CLI suite passes 42 tests.
