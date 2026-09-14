# Failure playbook

Every failure the executor returns is deterministic and actionable. Find the code or verdict,
apply the fix, re-run the same command. Never work around a failure by paraphrasing, by citing
uncaptured text, or by editing files the executor produced.

## Capture

| symptom | cause | fix |
|---|---|---|
| `FIRECRAWL_SCRAPE_FAILED:4xx/5xx` | the page blocked the scraper or timed out | retry once; then try `--method https_get`; then another URL for the same fact |
| `FIRECRAWL_MARKDOWN_EMPTY` | JS-only page or empty PDF text layer | find the HTML equivalent of the page, or a different primary source |
| `CAPTURE_ID_CONFLICT:<captureId>:existing=…:new=…` | the same `--capture-id` was reused for different bytes (page changed, or a different URL) | pick a new `--capture-id`; never reuse an id for different content. Re-capturing identical bytes under the same id is fine (`reused: true`) |
| URL capture and `capture-file` of the same PDF have different text digests | the URL was scraped in place instead of downloaded and parsed | `.pdf` URLs are downloaded + parsed by default; for a PDF served without a `.pdf` extension use `--method https_get` so both paths share the parser |
| `HTTPS_GET_FAILED:404/403` | wrong or gated URL | re-check the URL with your discovery skill (`map`/`search`); never capture a search-result page as a source |
| `HTTPS_GET_TEXT_EMPTY` | page has no text body | use `--method firecrawl` (JS rendering) |
| `HTTPS_GET_DOCUMENT_REQUIRES_FIRECRAWL` / `CAPTURE_FILE_DOCUMENT_REQUIRES_FIRECRAWL` | binary document but the executor has no `FIRECRAWL_API_KEY` | report the configuration gap; do not convert the document yourself |
| `CAPTURE_FILE_UNSUPPORTED_TYPE` | extension/media type not capturable (see `media-types`) | obtain the document in a supported format (pdf, docx, xlsx, pptx, csv, html, md, txt, json, …) |
| `characters` very small (< 500) or preview shows cookie banner / login | not the real page | discard the capture, choose another URL |
| `reused: true` | same captureId and same bytes as before | fine; nothing changed |

## Locate

| status | meaning | fix |
|---|---|---|
| `ambiguous` (`occurrenceCount > 1`) | the quote appears several times | extend the quote with the row label / preceding heading / next cell; use `suggestions` |
| `not_found` (`occurrenceCount 0`) | paraphrased or formatting differs (pipes, spaces, unicode dashes, footnote markers) | `search <captureId> "<a few words>"` and copy the `exact` substring it returns |

## verify-claims (mechanical)

| check / resolution | meaning | fix |
|---|---|---|
| `evidence[].resolution: not_found` + `EVIDENCE_RESOLUTION_FAILED` | quote is not a substring | re-locate and copy exactly |
| `evidence[].resolution: ambiguous` + `LOCATOR_UNIQUE` | quote not unique | extend it |
| `CAPTURE_NOT_FOUND:<captureId>` (error, exit 2) | typo in captureId | check `10-captures.md`; captureIds are case-sensitive |
| `EXPECTED_SELECTED_CONTENT_DIGEST_MATCH` | the quote changed between locate and verify | re-locate, copy the exact text |
| `ASSERTION_ATOMIC` | proposition too long / compound | split into one claim per fact |
| `CAPTURE_DIGEST_MATCH`, `CAPTURE_BYTE_LENGTH_MATCH` | capture artifact changed under you | re-capture with a new captureId and re-locate |
| `PRODUCER_VERIFIER_INDEPENDENT` | producer and verifier deployment ids collide | executor configuration problem; report it, do not retry |
| zod `issues` on stderr (exit 2) | intent shape wrong (unknown field, missing `claims`, bad enum, quote > 4000 chars) | compare with references/intents.md |

## verify-extraction

| check | meaning | fix |
|---|---|---|
| `schemaAdmitted: false` with `SCHEMA_STRING_BOUND_REQUIRED`, `SCHEMA_ARRAY_BOUND_REQUIRED`, `SCHEMA_OBJECT_POLICY_REQUIRED`, `SCHEMA_DESCRIPTION_REQUIRED` | schema unbounded (missing `maxLength`, `maxItems`, `additionalProperties: false`, `required`, or a `description` on a node) | bound the schema; every property needs `description` and, for strings, `maxLength` |
| `candidateValid: false` with `CANDIDATE_TYPE`, `CANDIDATE_REQUIRED_MISSING`, `CANDIDATE_ADDITIONAL_PROPERTY`, `CANDIDATE_STRING_BOUND` | candidate violates the schema | fix the candidate value/type |
| `FIELD_EXACT_MATCH` / `FIELD_NORMALIZED_TEXT_MATCH` / `FIELD_DECIMAL_MATCH` / … failed at `path` | candidate ≠ quote under `comparison` | make the candidate the exact printed value, or switch comparison (`normalized_text`, `decimal`, `percentage`, `date`) |
| `FIELD_EVIDENCE_MISSING` / `FIELD_CANDIDATE_MISSING` | a `fields[]` path has no candidate value or vice versa | every leaf in `candidate` needs one field binding |
| `FIELD_RULE_INVALID` | comparison needs options the intent cannot express (`unit`, `enum`, `identifier`, `checksum`, `currency` with allowed values) | use `exact` / `normalized_text` / `decimal` / `percentage` / `date` / `datetime`, or express the value as a claim |
| `EVIDENCE_RESOLUTION_FAILED` / `LOCATOR_UNIQUE` | quote problem | same as locate |

## judge

| verdict | meaning | fix |
|---|---|---|
| `directly_supported` | admitted | — |
| `supported_with_qualification` | admitted; keep the qualification in the report sentence | — |
| `partially_supported` | quote shows the value but not the entity/metric/condition | add a `context` evidence entry (header row, section title), or narrow the proposition |
| `insufficient_evidence` | quote does not contain the fact | pick a better quote or drop the claim |
| `not_supported` / `contradicted` | the source says something else | drop the claim; if the contradiction matters, record it in the report's Verification section as "not found / contradicted in source" without asserting the value |
| `skipped[].reason: no_resolved_text_quote_fragments` | assertion failed mechanically | fix step 5 first |
| `AI_GATEWAY_API_KEY_REQUIRED` | executor has no judge credentials | report the configuration gap |

After changing any claim, re-run `verify-claims`, then `judge`, then `policy`, then `seal`.

## policy

| outcome / reason | meaning | fix |
|---|---|---|
| `pass`, `pass_with_warnings` | admitted | — |
| `review` + `SEMANTIC_REVIEW_REQUIRED` | an assertion has no admitted verdict (not judged yet, or `pending_semantic_review`) | run `judge`, or drop the claim |
| `review` + `QUALIFIED_OR_PARTIAL_SUPPORT` / `SEMANTIC_SUPPORT_NOT_FULL` | judge returned `partially_supported` | add context evidence or narrow the proposition, then re-run 5 → 7 → 8 |
| `review` + `MIXED_OR_CONFLICTING_EVIDENCE` | supports + contradicts evidence on one claim | split or drop |
| `fail` + `MECHANICAL_ASSERTION_FAILURE` / `MECHANICAL_BUNDLE_FAILURE` | you ran policy on a run whose claims did not pass | fix step 5 first |
| `SEMANTIC_DISPOSITION_FAIL` / `SEMANTIC_DISPOSITION_ABSTAIN` on an assertion | never cite that claimId | drop it from the report |
| `POLICY_VERSION_MISMATCH` (exit 2) | `--policy` file version ≠ intent `policyVersion` | align the versions |
| `RUN_HAS_NO_CLAIMS_VERIFICATION` (exit 2) | `verify-claims` has not run for this runId | run step 5 |

## seal

| symptom | fix |
|---|---|
| `RUN_HAS_NO_CLAIMS_VERIFICATION` / missing decision (exit 2) | run `verify-claims`, `judge`, `policy` first |
| `inspection.valid: false` (exit 1) | an artifact changed after policy; re-run `policy` then `seal` |
| `LINEAGE_PARENT_MISSING:<artifactId>` (exit 2) | the run state references a derived artifact whose parents are not in this run. Re-run `policy` then `seal`. If it persists, the store is stale: report it, do not hand-edit the store |
| sealing twice | `seal` is idempotent for an unchanged run. After *any* change (a claim fix, a re-judge) the chain is `verify-claims` → `judge` → `policy` → `seal` again; skipping `policy` is the usual cause of a failed re-seal |

## check-report

| problem | fix |
|---|---|
| `REPORT_TEXT_NOT_FOUND:<index>:<text>` | assertion `<index>`'s `exactText` is not byte-identical to the report: copy again, keep the `[claimId]` suffix, re-register the report if you edited it and update `reportArtifactId` |
| `UNKNOWN_CLAIM_ID:<claimId>` | claimId not in the claims intent that passed | fix the id or remove the citation |
| `citationsOnFailedClaims` non-empty | you cited a dropped or failed claim | remove the sentence or the citation |
| `uncitedVerifiedClaims` non-empty | verified claims you did not use; cite them or mention in the summary why not |
| `citationsUnderReview` non-empty | claims with `review` outcome; resolve at step 7/8 or remove |
