# WS-04 parser/projection/extraction admission handoff

Implementation-owner handoff. The bounded native PDF/HTML admission route is complete and independently accepted in `ADMISSION-REVIEW.md`; full WS-04 remains open for the unsupported modalities and semantic/provider composition listed below.

## Application boundary

`VerificationAdmissionService` composes the parser, registered-artifact repository, and the accepted pure extraction verifier through existing horizontal ports. Network, process, storage, and database access remain outside the pure verification package.

The public operations are:

- `parseAndAdmit({ tenantId, captureId, expectedSourceArtifact, kind, signal? })`;
- `hydrateAdmittedProjection({ tenantId, captureId, expectedSourceArtifact, transformationArtifactId, projectionArtifactId })`; and
- `verifyExtraction({ tenantId, expectedSourceArtifact, schema, candidate, fields, evidence, totals? })`.

Admission first resolves the persisted capture by tenant and capture ID and compares its registered artifact ID and digest before any byte hydration. It then authorizes and hydrates the registered source artifact, runs the native parser, iteratively preflights the complete raw result, and validates every projection, residual, parser version, image digest, options digest, transformation signature, page count, page identity, and cross-projection binding. Array work and string encoding are rejected before exceeding their budgets; native and envelope bytes are capped before JSON decoding, and parsed values are depth/node preflighted before canonicalization. Deployment limits and application configuration are snapshotted and frozen at construction. Abort state is checked after source hydration, after parsing, before each persistent write, and before return. No parser output is registered until the entire result is valid.

The route registers the source-specific native output, content-addressed canonical projection, and a canonical `verification-projection-admission.v1` transformation envelope. An envelope binds tenant, capture, exact source/native/projection IDs and digests, projection ordinal, parser version, immutable image digest, options digest, transformation signature, and residual digest. Its persisted parent list is exactly `[source, native, projection]`.

Hydration does not treat that envelope as an unused receipt. It re-authorizes and hydrates the source, envelope, native output, and projection; strictly parses the canonical envelope; checks its exact parent order and complete identity; reruns native-output projection validation; and requires the ordinal output bytes to equal the registered projection bytes. Only then is the projection re-admitted to the pure extractor, whose runtime handles are intentionally process-local.

## Content-addressed collision behavior

`PostgresVerificationRepository.registerContentAddressedArtifact` reuses an existing same-tenant content artifact only when its type, bucket class, storage bucket, object key, media type, byte length, and hydrated bytes all agree. It returns the original immutable registration rather than rewriting its time or producer metadata.

Projection content can therefore be reused across parents. Each parent receives a distinct transformation envelope and three persisted `generated` lineage edges. Reuse also requires exact content encoding, encryption class, retention class, data classification, parent list, transformation signature, and attestation identity; producer and creation time remain those of the original registration. The real proof used two separately registered HTML captures whose comments differ but whose parser projections are byte-identical. It confirmed one original projection registration, different parent-specific envelopes, rejection of a cross-parent envelope, rejection of public-classification downgrade and changed-parent CAS reuse, acceptance of the correct envelope, and all 15 expected database lineage edges.

## Strict failure behavior

Focused tests cover tenant mismatch before authorization/hydration, forged parent digest, parser version and image mismatch, wrong projection artifact ID, mutated projection bytes, malformed PDF shape, unsupported repository/dataset output, cross-parent envelope substitution, oversized arrays/keys/native/envelope bytes, post-construction configuration mutation, and cancellation before or between writes. Malformed or unregistered provider output causes zero admission writes. Projection route and output key sets are exact; PDF visual residuals are required per page, and HTML admits the declared layout residual only.

The application bounds raw JSON nodes, nesting, strings, native routes, and extraction projections. `verifyExtraction` accepts at most eight unique admitted projection/envelope pairs. Repository call counts are bounded, but remote latency semantics are not claimed.

## Real restricted-source proof

`node internal/verification-run-local-proof.mjs admission` obtains local Supabase values in memory and refuses non-local Postgres or Storage targets. It does not load the workspace cloud `.env` and does not print credentials. Against the existing local canonical database and actual HTTP Storage it passed 18/18 checks in tenant `acb4bf56-cb82-42af-923f-bbff2908360d`.

The proof registered the restricted 4,019,343-byte, 24-page TruDiagnostic PDF (`sha256:b5d7f9798de00dd73dd6f287f95876f0dce09cb085c701e630d99f14bd4f4ea1`) and captured HTML (`sha256:b623cec22b5a340ef27eedfe32702485d2115ddf8b6b1b00e97458a519f319d5`) from `../../../../internal/verification-source-captures/20260905`. It admitted native and projection artifacts, resolved the exact PDF page-2 chronological-age field `29.4`, rejected its mutated value and locator, retained the page visual residual, and abstained on a graph-only value unavailable through the text selector. It also resolved the exact HTML support-hours field and rejected an ambiguous selector with a fallback, proving there is no implicit fallback after ambiguity.

Evidence: `../../../../internal/verification-admission-proof-20260905-08484a6c-f982-4b10-aea4-b0ced7206584.json`, SHA-256 `4040e74a9f9922ac8e60c0b5369f278c9afd3d769bc33ec445b4c131d38ba3d2`. Restricted source bytes and native outputs remain outside the distributable repository.

The coordinator independently rebuilt the public package exports and repeated the same 18 checks and 15 lineage-edge assertions. Its accepted receipt and log are recorded in `ADMISSION-REVIEW.md`.

## Validation and identities

- focused application admission tests: 5/5, log `../../../../internal/verification-admission-targeted-20260905-r2.log`, SHA-256 `e0485d9252c91db008283e659e750d621cc49778c3dc15257f9c6b6eef62a70d`;
- final `corepack pnpm verify`: typecheck 42/42 tasks, tests 42/42 tasks, builds 24/24 tasks; immutable log `../../../../internal/verification-admission-full-verify-20260906-r2.log`, SHA-256 `57eab3f17df5a0779d8ac9ed18586d08bc9c33c90a5e1065b3d8a9473d1fa072`;
- `packages/application/src/verification-admission.ts`: `de6c330b2a4dfcdfd5d066a8bb92474513d8cc624067ac5594535d8f67bd2242`;
- `packages/application/src/verification-admission.test.ts`: `3e5d120ef66d6859805a57dc02f5fe465a805d21d68ef54415d6e7889eb7475f`;
- `packages/persistence/src/verification.ts`: `a2729799a0f1451ac0cf3db00ed0585893aee5f4c49ac6c080763006e91dac7c`.

The earlier base-name logs `verification-admission-targeted-20260905.log` and `verification-admission-full-verify-20260905.log` were overwritten during review reruns, so their previously observed hashes are superseded and unavailable as authoritative evidence. The uniquely named `-r2` logs above are the retained final receipts and must not be overwritten.

The additive canonical migration `20260905021000_verification_parser_admission_artifact_types.sql` admits the three artifact types and has SHA-256 `e45b213ac726a9f87489bbe092c2e314f3390805d5b5189ab11c27137c1089b9`. It was applied to the existing local project without reset or deletion. EV-023 independently proves the full 79-migration series on an empty isolated database and confirms all three types; the existing project was untouched by that audit.

## Remaining gates

Native image/OCR, repository, dataset, API, transcript, audio/video, office-document, and general provider routes remain explicit unsupported outcomes. Browser layout and PDF visual extraction need separate admitted representations. Repository/dataset commit and version identity are not inferred from caller metadata.

Admission prevents any writes for malformed parser output. Artifact and lineage registration is transactional per artifact, but the present storage/database port does not provide one transaction across an entire multi-artifact parse. An infrastructure failure after preflight can leave a valid prefix of registered artifacts; an idempotent retry recovers content, but whole-result atomicity under storage/database failure remains a composition requirement.

The extraction result proves declared mechanical comparisons. It does not establish that independently selected company, period, method, and value fields belong to one semantic fact; WS-05 must compose entity/metric/period consistency and policy. API, worker, CLI, MCP, and operation-receipt surfaces remain WS-08. Production authorization, deployment, lifecycle, and timeout evidence remain later gates.

The generic provenance replay path currently hydrates its manifest-named canonical projection and accepts a supplied selector resolver without invoking `hydrateAdmittedProjection` or binding this transformation envelope. The admission service proves parser lineage for its own extraction path only. General verification-bundle replay must receive an admission-backed resolver/context before it can claim authenticated parser derivations; this is an explicit WS-05/WS-08 integration gate.
