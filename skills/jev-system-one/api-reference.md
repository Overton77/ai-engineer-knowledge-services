# Jev API reference

Source: docs.typesafe.ai (API, Models, jaggedness pages, reviewed 2026-09-24) plus live probes against
`jev-1.13.0` the same day. Where observed behavior differs from the docs, the observed behavior is listed.

## Request

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <JEV_API_KEY>
Content-Type: application/json
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | `jev-1.13.0` (pinned), or the aliases `jev-latest`, `jev-preview` |
| `state` | string / object / array | yes | The content every question sees. Prefer an object with named fields |
| `questions` | map of id → Question | yes | At least one. Ids are yours and are not shown to the model |

### Question

All three types take `type` and `instructions`. `instructions` may be a string, object or array; an
object lets you put the question in one field and data it refers to in others, referenced by name in
backticks.

| `type` | `criteria` | Rules |
|---|---|---|
| `choice` | map option → description (string / object / array / `null`) | 1–255 options. Always include an escape option |
| `score` | ordered array of level descriptions | 2–10 levels; index 0 is the lowest level |
| `noul` | optional `{ "true": …, "false": … }` | `true` describes the yes case |

Structured instructions example:

```json
"instructions": {
  "candidate_claim": "Temporal retries activities with exponential backoff by default.",
  "question": "Does `excerpt` support `candidate_claim`?"
}
```

## Response (HTTP 200)

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "topic":    { "type": "choice", "choice": "memory", "confidence": 0.98,
                  "probabilities": { "memory": 0.99, "retrieval": 0.01, "other": 0.0 } },
    "depth":    { "type": "score", "score": 1.67, "confidence": 0.51,
                  "legend": { "0": "Marketing or surface level", "1": "Conceptual overview", "2": "Implementation detail" },
                  "probabilities": { "0": 0.0, "1": 0.33, "2": 0.67 } },
    "has_demo": { "type": "noul", "noul": 0.78 }
  },
  "usage": { "input_tokens": 435, "output_tokens": 81 }
}
```

- `choice` is the argmax option. `probabilities` covers every option and sums to 1.
- `score` = Σ level × probability, so it can sit between levels. Use it for thresholds and ranking,
  **not** to interpolate an exact quantity between levels.
- `confidence` is derived from how peaked the distribution is (1 = all mass on one outcome). It is a
  convenience; you may compute your own measure from `probabilities`.
- `usage.output_tokens` is reported but not billed.
- Response header `x-typesafe-request-id` identifies the request. Record it.
- `probabilities` key order is not stable between calls. Identical requests differ by about ±0.01.

## Errors (observed)

| Status | Body shape | Cause | Retry? |
|---|---|---|---|
| 400 | `{"detail":{"error_type":"api_usage_error","message":"Invalid request."}}` | unknown question type, malformed question | no — fix request |
| 400 | `{"detail":{"error_type":"api_usage_error","message":"Unknown model: …"}}` | bad model name | no |
| 400 | `{"detail":"Too many score levels. Must have at most 10 levels."}` | Score with more than 10 levels | no |
| 400 | `{"detail":{"error_type":"max_tokens_exceeded"}}` | state + questions over the token budget | no — shrink or chunk the state |
| 401 | — | missing or invalid key | no |
| 422 | `{"detail":[{"type":"too_short","loc":["body","questions"],…}]}` | schema validation, e.g. empty `questions` | no |
| 429 | — | rate limit (requests/min or tokens/s) | yes, exponential backoff, honor `retry-after` |
| 529 | — | TypeSafe overloaded | yes, backoff |
| 5xx | — | transient | yes, bounded |

`detail` can be a string, an object, or a list — handle all three when reporting errors.

## Limits

| Limit | Value |
|---|---|
| Tokens per request | 64k total (state + all questions) |
| State + longest single question | 32k tokens |
| Observed capacity | 120k characters of English prose fit (21.8k tokens); 200k failed |
| Questions per request | no count limit observed; 1,000 short Nouls answered in 0.68 s |
| Requests | 1,200 per minute |
| Throughput | 250,000 tokens per second |
| Choice options | 255 |
| Score levels | 2–10 |

## Model listing

`GET https://api.typesafe.ai/v1/models` lists only the aliases. Versioned IDs such as `jev-1.13.0`
are accepted anyway. The response's `model` field always reports the versioned ID that answered.

## Vercel AI Gateway variant

Model id `typesafe-ai/jev`, type `evaluation`, called through the AI SDK (`ai` 7.0.114 or later; the
workspace's pre-research repo pins 7.0.66, which lacks it):

```ts
import { experimental_evaluate as evaluate } from "ai";

const result = await evaluate({
  model: "typesafe-ai/jev",
  state: { note },
  questions: {
    topic: { type: "choice", instructions: "Primary topic of `note`", criteria: { durable: "…", other: "None of the above" } },
    depth: { type: "score", instructions: "How technical is `note`?", criteria: ["Low", "Medium", "High"] },
    prod:  { type: "boolean", instructions: "Does `note` describe a production system?" },
  },
});
// result.answers.prod.probability          (Noul is renamed boolean / probability)
// result.providerMetadata.typesafe.confidence.topic
// result.rounding → { probabilityDecimals: 2, scoreDecimals: 2 }
```

Observed on the first call: 3.4 s end to end. The Gateway tried another host first (503), then routed
to TypeSafe. The model id is an alias, so you cannot pin `jev-1.13.0` here. Use the direct API for
calibrated or reproducible work.
