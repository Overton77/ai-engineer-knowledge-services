# Recovery request bodies

Every body below is shaped by an implemented Zod schema in `@aiengineer/knowledge-contracts`
(`verification/recovery.ts`, `verification-recovery-durable.ts`) or by the executor's probe request
(`apps/verification-executor/src/knowledge/recovery-probes.ts`). Digests are `sha256:` plus 64 hex
characters; ids elided as `…` are real identifiers from the case you just read.

## 42-representatives.json — one probe round for a shared cause

`recovery_probe` takes `representatives[]` positionally; `caseId` and `dependencyId` are flags.

```json
[
  {
    "originalId": "claim-018",
    "binding": {
      "claim": { "statement": "The August 2026 API price for the model is 2.50 USD per 1M input tokens.", "qualifiers": ["api_tier_standard"] },
      "evidence": [
        {
          "representationDigest": "sha256:1f…",
          "selector": { "kind": "text_quote", "quote": "$2.50 / 1M input tokens", "prefix": "Standard | ", "normalization": "lf_whitespace_collapsed" },
          "contextDigest": "sha256:2a…"
        }
      ],
      "captureDigests": ["sha256:3b…"],
      "policyDigest": "sha256:4c…",
      "profileDigest": "sha256:5d…"
    }
  }
]
```

The repaired selector adds the row label as a `prefix` so the quote resolves exactly once. The probe
runs against retained bytes only: `calls` and `costMicros` in its receipt are always `0`, and its
`checks[]` report `representationDigest`, `selectorDigest` and `status` per evidence entry.

## 43-actions.json — one action per original item

`route` is one of `preserve`, `reconcile`, `adjudicate`, `repair`, `seek_evidence`, `reject`, `gap`,
`operator`, `exhausted`, `cancelled`. `rerunStages` is drawn from `capture`, `parser`, `selector`,
`mechanical`, `semantic`, `policy`, `report`.

```json
[
  {
    "originalId": "claim-018",
    "route": "repair",
    "newBinding": { "claim": { "statement": "…", "qualifiers": ["api_tier_standard"] }, "evidence": [{ "representationDigest": "sha256:1f…", "selector": { "kind": "text_quote", "quote": "Standard | $2.50 / 1M input tokens", "normalization": "lf_whitespace_collapsed" }, "contextDigest": "sha256:2a…" }], "captureDigests": ["sha256:3b…"], "policyDigest": "sha256:4c…", "profileDigest": "sha256:5d…" },
    "rerunStages": ["selector", "mechanical", "semantic", "policy"],
    "reason": "Header row omitted from the original selector; probe resolved once with the row label.",
    "diagnosticArtifactIds": ["…"],
    "dependencyId": "capture-pricing-pdf"
  },
  {
    "originalId": "claim-021",
    "route": "gap",
    "rerunStages": [],
    "reason": "No admitted source states the 2024 context window; the original question keeps its gap.",
    "diagnosticArtifactIds": ["…"]
  },
  {
    "originalId": "claim-030",
    "route": "adjudicate",
    "rerunStages": [],
    "reason": "Policy returned review; two captured sources disagree on the GA date.",
    "diagnosticArtifactIds": ["…"]
  }
]
```

## 44-probes.json and 45-reservation.json

```json
[{ "dependencyId": "capture-pricing-pdf", "representativeIds": ["claim-018"], "controlId": "claim-009", "receiptArtifacts": [] }]
```

```json
{ "calls": 24, "costMicros": 180000 }
```

The reservation must fit inside the case `limits.remainingCalls` / `limits.remainingCostMicros`, and
the plan must carry an action for every original item in the batch.

## 46-claim.json — the lease returned by `recovery_claim`

Pass it back verbatim; `token` and `fencingToken` are what make a replay the same execution instead
of a second one.

```json
{
  "tenantId": "…", "caseId": "…", "planDigest": "sha256:…",
  "holderIdentity": "verification-recovery@…", "token": "…", "fencingToken": 7,
  "expiresAt": "2026-09-14T18:20:00.000Z", "keys": ["original:claim-018", "dependency:capture-pricing-pdf"]
}
```

## 49-authority.json — new evidence for `recovery_resume`

A `VerificationArtifactHandle` registered by an authorized producer other than you: `artifactId`,
`digest`, `byteLength`, `objectKey`, `createdAt`, `producerActivityId`, `producerVersion`,
`encryptionClass`, `retentionClass`, `dataClassification`, `parentArtifactIds`. Self-authored or
unchanged authority is rejected, and a resume never restores a spent budget.

## Reading the result

`recovery_read` and `recovery_reconcile` both return the case projection: `state`
(`ready`, `active`, `waiting`, `complete`), `revision`, `items[]` with
`originalId`/`classification`/`route`/`family`/`earliestStage`/`diagnosticArtifactIds`/`latestOutcome`,
`limits`, `spent`, `reserved` and the retained artifact references. The per-item outcomes are
`preserved_admitted`, `recovered_admitted`, `partial_support`, `resolved_rejected`, `review_required`,
`operator_required`, `exhausted`, `cancelled`, `reconciliation_unresolved`, `unresolved_gap`.

A completed case is not a published report and not canonical admission. Re-assess the report with
`knowledge report assess <reportVersionId>` and rebind canonical links through
`knowledge content plan`; registration and sealing are custody, never admission.
