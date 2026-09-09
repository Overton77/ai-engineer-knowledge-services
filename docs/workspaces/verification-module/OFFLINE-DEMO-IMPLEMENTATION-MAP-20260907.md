# Offline diagnostics demo implementation map — 2026-09-07

## Actual inventory

The installed CLI has no `demo` command. `apps/cli/src/index.ts` accepts only the first two positional tokens, requires `KNOWLEDGE_API_URL`, `KNOWLEDGE_API_TOKEN`, and JSON `--context`/`--input`, and always constructs an HTTP `KnowledgeClient`. `apps/cli/src/commands.ts` has no `demo` group and exposes `benchmark capture` only as the normal remote `captureSource` mutation. Therefore the required offline command cannot be represented or invoked today.

There is reusable offline core, but it is not the required product command:

- `packages/application/src/verification-benchmark.ts:45` authenticates catalog files and derived-input grants; `:362` exports `runDiagnosticsCompaniesDemo`.
- That function validates catalog/preparation manifests, replays selector/extraction mechanics over recorded inputs, writes an immutable result/file manifest, and creates a 4-arm offline benchmark run. `packages/application/src/verification-benchmark.test.ts:15` exercises it without provider calls.
- `scripts/prove-verification-benchmark-offline.ts` invokes that function, but it is a developer proof script hard-coded to `diagnostics-companies-pilot-v3` and a specific internal source-preparation directory. It is not installed as `knowledge demo`; the invoked application function renders the four reports and ledgers, while the script adds only its proof receipt.
- `packages/evaluation/src/verification-benchmark.ts`, `verification-benchmark-run-comparison.ts`, and `verification-statistics.ts` provide immutable dataset/run validation, comparison, and replay-oriented metrics.
- `scripts/report-verification-benchmark-extraction-live.ts` generates the two company reports, comparison report, audit report, ledgers, and manifest. It is deliberately a historical/offline reporting script: its constants bind one pilot-v4 run plus retained live checkpoints and auxiliary receipts. It is not a callable report generator and is not wired to the CLI.

The named catalog exists at `catalog/verification-benchmarks/diagnostics-companies-v1`, with a frozen manifest, selector-bound cases, source ledger, adversarial cases, and an annotation queue. Its `dataset.json` declares `labelProvenance: "engineering_expectations"`; its annotation queue has `humanGoldScoringEligible: false` and all annotation/adjudication fields null. This truthfully prevents it from being presented as human gold. The current offline core and historical report script instead target pilot-v3/v4, so they cannot silently be called the required `diagnostics-companies-v1` demo.

## Concrete missing implementation

1. Add a local-only CLI command path in `apps/cli/src/index.ts` before API/token/context construction, plus a `demo diagnostics-companies` command descriptor in `apps/cli/src/commands.ts` or a separate local command parser. It must accept exactly `--dataset`, `--output`, and `--open`; reject any dataset other than an installed immutable catalog; never call the HTTP client. `--open` must only open `verification-audit.html` when an interactive terminal is available.
2. Introduce a production-facing demo coordinator, preferably `packages/application/src/verification-diagnostics-demo.ts`, that takes a catalog root and output directory, calls the existing manifest/grant validator and offline replay core, and does not use network/provider interfaces. It must use `diagnostics-companies-v1`, not the pilot constants.
3. Reuse `runDiagnosticsCompaniesDemo` report rendering and ledgers. The command coordinator must supply its validated v1 closure and staged output directory, then add missing output atomicity/`--open` behavior and any required report acceptance assertions. Keep the separate pilot-v4 historical reporting script separate.
4. Add a v1-compatible frozen replay fixture/adapter. `runDiagnosticsCompaniesDemo` currently requires a separate source-preparation directory and returns unavailable provider arms; the command must explicitly run extraction plus claim/report verification from frozen captures, then replay deterministic decisions. It must not substitute agent engineering expectations for human labels. Report metadata must retain `humanGoldScoringEligible: false`, zero human-gold denominator, and any unavailable semantic/provider results distinctly.
5. Define the command’s exit mapping: quality failure exit 1, infrastructure/fixture/output failure exit 2; success 0. Write tests for malformed/tampered manifest, output collision, offline/no-fetch behavior, `--open` noninteractive behavior, each required report and ledger, exact command parsing, and the ten §15.9.5 audit paths.
6. Keep live refresh distinct. Implement `knowledge benchmark diff diagnostics-companies-v1 diagnostics-companies-v2` separately from the existing remote `benchmark capture`; it must only produce a proposed immutable successor and drift report, never alter v1.

## Minimum complete delivery sequence

1. Freeze a v1 demo input closure containing every byte/receipt needed by the core and report coordinator, with an integrity test proving no network access.
2. Make the application coordinator select that closure by exact dataset name and validate all catalog digests before output staging.
3. Reuse `runDiagnosticsCompaniesDemo` for selector/mechanical offline run construction and its existing four-report/ledger generation; add an output acceptance manifest and command-level report checks.
4. Add deterministic replay and adversarial result assertions, including all ten audit-path categories, capture-bound links, and the conflict/authority/product-applicability gates in §15.9.6.
5. Wire CLI parsing and add an installed-artifact integration test that invokes the literal PowerShell command shape, tests exit codes, and verifies only the audit report opens.

## Boundaries

No human label may be fabricated: current v1 labels are engineering expectations, with human annotation and adjudication visibly pending. Existing pilot-v4’s recorded-live reporting can inform formatting and audit-path construction but cannot be relabeled as v1’s offline demonstration. This inventory is source inspection only; it does not claim the demo currently runs.