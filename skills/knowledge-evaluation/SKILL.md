---
description: Use when creating reviewed retrieval cases, running ablations, diagnosing failures, or recommending a knowledge release.
license: Proprietary
metadata:
  version: "1.1.0"
  contract: "knowledge-service/v1"
---

# Knowledge evaluation

Freeze dataset, query, judgment, policy, model, prompt, capability, and pricing versions before a run. Keep deterministic graders, model judges, and sampled human review distinct. Evaluate all required domains and exact, conceptual, mixed, constrained, multi-hop, code, contradiction, freshness, and negative query classes.

Record recall, nDCG, MRR, citation/locator validity, false acceptance, abstention, latency, cost, failures, and per-stage ablations. Classify provider, runtime, data, policy, and model failures separately. Compare candidates on identical cases and preserve regressions.

## Real evaluation and status commands

Use only the admitted platform commands: `knowledge eval generate`, `knowledge eval run`,
`knowledge eval compare`, and `knowledge eval failures`. The MCP catalog has
`evaluation.generate_query_candidates`, `evaluation.run_experiment`,
`evaluation.compare_experiments`, and `evaluation.inspect_failures`. Persist the evaluated
candidate, query set, result digest, gates and exclusions so a distinct publisher can bind them.

```text
knowledge eval generate --context '<OperationContext>' --input '<evaluation dataset input>'
knowledge eval run --context '<OperationContext>' --input '<evaluation run input>'
knowledge eval failures --context '<OperationContext>' --input '{"runId":"<uuid>"}'
```

An evaluation report is a recommendation and evidence binding. It never switches an official
pointer, revokes support, or restores a previous publication.

You may recommend promotion or rollback with a reasoned report. Never execute publication, weaken a failed hard gate, tune on locked test data, expose judge reasoning as proof, or describe a bounded smoke eval as production quality.
