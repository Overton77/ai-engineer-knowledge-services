# Jev examples

All examples use Node ≥ 20 with no dependencies unless noted, and read the key from the environment.
Keep large inputs in files and pass paths, not text, through agent context.

## 1. One request (curl)

```bash
curl -s -X POST https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $JEV_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"jev-1.13.0","state":{"note":"Our agent loop now survives worker crashes."},
       "questions":{"prod":{"type":"noul","instructions":"`note` describes a production system."}}}'
```

## 2. One request (fetch) with proper error reporting

```js
async function jev(state, questions, model = "jev-1.13.0") {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.JEV_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // detail may be a string, an object {error_type, message}, or a validation list
    throw new Error(`Jev ${response.status} ${response.headers.get("x-typesafe-request-id")}: ${JSON.stringify(body?.detail)}`);
  }
  return { ...body, requestId: response.headers.get("x-typesafe-request-id") };
}
```

## 3. Batch over a file (reference runner)

[scripts/jev-batch.mjs](scripts/jev-batch.mjs) is a tested, dependency-free, resumable runner:

```bash
node skills/jev-system-one/scripts/jev-batch.mjs items.jsonl questions.json results.jsonl 4
```

- `items.jsonl`: one `{"id": "...", "state": ...}` per line.
- `questions.json`: `{"id", "version", "model", "questions"}`. Its hash goes on every result line.
- Retries 429/529/5xx and network errors with backoff and jitter, honoring `retry-after`. Records
  400/422 without retrying.
- Appends one run record per item: item id, request hash, question-set id/version/hash, requested
  and returned model, `x-typesafe-request-id`, status, attempts, latency, input tokens, answers, error,
  timestamp.
- A rerun skips items whose identical request already succeeded, so an interrupted run resumes.
- Prints elapsed seconds, input tokens, cost, and failures to stderr.

Start with concurrency 4; raise only after a clean pilot and with the user's approval.

## 4. Confidence gate

```js
// thresholds come from calibration on your own labeled items, per question and per model version
function gate(answer, { act, review }) {
  const certainty = answer.type === "noul" ? Math.abs(answer.noul - 0.5) * 2 : answer.confidence;
  if (certainty >= act) return "act";
  if (certainty >= review) return "escalate"; // LLM judge or human
  return "abstain";
}
```

## 5. Calibration table

```js
// rows: [{ jev: "<option>", confidence: 0.83, label: "<reference option>" }]
function calibration(rows, edges = [0, 0.5, 0.7, 0.9, 1.01]) {
  return edges.slice(0, -1).map((low, i) => {
    const bucket = rows.filter((r) => r.confidence >= low && r.confidence < edges[i + 1]);
    const correct = bucket.filter((r) => r.jev === r.label).length;
    return { range: `${low}-${Math.min(1, edges[i + 1])}`, n: bucket.length, accuracy: bucket.length ? correct / bucket.length : null };
  });
}
```

Pick the lowest bucket whose accuracy meets the task's bar as the `act` threshold.

## 6. Long state: chunk, ask, combine

```js
function chunks(text, size = 60_000, overlap = 2_000) {
  const out = [];
  for (let start = 0; start < text.length; start += size - overlap) out.push(text.slice(start, start + size));
  return out;
}
// "mentioned anywhere" → max over chunks
const anywhere = (nouls) => Math.max(...nouls);
// "overall" → length-weighted mean
const overall = (nouls, lengths) => nouls.reduce((sum, p, i) => sum + p * lengths[i], 0) / lengths.reduce((a, b) => a + b, 0);
// Choice → sum each option's probability across chunks, then argmax
function combineChoice(answers) {
  const totals = {};
  for (const answer of answers) for (const [option, p] of Object.entries(answer.probabilities)) totals[option] = (totals[option] ?? 0) + p;
  return Object.entries(totals).sort((a, b) => b[1] - a[1])[0][0];
}
```

Prefer filtering to the relevant window over chunking a whole document. Jev never sees across chunks.

## 7. Speculative fan-out: concept matrix

```js
const vocabulary = ["durable execution", "retries", "evaluation harness", "vector index", "prompt caching"];
const questions = Object.fromEntries(vocabulary.map((concept, i) => [
  `c${i}`, { type: "noul", instructions: `\`transcript\` explains or demonstrates ${concept}.` },
]));
// one request per document returns a probability for every concept
```

## 8. Vercel AI Gateway (AI SDK)

```ts
import { experimental_evaluate as evaluate } from "ai"; // ai >= 7.0.114, AI_GATEWAY_API_KEY set

const { answers, providerMetadata } = await evaluate({
  model: "typesafe-ai/jev",
  state: { note },
  questions: { prod: { type: "boolean", instructions: "`note` describes a production system." } },
});
answers.prod.probability;               // not .noul
providerMetadata?.typesafe?.confidence; // Choice/Score confidence lives here
```

## 9. Two-stage triage (Jev first, LLM second)

1. Jev scores every item: relevance Score plus the Nouls your downstream step needs.
2. Code keeps high-confidence rejects out, auto-accepts high-confidence passes, and sends only the
   middle band to the expensive LLM.
3. Record which stage decided each item. That lets you measure the LLM's disagreement rate with Jev
   and move thresholds on evidence.
