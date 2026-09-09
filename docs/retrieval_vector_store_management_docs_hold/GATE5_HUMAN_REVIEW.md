# Gate 5 sampled human review

The deterministic corpus and locked judge are not a substitute for a human audit of actual retrieval behavior. This procedure creates one locked 24-case sample from the frozen 96-case broad corpus and the deterministic hybrid-control's actual ranked outputs. Hidden selection strata cover every observed domain, query class, partition, fixture kind, and abstention expectation. Reviewers see the query, requested spaces, actual applied filters, abstention behavior, returned ranks, scores, result types, locator digests, opaque graph paths, and evidence excerpts. Source case/result identities, query-class/partition/fixture labels, system-produced citation verdicts, frozen qrel grades/rationales, expected abstention, expected/forbidden filters, expected facts, and reference outcomes are withheld and committed only by digest.

Each returned-result evidence item is capped at 1,200 characters using a deterministic prefix/suffix excerpt; it records the original full-text digest, length, excerpt digest, and truncation flag so the reviewer can request the immutable full artifact when needed.

Create (or refresh) the packet and blank response template:

```powershell
corepack pnpm create:gate5-human-sample
```

An actual reviewer must edit only `catalog/gate5-human-review-response.template.json`. The minimum required input is:

- a stable, operator-verifiable `reviewerIdentity`;
- an RFC 3339 `reviewedAt` timestamp;
- one complete assessment per packet case: system retrieval relevance, citation correctness, abstention correctness, policy correctness, a decision, and a concrete rationale;
- the supplied human attestation unchanged.

The reviewer must not change the sample, packet, or dataset digest fields. A declaration alone is not identity proof. The operator validates it against a trusted reviewer identity:

```powershell
corepack pnpm validate:gate5-human -- catalog/gate5-human-review-sample.packet.json path\to\completed-human-submission.json catalog\gate5-human-review-receipt.json --verified-reviewer "reviewer@example.com"
```

The validator locks the canonical sample ID, seed, and size rather than trusting packet-selected values. It replays the exact frozen corpus and hybrid-control output, recomputes the hidden references, and compares the digest of the entire reconstructed packet—not a digest claimed by the submitted packet. The packet and sample digest also bind the public query/requested-spaces execution-input manifest; original case digests are withheld. It rejects a narrowed or mutated packet, output/reference/dataset/request drift, invalid timestamp, unrecognized fields, incomplete/duplicate assessments, invalid rubric values, and an unverified identity. Retrieval relevance requires both complete recall and no irrelevant returned item, matching the human rubric. The receipt records retrieval-relevance, citation, abstention, and policy agreement rates plus disagreements and follow-ups. It never grants publication authority; `identity_unverified` and `requires_follow_up` are explicit non-complete states.

The `--verified-reviewer` value is an operator trust boundary, not cryptographic proof that a person performed the work. The operator must establish the identity out of band and retain that audit evidence. A workspace file or self-asserted CLI invocation alone must never be treated as proof of humanness. Give the reviewer the packet and blank template only; do not give them the frozen qrels or reference-generation workspace.

Do not commit a completed reviewer submission or receipt until it was supplied and attested by an actual authorized human reviewer.
