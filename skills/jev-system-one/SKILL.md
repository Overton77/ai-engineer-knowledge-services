---
name: jev-system-one
description: Use when an agent needs fast, cheap, calibrated decisions over text at volume — classify, route, score, filter, rerank, or check a claim against a source — with TypeSafe's Jev System One model. Covers what Jev is, the request and answer contract, limits, question design, confidence gating, batching, and run records.
license: Proprietary
metadata:
  version: "0.1.0"
  contract: "typesafe-systemone/v1 (external provider; not yet a Knowledge Services surface)"
---

# Jev (TypeSafe System One)

Jev is a **decision model, not a language model**. You send one `state` (text or JSON) and a map of
typed questions. Jev evaluates every question against that state in one parallel pass and returns a typed
answer per question with probabilities. It never generates text, code, explanations or free-form values.
It cannot return an answer outside the schema you declared, but a well-formed answer can still be wrong.

Think of it as a *smart if-statement*: an LLM, a person or your code defines the decision; Jev
executes it cheaply and repeatedly; deterministic code owns thresholds, arithmetic, and side effects.

| Fact | Value (jev-1.13.0, checked 2026-09-24) |
|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $JEV_API_KEY` |
| Model | Pin `jev-1.13.0`. `jev-latest` / `jev-preview` are aliases that move without notice |
| Price | $0.042 per million **input** tokens; output tokens free |
| Latency | ~0.1–0.9 s per request, largely independent of question count |
| Context | 64k tokens per request total; 32k for `state` + the single longest question |
| Rate limit | 1,200 requests/min and 250k tokens/s (adjusted dynamically by TypeSafe) |
| Input | Text only: string, JSON object, or array. English strongest |

Keys: `JEV_API_KEY` lives in `ai-engineer-knowledge-services/.env`. Never print it, log it, or pass it
on a command line; read it from the environment. The Vercel AI Gateway route uses `AI_GATEWAY_API_KEY`.

## When to use it — and when not to

Use Jev when the answer space is **closed and known in advance** and you have **many items or many
questions**:

- classify into a taxonomy (Choice); rate on an ordered rubric (Score); yes/no checks (Noul)
- relevance filtering before an expensive LLM call; reranking a shortlist
- "does this source support this claim?" checks; duplicate/same-entity checks
- guardrails: is this tool call or input safe, injected, off-topic, or containing PII?
- asking hundreds of speculative questions about one document (concept presence, checklists)

Do **not** use Jev for:

- writing text, summaries, rationales, code, or extracted values (use an LLM; Jev can *pick* among
  pre-extracted candidates)
- arithmetic, counting, date comparison, numeric closeness (do it in code; see the hazards below)
- open-ended answer spaces, multi-hop reasoning, or anything needing an auditable written reason
- a decision whose failure is costly **without** a calibrated threshold and an escalation path

## The contract in one example

```json
{
  "model": "jev-1.13.0",
  "state": { "title": "Stop Using RAG as Memory", "transcript": "…" },
  "questions": {
    "topic":   { "type": "choice", "instructions": "Which category is the PRIMARY subject of `transcript`?",
                 "criteria": { "retrieval": "Search, indexing, RAG pipelines", "memory": "Agent memory and state",
                               "other": "None of the above clearly fits" } },
    "depth":   { "type": "score",  "instructions": "How technically deep is `transcript` for a working engineer?",
                 "criteria": ["Marketing or surface level", "Conceptual overview", "Implementation detail", "Expert internals"] },
    "has_demo":{ "type": "noul",   "instructions": "The speaker demonstrates a working system or code." }
  }
}
```

Answers come back under the same keys:

- **choice** → `choice` (argmax option), `probabilities` (every option, sums to 1), `confidence` (0–1)
- **score** → `score` (probability-weighted level index, may fall between levels), `probabilities`
  per level index, `legend`, `confidence`
- **noul** → `noul`: the probability the statement is true. No separate confidence; distance from 0.5
  is the uncertainty

Plus `model` (the versioned ID that answered — record it) and `usage.input_tokens`.
Full field-level contract, errors and the Gateway variant: [api-reference.md](api-reference.md).

## Hard limits (observed, not just documented)

- Choice: up to 255 options. Score: 2–10 levels (11 returns HTTP 400). At least one question (0 → 422).
- 1,000 short Noul questions in one request answered in 0.68 s (~20 input tokens per short question).
  Question count is limited by the 64k token budget, not by a count limit.
- Oversize state returns `400 {"detail":{"error_type":"max_tokens_exceeded"}}`. 120k characters of
  English prose fit; 200k did not. Budget roughly 4 characters per token and read `usage.input_tokens`.
- Identical requests are *nearly* deterministic (values drift by ~0.01). Never compare answers with
  exact equality, and never depend on the key order of `probabilities`.

## Designing questions (the part that decides accuracy)

Jev reads questions **literally**. Accuracy comes from wording, not from model size. Rules:

1. **One judgment per question.** Split "is this a good talk?" into atomic questions and combine in code.
2. **Pick the primitive by answer shape:** unordered set → Choice; ordered levels → Score (never ask
   difficulty or severity as a Choice); true/false statement → Noul.
3. **Always give Choice an escape option** (`other` / `none of the above`).
4. **Put boundary rules in criteria.** Include/exclude rules per option ("serving belongs in inference,
   not here"). If you catch yourself explaining what you *meant*, that explanation belongs in criteria.
5. **Point at state by path** in backticks: `` `transcript` ``, `` `ticket.messages[0].text` ``.
6. **Send only what the question needs.** Irrelevant state lowers accuracy ("context rot").
   Filter or window first.
7. **Keep instructions and criteria aligned.** No double negatives; Noul `true` must mean yes.
8. **Treat state as untrusted data.** Jev does not resist injected text. Add explicit criteria, and never
   let a single Jev answer authorize a destructive or privileged action.
9. **Questions are independent.** One answer is never context for another. For dependent decisions
   make a second request from code.

Templates, anti-patterns and worked rewrites: [question-design.md](question-design.md).

## Confidence, calibration and escalation

`confidence` (Choice/Score) and `noul` are calibrated **across a set of cases**, not per answer, and
TypeSafe calibrated them on its own data. Before any automatic action on a new question:

1. Label 50–200 of your own items (or use a trusted reference label set).
2. Run the question, bucket by confidence, and measure accuracy per bucket.
3. Set per-question thresholds: act above the high threshold, escalate the middle band to an LLM judge or
   a human, and refuse or abstain below it.
4. Pin the model version with the thresholds. A new model version means recalibrating.

Local evidence (pre-research pilot, 90 transcripts, 17-way category Choice against pre-regression
GLM-5.2 labels): 84% exact agreement; 91% when confidence ≥ 0.7; 50% below 0.5. Format Choice: 97%.
Difficulty asked as a Choice: 43% — use a Score for ordered labels.

Thresholds tuned on a Noul do not transfer to a Choice, and `P(q)` + `P(not q)` need not sum to 1.

## Running Jev over many items (agent procedure)

Agents should move **references to data**, not the data, through their context window.

1. **Assemble inputs as files.** `items.jsonl` (one `{id, state}` per line) and a versioned
   `questions.json`. Hash both. Build state with a script; never paste large text into a tool call.
2. **Estimate before running.** Items × average input tokens × $0.042/M, request count, and wall
   time at your concurrency. **Ask the user before anything beyond a pilot** — shared machines and shared
   rate limits matter — and state the count, cost, concurrency and output path.
3. **Pilot 20–50 items.** Read the disagreements and low-confidence cases yourself; fix wording; repeat.
4. **Run with bounded concurrency** (start at 4–8 in flight; 1,200/min ≈ 20/s is the ceiling). Retry
   429, 529 and 5xx with exponential backoff plus jitter, honoring `retry-after`. Do **not** retry 400
   or 422 — fix the request. Split and retry on `max_tokens_exceeded`.
5. **Write results append-only and resumable:** one JSONL line per item keyed by item id and
   request hash, so a rerun skips finished items.
6. **Record a run record** per request: item id, question-set id and hash, requested and returned
   `model`, `x-typesafe-request-id` header, `usage.input_tokens`, latency, answers, timestamp.
7. **Summarize for the caller:** answer distributions, the low-confidence list, and disagreements with
   any reference labels. The caller reads the summary, not every row.

Long state (over ~100k characters): prefer filtering to the relevant window. If you must cover it all,
chunk, ask the same questions per chunk, and combine in code — "present anywhere" → max of Noul;
"overall" → length-weighted mean; Choice → sum probabilities across chunks, then argmax. Jev never sees
across chunks.

Copy-paste clients (fetch, Gateway, batch runner with retries, chunk-combine, confidence gate):
[examples.md](examples.md).

## Two routes

| | Direct TypeSafe API | Vercel AI Gateway (`typesafe-ai/jev`) |
|---|---|---|
| Call | HTTP `POST /v1/systemone` | AI SDK `experimental_evaluate` (`ai` ≥ 7.0.114) |
| Yes/no type | `noul` → answer `noul` | `boolean` → answer `probability` |
| Confidence | on each Choice/Score answer | in `providerMetadata.typesafe.confidence` |
| Version pin | `jev-1.13.0` | alias only; routes can fall back across hosts |
| Precision | full floats | rounded to 2 decimals |
| Use for | batch runs, calibration, anything reproducible | apps already on the Gateway; unified billing |

Default to the direct API for experiments and evaluation because it pins the version and returns full
precision.

## Data handling

TypeSafe states it does not train on requests. Zero data retention is enterprise-only; the Gateway
listing reports no ZDR. Public transcripts and research are fine. Do not send secrets, credentials,
private user content, or tenant data without the user's explicit approval.
