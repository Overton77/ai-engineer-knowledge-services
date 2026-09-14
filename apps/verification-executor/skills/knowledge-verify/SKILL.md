---
name: knowledge-verify
description: >-
  Use when a task needs verified, source-attributed facts: capture sources as immutable
  evidence, locate exact quotes, write claims / extraction / report intent files, and run the
  knowledge-verify CLI chain (verify-claims → verify-extraction → judge → policy → seal →
  check-report). Also use when a capture, locate, or verification step failed and you need
  the recovery procedure, or when you must capture a PDF, DOCX, XLSX, CSV or other document.
allowed-tools:
  - Bash(knowledge-verify *)
---

# knowledge-verify — verified research procedure (CLI surface)

`knowledge-verify` is the command-line face of the knowledge-verification executor. The
executor runs **outside** your sandbox (`VERIFY_EXECUTOR_URL` is set); the CLI forwards each
command and prints one JSON document. You cannot edit its store, its receipts, or its verdicts.
Failures it returns are instructions, not obstacles.

Run `knowledge-verify help` once for the full command list. Every command below is safe to
re-run: the store is content-addressed and every mutation is appended as a step receipt under
your `--run <runId>`.

## Preflight (do this first)

```bash
knowledge-verify health                       # must print {"status":"ok",...}
RUN=<topic-slug>-$(date -u +%Y%m%d)           # ONE runId for the whole task, e.g. anthropic-system-cards-20260909
mkdir -p /workspace/run && cd /workspace/run
```

Use the same `--run "$RUN"` on every call so all receipts land in one run. If the task gives
you a runId, use that one verbatim.

## The evidence rule (overrides every other skill)

1. **Captured bytes are the only evidence.** A fact exists only if it is an exact, contiguous
   substring of a capture made with `knowledge-verify capture` or `knowledge-verify capture-file`.
2. Search engines, scrapers, extractors and other CLIs (Firecrawl, Tavily, curl) are **for finding
   URLs and previewing pages only**. Their output is a lead. Never quote it, never register it as
   an artifact, never cite it. When a preview looks useful, capture the URL with this CLI and quote
   from the capture.
3. **Quotes are copied, never paraphrased**, and must occur exactly once in the capture
   (`locate` → `status: resolved`, exit 0).
4. **One claim = one atomic proposition** fully supported by its quote(s). If a quote is a table
   cell, add a second evidence entry with `role: "context"` quoting the header/label row so the
   judge can see what the number measures.
5. You write **intent files**; you never construct bundles, digests, manifests or verdicts.
6. Every factual sentence of the final report ends with `[claimId]`; sentences without a verified
   claim are framing only (no numbers, dates, names of products/features).

## Sequence

Work top to bottom. Do not skip a stage; do not start the next stage until the current one's
quality gate passes (exit code 0). Write the listed file at the end of each stage so progress is
observable.

| # | stage | command(s) | quality gate (exit 0) | file |
|---|---|---|---|---|
| 1 | plan | — | — | `00-plan.md` |
| 2 | discover | other skills (search / map) → candidate URLs | — | append to `00-plan.md` |
| 3 | capture | `capture <url> --run $RUN --capture-id <id>` / `capture-file <path> …` | command succeeds; inspect `characters` and `preview` | `10-captures.md` |
| 4 | inspect + locate | `read`, `search`, `locate` | `locate` → `resolved` for every quote | `20-quote-ledger.md` |
| 5 | claims | write intent → `verify-claims 30-claims-intent.json --run $RUN` | `status: passed`, `semanticEligibility: true` | `30-claims-intent.json` |
| 6 | extraction (when metrics were requested) | `verify-extraction 40-extraction-intent.json --run $RUN` | `valid: true` | `40-extraction-intent.json` |
| 7 | judge | `judge --run $RUN` | every `assessed[].verdict` admitted | — |
| 8 | policy | `policy --run $RUN` | `outcome: pass` or `pass_with_warnings` | — |
| 9 | seal | `seal --run $RUN` | `inspection.valid: true` | — |
| 10 | report | write report → `register 50-report.md --label report --run $RUN` → write report intent → `check-report 60-report-intent.json --run $RUN` | `ok: true` | `50-report.md`, `60-report-intent.json` |
| 11 | summary | `status --run $RUN --out 70-status.json` | — | `70-run-summary.md` |

### 3. Capture

```bash
knowledge-verify capture "https://vendor.example/docs/models" --run "$RUN" --capture-id cap-models --out 10-cap-models.json
knowledge-verify capture-file ./paper.pdf --run "$RUN" --capture-id cap-paper --source-uri "https://where/it/came/from.pdf"
knowledge-verify media-types                 # what can be captured and how it is converted
```

- Quote URLs (shells treat `?` and `&` specially). Prefer primary sources on the vendor's domain.
  Prefer HTML docs pages over PDFs when both exist (tables in markdown are easier to quote); still
  capture the PDF when it is the canonical artifact.
- `--out <file>` writes the full JSON to a file and prints a compact summary; use it for
  captures and `status`, whose output is large.
- Read `characters` and `preview`. A tiny capture, a login wall, a 404 body or a cookie banner is
  not a source: discard it and try another URL. Record every kept capture (captureId, URL, title,
  characters, digest) in `10-captures.md`.
- Documents: `capture` handles html, markdown, json and, behind a URL, pdf / docx / doc / odt /
  rtf / xlsx / xls / pptx / ppt / epub / csv. `capture-file` handles the same types from a local
  path. The executor converts the document to markdown itself and stores the original bytes as a
  second artifact (`originalArtifact`), so the capture is trustworthy. Never convert a document
  yourself and then capture the converted text.

### 4. Inspect and locate

```bash
knowledge-verify read cap-models --offset 0 --length 6000
knowledge-verify search cap-models "context window" --limit 5
knowledge-verify locate cap-models "| Context window | 1M tokens | 200K tokens |"   # exit 0 ⇔ resolved
```

For every quote you intend to use, run `locate` and record `status`, `occurrenceCount` and
`selectedContentDigest` in `20-quote-ledger.md`.

- `ambiguous` (exit 1, `occurrenceCount > 1`): extend the quote until it is unique (include the
  row label, the preceding heading, or the next cell). The output's `suggestions` show longer
  unique candidates.
- `not_found` (exit 1): you paraphrased or the text is formatted differently. Use `search` to
  find the real wording and copy it exactly, including punctuation and table pipes.
- Aim for the **shortest unique** quote that still contains the value **and** an identifier of
  what it measures. If that is impossible, keep the short value quote and add a `context` quote.

### 5. Claims intent → mechanical verification

Write `30-claims-intent.json` (`verification-claims-intent.v1`, schema in
[references/intents.md](references/intents.md)), then:

```bash
knowledge-verify verify-claims 30-claims-intent.json --run "$RUN" --out 31-claims-result.json
```

Exit 0 means `status: passed`. Otherwise open `31-claims-result.json`, look at each failed
assertion's `evidence[].resolution` (`not_found` / `ambiguous`) and `failedChecks`, fix the
quote or drop the claim, and re-run. Never drop a claim and then restate its content uncited.
Keep a list of dropped claims for the summary.

### 6. Extraction intent (structured metrics)

When the task asks for a metrics table, write `40-extraction-intent.json`
(`verification-extraction-intent.v1`): a small bounded JSON schema (`additionalProperties:
false`, `required`, a `description` on every node, string fields with `maxLength`), a `candidate`
object with the values exactly as printed, and `fields` binding each JSON pointer to
`{ captureId, quote, comparison }` — one binding per leaf.

```bash
knowledge-verify verify-extraction 40-extraction-intent.json --run "$RUN" --out 41-extraction-result.json
```

Exit 0 means `valid: true`. Otherwise fix the paths listed in `failedPaths`. `comparison: exact`
requires the candidate value to equal the quote character for character; if the quote must be
longer than the value to be unique, use a claim instead of an extraction field.

### 7. Semantic judge

```bash
knowledge-verify judge --run "$RUN" --out 45-judge.json
```

Exit 0 means every assessed verdict is `directly_supported` or `supported_with_qualification`.
For any other verdict (`partially_supported`, `insufficient_evidence`, `not_supported`,
`contradicted`) the quote does not establish the proposition: add `context` evidence, narrow the
proposition to what the quote literally says, or drop the claim — then re-run from step 5 (a new
`verify-claims` resets the judge, policy and seal state for the run).

### 8. Policy

```bash
knowledge-verify policy --run "$RUN" --out 46-policy.json
```

Exit 0 means `pass` or `pass_with_warnings`. `review` means some assertions were only partially
supported or lack a judge verdict: fix them or drop them (step 5 → 7 → 8 again). Never cite a
claim whose `assertionOutcomes[].outcome` is `fail` or `abstain`.

### 9. Seal

```bash
knowledge-verify seal --run "$RUN" --out 47-seal.json
```

Record `manifestDigest`, `payloadDigest`, `inspection.valid` in the summary. Seal once, after
policy passes; a later `verify-claims` invalidates the seal and you must seal again.

### 10. Report and report check

Write `50-report.md`: title, date, scope paragraph; a **Sources** section listing every capture
(captureId, title, URL, capturedAt, digest); findings where every factual sentence ends with
`[claimId]`; a **Verification** section (runId, claims passed/total, judge verdict counts, policy
outcome, manifest digest, dropped claims and why). Then:

```bash
knowledge-verify register 50-report.md --label report --run "$RUN"      # → reportArtifactId
# write 60-report-intent.json with that reportArtifactId and one assertion per cited sentence
knowledge-verify check-report 60-report-intent.json --run "$RUN" --out 61-report-check.json
```

Exit 0 means `ok: true`, `problems: []`, `citationsOnFailedClaims: []`. `REPORT_TEXT_NOT_FOUND`
means an `exactText` no longer matches the report byte for byte: **write the report intent only
after the report is final**, copy sentences verbatim including the `[claimId]` suffix, and
re-register the report whenever you edit it (the artifactId changes).

### 11. Summary

```bash
knowledge-verify status --run "$RUN" --out 70-status.json
```

Write `70-run-summary.md` (runId, captures, claims passed/total, judge verdicts, policy outcome,
manifest digest, report check result, dropped claims, every artifactId you registered, every
file you wrote) and finish your turn with a short message repeating those numbers.

## Exit codes

| code | meaning | what to do |
|---|---|---|
| 0 | command succeeded and its quality gate passed | continue to the next stage |
| 1 | command succeeded, quality gate failed (`{"qualityGate":"failed","reason":…}` on stderr, full JSON on stdout / `--out`) | read the JSON, fix the quote / intent / report, re-run |
| 2 | usage, network, auth or executor error (`{"error":…}` on stderr) | fix the command; if `health` fails, stop and report the outage |

## Style for the report

Plain and precise. Values exactly as the source prints them (units and formatting kept). Keep a
benchmark's conditions in the sentence (e.g. "with extended thinking"). Say when something was
not found in any captured source instead of guessing.

## References

- [references/intents.md](references/intents.md) — the three intent schemas with field-by-field notes
- [references/failure-playbook.md](references/failure-playbook.md) — every failure code and its recovery
