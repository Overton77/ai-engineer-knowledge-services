# Intent files accepted by the verification executor

All intents are plain JSON you write with your file tools. The executor compiles them into
verification bundles (identity, digests, actor bindings) and runs the deterministic verifier.
Every `quote` must be an exact substring of a capture and occur exactly once
(`text_quote` selector, normalization `none`). Confirm each with `knowledge-verify locate`.

The same three schemas are used on every surface (CLI, MCP tools `verify_*`, HTTP).

## verification-claims-intent.v1

```json
{
  "schemaVersion": "verification-claims-intent.v1",
  "intentId": "<runId>-claims",
  "title": "optional",
  "policyVersion": "executor-default.v1",
  "claims": [
    {
      "claimId": "opus5-context-window",
      "proposition": "Claude Opus 5 has a 1M token context window.",
      "value": "1M tokens",
      "claimType": "measurement",
      "riskClass": "low",
      "qualifiers": [],
      "entityBindings": [{ "role": "model", "canonicalId": "anthropic:claude-opus-5" }],
      "downstreamUse": ["source_attributed_report"],
      "evidence": [
        {
          "captureId": "cap-models-overview",
          "quote": "| Context window | 1M tokens | 1M tokens | 200K tokens |",
          "role": "supports",
          "authority": { "authority": "primary", "independence": "self_reported", "directness": "direct", "freshness": "current", "applicability": "direct" }
        },
        { "captureId": "cap-models-overview", "quote": "| Feature | Claude Opus 5 | Claude Fable 5.1 | Claude Haiku 4.5 |", "role": "context" }
      ]
    }
  ]
}
```

| field | notes |
|---|---|
| `claimId` | kebab-case, unique in the intent, ≤120 chars; this is what report sentences cite |
| `proposition` | one atomic sentence, ≤600 chars, fully supported by the quote(s) alone |
| `value` | optional normalized value (string, number, boolean, null) |
| `claimType` | `attribute`, `relationship`, `measurement` (numbers), `capability` (features), `compatibility`, `temporal` (dates), `causal`, `comparative`, `methodological`, `definition`, `event`, `provenance`, `recommendation`, `other`. Default `measurement`. `causal`, `comparative`, `methodological` map to stricter policy scopes. |
| `riskClass` | `low` (default), `medium`, `high`, `critical` |
| `entityBindings` | ≤8 `{ role, canonicalId }`, e.g. `vendor:product-version` |
| `evidence` | 1–8 entries. `role`: `supports` (default), `context` (header/label rows the judge needs), `qualifies`, `contradicts` |
| `evidence[].authority` | defaults `primary / self_reported / direct / current / direct` — correct for a vendor's own documentation. For third-party sources set `authority: independent`, `independence: independent`. |

## verification-extraction-intent.v1

```json
{
  "schemaVersion": "verification-extraction-intent.v1",
  "intentId": "<runId>-metrics",
  "schema": {
    "schemaId": "model-metrics",
    "schemaVersion": "1",
    "jsonSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["opus5_context_window"],
      "properties": {
        "opus5_context_window": { "type": "string", "maxLength": 64, "description": "Context window as printed" }
      }
    }
  },
  "candidate": { "opus5_context_window": "1M tokens" },
  "fields": [
    { "path": "/opus5_context_window", "comparison": "exact", "captureId": "cap-models-overview", "quote": "1M tokens" }
  ]
}
```

| field | notes |
|---|---|
| `schema.jsonSchema` | bounded object schema: root `type: object` with `properties`, `required`, `additionalProperties: false`; every node has a non-empty `description`; every string has `maxLength`; every array has bounded `items` and `maxItems`. Unbounded schemas are refused at admission (`SCHEMA_*` checks). |
| `candidate` | the extracted object; must validate against the schema. Every leaf needs a `fields[]` binding. |
| `fields[].path` | JSON pointer into `candidate` (`/models/0/context_window`) |
| `fields[].comparison` | usable through this intent: `exact` (default), `normalized_text`, `decimal`, `percentage`, `date`, `datetime`. (`currency`, `unit`, `enum`, `identifier`, `checksum` exist in the verifier but need rule options the intent does not carry yet — express those values as claims.) |
| `fields[].quote` | must occur exactly once in the capture and, under the chosen comparison, equal the candidate value |

Use `exact` unless whitespace differs (`normalized_text`) or the value is numeric text that the
source prints differently (`decimal`, `percentage`). When a quote has to be longer than the value
to be unique, prefer a claim with a `context` evidence entry.

## verification-report-intent.v1

```json
{
  "schemaVersion": "verification-report-intent.v1",
  "intentId": "<runId>-report",
  "claimsRunId": "<runId>",
  "reportArtifactId": "<artifactId returned by knowledge-verify register 50-report.md>",
  "assertions": [
    {
      "exactText": "Claude Opus 5 has a 1M token context window. [opus5-context-window]",
      "claimIds": ["opus5-context-window"],
      "claimWeight": 1,
      "severity": "medium",
      "requiredQualifiers": []
    }
  ]
}
```

| field | notes |
|---|---|
| `claimsRunId` | the run where `verify-claims` passed |
| `reportArtifactId` | from `register … --label report`; re-register after any edit (`reportText` inline is accepted but the artifact form is what the audit bundle links) |
| `assertions[].exactText` | one sentence copied verbatim from the report **including** its `[claimId]` suffix |
| `assertions[].claimIds` | 1–32 claimIds the sentence relies on |
| `severity` | `low`, `medium` (default), `high`, `critical` — high/critical sentences must rest on judged, supported claims |

The check reports `problems` (text not found, unknown claimId, claim not passed),
`uncitedVerifiedClaims`, `citationsOnFailedClaims`, `citationsUnderReview`, and a `summary`
with `citationCorrectness` and `claimWeightedCitationCompleteness`. `ok` is true only when
there are no problems, no citations on failed claims, no pointer failures, no misplaced
citations, and no unsupported high-severity assertions.
