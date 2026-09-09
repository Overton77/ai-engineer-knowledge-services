# Knowledge Services experiments

Prototyping and live proofs. Scripts load `ai-engineer-knowledge-services/.env` via `tsx --env-file=.env`. Do not print tokens or PEMs.

Module inventory (CLI, MCP, HTTP-only, library-only), every verification sequence, and why the model-card script had to write `occurrences` / `bindQuote`: [verification-module-sequences.md](verification-module-sequences.md).

| Experiment | What it proves | Command |
| --- | --- | --- |
| [model-card-verification](model-card-verification/README.md) | A producer (Vercel AI SDK + `openai/gpt-5.6-terra`) extracts metrics from a live model-card page, then standalone verification stages run: capture integrity, selector integrity, mechanical correctness, semantic support. | `corepack pnpm experiment:model-card-verification` |
