# Choosing evidence and interpreting verification

This reference ships with the skill. It describes executor intents, not every internal
verification-library capability. Version 1.1.0 requires an executor built with extraction
rule options; old builds can strip unknown JSON fields. Pin the sandbox tarball digest and
the complete installed skill content together.

## Start with the intended assertion

Write one proposition with its subject, value, population, conditions and date. Keep qualifiers
in the proposition/report and `qualifiers`. Bind each supporting/contradicting/context quote
to a captured source. A locator says where the evidence is; it does not decide whether the
proposition follows. A mechanically `passed` claim still needs semantic assessment and policy.
Authority defaults are declarations; choose them from the source, not from the desired outcome.

## Choose a media path

| Input | Executor path | What you may conclude |
|---|---|---|
| Text, Markdown, JSON | capture-file, then read/search/locate | Exact text exists in the captured representation |
| HTML | capture URL or file, then locate converted text | Text attribution; not browser DOM/layout verification |
| PDF, Office, OpenDocument, RTF, EPUB, CSV | executor document parser, then locate returned text; requires configured provider | Text attribution to a converted document; not native page/cell-coordinate validation |
| Raw image, audio or video | Unsupported by capture-file | Stop and report the missing admitted media path |
| Transcript already available as text | Capture that text with its source identity | Evidence about the transcript, not independent validation of the original recording |

The library also has PDF-page, DOM, geometry, table, transcript-timecode, repository, dataset,
API-record, JSON-pointer and character-range selectors. These are not accepted fields in
executor claim/extraction intents. Do not invent a selector payload or use agent-authored
conversion to evade the missing media path. Follow the host's admitted preparation flow.

## Choose an extraction comparison

Every candidate leaf needs a schema field and one unique quote. Most numerical comparisons
expect strings, not JavaScript numbers.

| Comparison | Required options and spelling |
|---|---|
| exact | Candidate equals quote including formatting |
| normalized_text | Field `normalizationId` naming a top-level `normalizations` entry; operation `trim_ascii` or `ascii_whitespace_collapsed` |
| decimal | Canonical decimal string; optional decimal-string `minimum`/`maximum` |
| percentage | Decimal string followed by `%`; no percent/fraction inference |
| currency | `allowedValues` containing explicit codes; source/candidate spelling such as `USD 12.00` |
| unit, enum | `allowedValues`; exact token match; no unit conversion |
| date, datetime | Valid YYYY-MM-DD or RFC3339 timestamp with timezone |
| identifier | `identifierKind`: uuid, sha256, cve or currency_code_token; format, not registry existence |
| checksum | `checksum`: luhn or isbn13; matching evidence and valid checksum |

For a field whose unique quote must include a row label, exact extraction cannot silently
discard that label. Use a claim with context or the host's admitted structured extraction
surface. Never weaken the comparison just to obtain a pass.

## Worked scenario and failure handling

The source says “Panel A has 42 samples” and “Panel B has 42 samples”. Locating “42 samples”
returns `ambiguous`. Read the returned context, copy the full Panel A sentence, then locate it
again. `resolved` permits a claim intent using that exact quote. Mechanical `passed` means
the quote and capture checks passed. Without a semantic judge, policy returns `review` or
`abstain`; keep the claim held. A seal is not admission and cannot clear that hold.

For extraction, `USD 12.00` with allowed currency `USD` passes; changing the candidate to
`USD 99.00` fails. Removing allowed values also fails. Read the failed path/check rather than
treating exit 1 as an outage. Missing provider credentials or unsupported media is an explicit
configuration/capability problem, not evidence to invent.

If the host attaches durable recovery (or returns recovery authorization errors), the coordinator
must use the installed knowledge-verification-recovery skill before changing/retrying work.
Local fixture correction below deliberately has no production recovery host.

## Runnable scaffold

```sh
node examples/offline.mjs /absolute/path/to/installed/knowledge-verify/dist/index.js
```

Run from this skill directory with Node >=24. The template clears inherited executor/provider
configuration, makes a private temporary store and invokes the real local CLI. It deletes only
that store when done. Expected summary: mechanical passed, zero semantic judgments, policy
review/abstain, valid configured extraction, rejected changed values and unsupported image.
No external providers are mocked because none are called; content and agent decisions are
synthetic. Extend the fixture/intent while preserving the explicit failure expectations.
This is an offline demonstration, not a production authorization or live-provider smoke test.

See [intent details](intents.md) and [failure playbook](failure-playbook.md).
