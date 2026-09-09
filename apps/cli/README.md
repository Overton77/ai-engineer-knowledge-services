# Knowledge CLI

Build from the knowledge-services repository:

```powershell
corepack pnpm --filter @aiengineer/knowledge-cli... build
node apps/cli/dist/index.js demo diagnostics-companies --dataset diagnostics-companies-v1 --output ./diagnostics-reports --open
```

The package exposes the same entry point as the `knowledge` binary. Resolve the script entry point to an absolute path when running from another directory. Output paths are relative to the invoking directory.

The demo uses packaged frozen inputs and needs no API credentials, Docker, or network access. It writes 26 files: four HTML reports and their Markdown and JSON counterparts, a linked evidence appendix in HTML and JSON, claim, field, source and run ledgers, metrics, semantic replay and adversarial-check results, a full-demo quality-gate record, verification bundle and file manifest. Citations link to retained evidence; cases absent from the frozen dataset are explicitly marked unavailable. The build verifies and copies the private retained source assets; those assets are not a public redistribution grant.

Choose a new output directory. Existing output is rejected. Files are prepared in an owned staging directory and published after generation succeeds. `--open` opens only `verification-audit.html` in an interactive terminal; automated runs leave it closed.

This version returns `verification_incomplete` with exit 2 because required full-demo verification paths are unavailable. The 13-gate record in `quality-gates.json` identifies each missing obligation; generated reports remain available for inspection. Missing or malformed required inputs also exit 2. A completed, fully evaluated gate failure exits 1; only a full gate pass exits 0. Report generation alone does not authorize success or policy admission.

The demo replays 38 retained Luna claims assessments from a pinned 498-artifact fixture without new provider calls. `gl-interested-comparison-mutated` and `gl-repeatability-mutated` are explicitly unavailable because their original captured judge outputs violated the semantic-output consistency rules; they are not treated as successful assessments. It also executes corrupted-locator and selected-digest mutations through the real extraction verifier. Assertion-text equality is mechanical; it does not establish semantic contradiction or qualifier preservation. The four-arm provider comparison, complete report replay, and capture/diff remain unfinished. Human-gold scoring is ineligible.

## Offline audit attestations

`verification attestation-export` and `verification attestation-inspect` are explicit local utilities. They do not load env files, contact an API, database, or provider, and they do not create or sign a durable verification run. Both require an already signed audit-bundle JSON file, a trusted public-key map JSON object (`{ "<key-id>": "<public PEM>" }`), and a trusted binding JSON object with exactly `builderId` and `keyId`. The builder ID must be the deployment-derived ID from the signed bundle; it is not supplied by the command.

```powershell
$env:KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM = Get-Content -Raw .\operator-attestation-private.pem
node apps/cli/dist/index.js verification attestation-export --audit-bundle .\signed-audit.json --trusted-public-keys .\trusted-public-keys.json --trusted-binding .\trusted-binding.json --output .\signed-audit.dsse.json
node apps/cli/dist/index.js verification attestation-inspect --audit-bundle .\signed-audit.json --trusted-public-keys .\trusted-public-keys.json --trusted-binding .\trusted-binding.json --attestation .\signed-audit.dsse.json
```

Export reads the private key only from `KNOWLEDGE_VERIFICATION_ATTESTATION_SIGNING_KEY_PEM`; there is no key command-line option and command output never includes it. It verifies the resulting envelope against the trusted public-key map before using exclusive creation for the single output file. Compact public metadata is returned on stdout. Inspection returns exit 0 only for a trusted exact attestation. A changed envelope, signature, subject, builder, parameters, or dependencies returns `verified:false` and exit 1.
