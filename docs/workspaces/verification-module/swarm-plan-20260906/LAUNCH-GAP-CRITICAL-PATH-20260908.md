# Launch-gap critical path — 2026-09-08

This reconciles the matrix, the WS-07 benchmark brief/acceptance, human-review v3, the offline demo map, and WS-10 launch handoff. Current count is **31 proved,8 partial,7 missing at EV-161**; the original sequence below was written at EV-150. It is a launch sequence, not a new acceptance audit. It does not lower any P0 condition. Historical pending decisions below are superseded by the current execution checkpoint at the end.

## What is already available

- Benchmark runner, immutable case/version/custody machinery, retained-pilot replay, signed reports, comparison mechanics, and local service composition have bounded evidence. The retained pilot is **not** Benchmark v1 quality evidence.
- Human-review v3 tooling is implemented, but all 180 candidates are blank; there are no authenticated human atomization, labels, adjudications, or calibration labels.
- The installed offline command produces its report/ledger/manifest inventory, but intentionally returns `verification_incomplete`/exit 2 while semantic/full-demo requirements are unmet.
- Prototype migration and the generic-owner cutover are done. They are not launch blockers and should not be reopened.

## Critical path

| Order | Gate | Finishable now | External dependency | Acceptance impact |
| --- | --- | --- | --- | --- |
| 1 | Local integrity gaps | Complete leaf value/derivation/lineage audit (VR-007), synthetic review-request/policy e2e (VR-014), fresh-chain/generated-type consumer proof (VR-026), and integrated security suite (VR-028). | None. | Removes avoidable implementation/proof gaps before labeling. |
| 2 | Freeze Benchmark v1 input | Use existing versioned candidate/import and review-pack tooling to lock 150–300 real stratified cases, source-family splits, development/calibration/locked partitions, license/capture records, and review-packet hashes. | Source-owner/legal approval for unresolved capture/license restrictions (VR-037). | Establishes a lawful immutable unit for human work. |
| 3 | Human annotation/adjudication | Execute dual independent human atomization/labels; retain qualified claim, citation, authority, conflict, and abstention labels; obtain expert adjudication for high-risk/locked disagreements. | Authorized human reviewers and subject-matter adjudicators. | Decisive dependency for VR-008/010/011/019/020/021/038/040 and human-quality VR-041. |
| 4 | Sealed paired Benchmark v1 report | Run the existing paired runner against frozen labels without tuning the locked set; publish denominators, CIs, calibration, catastrophic errors, slices, cost/latency/stability, review burden, citation correctness and completeness separately. | Completed human campaign; configured provider capability only if a new authorized arm is needed. | Supplies benchmark/report evidence without treating engineering replay as model quality. |
| 5 | Offline demo promotion | Bind the existing command to the sealed V1 dataset/report and preserve its incomplete exit for missing inputs. Add no fallback labels or silent admission. | Sealed benchmark and human/adjudication outputs. | VR-042 completes only when extraction, claim/report verification, adversarial families, and replay use sealed evidence. |
| 6 | Small external-runtime proofs | One real Cursor Cloud invocation/manifest inspection (VR-023); provision a Temporal Cloud namespace then one bounded workflow/recovery proof (VR-025); configure a scheduled deployment drift alert (VR-031). | Cursor Cloud identity/endpoint, Temporal Cloud namespace, deployment scheduler/alert target. | Local SDK/Temporal evidence cannot be relabeled Cloud evidence. |
| 7 | Release/final audit | Complete deployment/dashboard recovery/promotion under human authority (VR-036), then one independent matrix audit (VR-034). | Production deployment and human promotion authority. | Final launch evidence. |

## Dependency classification

**Human/organizational:** label creation/adjudication, source license/access approval, promotion authority. Local tests cannot resolve these.

**Cloud/infrastructure:** Temporal Cloud namespace (discovery found zero), Cursor Cloud reachable fixture/identity, deployment scheduler/alert destination, and deployment controls.

**Local engineering/proof:** VR-007, VR-014, VR-026, VR-028; release binding of the installed offline command to sealed V1 evidence; and Cloud-proof preparation only. Benchmark runner and review-pack mechanics do not need replacement implementation.

## Sequencing rule

Complete stages 1–2 before soliciting human time. Stages 3 and 6 may run in parallel once prerequisites exist. Stage 4 precedes any launch-ready offline-demo claim. Stage 7 is last. Pending human, legal, and Cloud prerequisites remain pending; they cannot be converted into local acceptance.

## EV-154 reorientation

The named local implementation/proof gaps have progressed: VR026 and VR028 are accepted; VR007 now has persisted per-leaf custody and native/legacy replay proof; VR014 has the real signed dashboard/session/proxy/worker chain and independent partial acceptance. The remaining VR007 gold audit and VR014 human-origin evidence belong to human work, not another synthetic run. Full KS72/72 and dashboard47/47 pass. Do not repeat completed native proofs without a changed source or unresolved finding.

The next local work is to reconcile the existing immutable180-case reviewer inputs and implement/test the proposed bounded loopback fixture bridge. The bridge is preparation for D017 and must not open a tunnel. D015 reviewer identities/labels, D016 Temporal namespace, D017 endpoint execution and D019 rollout remain separate pending decisions. Source rights restrictions and locked-set rules continue to apply.

## EV-155 reorientation and next execution boundary

Those two preparations are now complete: immutable180-case pack hashes/splits were reconciled and the bridge passes independent r4 review plus root9/9 tests. The isolated populated provider compatibility rehearsal reaches93→142 with unchanged legacy identity/accounting; all142 migration hashes match canonical source. Its initial JSON-text assertion false failure and corrected offline successor are both retained. Aggregate: `internal/verification-launch-preparation-EV155-20260908.json`.

Do not regenerate the reviewer pack, repeat the completed synthetic decision/leaf/parser proofs, or rerun the populated chain for fresh timestamps. Next independent work starts from actual reviewer identities/annotations and source access disposition, a provisioned Temporal namespace/address, and the D017/D019 decisions. D017 proposes one maximum30-minute ngrok endpoint against the dedicated frozen-fixture bridge; D019 proposes the49 files listed and hashed in `internal/verification-remote-readonly-plan-20260908.json` against project `wkythqbofmckbuoothhn`, after rechecking its ledger and preflight within the approved window. Stop on changed history or compatibility state. Do not use the old remote rollout script, which loads KS .env and contains stale migration-count assumptions. Do not replace human gold, actual Cloud execution or release/final audit with local engineering evidence.

## Remaining local work correction — after EV155

A current-source review found that the preceding external-dependency summary was incomplete. VR035 still needs optional standard in-toto/SLSA export and inspection; implementation is in progress against `VR035-ATTESTATION-BUILD-TYPE-20260908.md`. Existing Ed25519 seals alone do not establish support for those formats.

VR031 has a local integration gap as well as a deployment gate: immutable drift observations and fail-closed execution exist, but nothing consumes the observations to plan revalidation or deliver alerts. See `SW-VR031-IMPLEMENTATION-GAP-20260908.md`. The eventual implementation must cover provider/model/parser/grader/policy drift, use KS for verification comparisons and Mission Control for orchestration, and keep any paid revalidation separately admitted and budgeted. An environment variable or another drift unit fixture cannot close this gap.

VR015 lacks a retained live fixed-task fixture; VR016 lacks actual provider-returned precontext. See `SW-INTERFAZE-REMAINING-GATES-20260908.md`; establish the supported safe capability and grant before spending, and do not force unsupported precontext behavior. VR017 remains limited by provider-policy evidence; no sensitive-input probe is justified by its current state.

VR001's initial reconciliation finding was incorrect: the current historical facade delegates mechanics to KS. Use the corrected review and receipt, not its withdrawn duplicate-implementation claim. Do not remove that facade on the basis of the earlier finding.

## Current execution checkpoint — after EV157

The user approved D017/D019 and Temporal/Cursor testing. All49 reviewed remote migrations are applied and independently checked (EV156); optional standards attestation is complete (EV157). Neither remains pending implementation or permission.

Temporal namespace `verification-cph-20260908.ih0e7` is active. The production verificationWorkflow completed through the local KS HTTP/worker path, with duplicate-start rejection and history replay; independent acceptance review is underway. Receipt: `internal/verification-temporal-cloud-8ab2a354-3dd0-4c50-8695-6f90ac3f18e1.json`. The deterministic result requires review, with unassessed citation semantics and withheld source authority.

One actual Cursor Cloud Luna agent generated the frozen-source report. Its first32-second run completed despite a client POST timeout; exact-name reconciliation prevented duplicate creation. Because artifact listing was empty, one10-second follow-up recovered the file through the terminal result. Validated report and environment-presence booleans are retained under `internal/verification-cursor-cloud-cph-c336bfc6-0b37-4f71-979d-b4f6c3fb8745/`. Two paid Cursor runs, zero Gateway calls in this checkpoint; dollar cost not yet observed. Cursor has not yet invoked the verification endpoint.

No public tunnel has started. The approved bridge is ready; the ngrok CLI has an existing configured authtoken. Account-level full-capture state cannot yet be read: the available browser is signed out, and no ngrok API key is configured. CLI inspection can be disabled, but this does not establish account-level capture state. Prepare the actual Cursor-report MC/KS host while resolving this bounded access prerequisite.

VR031 durable drift planning, retry-safe outbox, alerts and existing Temporal orchestration integration remain active engineering work. The180-case human review pack remains unchanged and blank; human review is explicitly deferred to the team. Finish engineering work without repeatedly soliciting reviewers or treating synthetic output as human evidence.


## Current execution checkpoint — EV-159

EV-159 accepts VR-023, VR-025 and VR-031 after independent review: actual Cursor Cloud service invocation with identity/custody and duplicate reuse; actual Temporal Cloud cancellation, worker process loss/replacement, retry classification and replay; signed five-component drift comparison through registered custody, durable outbox, private API, paused Cloud schedule and published review alert. Matrix: **28 proved, 11 partial, 7 missing**. Aggregate `internal/verification-cloud-drift-EV159-20260908.json`, SHA256 `217de96161bb9266b3cd741a29fd48a7cda6edfccd8a40e7d01c88c779ace920`.

The approved temporary endpoint closed within five minutes; the Cursor agent is archived and owned proof workers/schedules are stopped/deleted. Three Cursor Luna runs in this cohort cost USD0.04202667 total (including EV158), with zero Gateway calls in this checkpoint. The original49 remote migrations plus the reviewed drift migration are applied: remote ledger209, local canonical143, database contract0.2.38 installed. Existing remote provider/budget state remained unchanged. Dashboard drift inbox passed50 unit tests, typecheck/build and one mocked browser test. Its authenticated server boundary exposes compact review alerts; no browser mutation is introduced.

Mission remains unfinished. Human review is deferred: no human labels, sealed quality benchmark, source-rights approval or semantic-quality promotion is claimed. Interfaze fixed-task/precontext/vendor-policy evidence and final release audit remain. Persistent deployment must supply admitted drift monitor handles, keys/service identities and activate its schedule; the disposable Cloud proof establishes engineering behavior. Corrected offline lifecycle scans decoded18 payloads across four histories: exact Temporal key and explicitly qualified generated-credential prefixes had zero matches. Earlier raw-SDK scans decoded zero payloads and are superseded. The final scheduled proof decoded6 payloads against all3 live credentials.

Next: resolve the narrow provider capability/policy evidence, reconcile any remaining dashboard engineering against existing durable commands, and prepare the final review handoff. Do not repeat accepted Cloud calls or synthetic human-review proofs. Human annotation and source-rights decisions remain with the team; the full sealed benchmark follows those inputs.


## Engineering handoff — EV161

EV-161 closes the remaining supported engineering integration: actual Eve → MC → Temporal Cloud; registered same-input descriptive Cursor/Eve comparison with stable canonical rerun; and dashboard selected replay plus safe manual retry/reconcile. VR-036 is accepted within existing durable command scope. Matrix: **31 proved, 8 partial, 7 missing**. Aggregate `internal/verification-engineering-handoff-EV161-20260908.json`, SHA256 `1ac262703f9924797e8ca4d1970c382414dd5f226e971c18179b2a81df01b136`; 42 exact snapshots retained.

The team can begin Mission Control implementation against the existing capability boundary. Full verification acceptance is still pending authenticated human annotations/adjudication, source rights and sensitive-input vendor approval, then the sealed quality benchmark/offline demo and final release audit. No additional model run is justified before those inputs. See [engineering handoff](ENGINEERING-HANDOFF-20260908.md).

## EV-162 offline execution progress

Current acceptance remains 31 proved, 8 partial, 7 missing. The installed command now executes and replays 40 native claim requests, three native report ledgers, exact/normalized source-statement fields, four derived mechanical mutation families, and both known report consistency mismatches. Five demo observations pass/eight unavailable; actual command exits2 with29retained files and zero provider calls. Complete structured/provider and semantic report coverage remain engineering work before final full-demo acceptance; do not reduce the remaining critical path to human review alone. See ../OFFLINE-ENGINEERING-PROGRESS-EV162-20260908.md.

## Execution checkpoint EV-163 — 2026-09-08

Native offline claim mechanics now pass all 40 cases after correcting the missing admitted projection resolver. The installed demo includes 29 captured report assertion diagnostic replays (portable fixture e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d), in addition to 38 existing claim replays, three native reports, four mechanical mutation families and 30 output files. The actual Luna calls cost USD0.009572; replay is offline. Final report-wide consistency failures stay enforced. This closes the bounded report-diagnostic integration, not full VR-041/042 or human quality acceptance. Current matrix remains 31 proved / 8 partial / 7 missing. Next engineering work is complete structured/provider-arm and remaining semantic coverage; human review/rights/vendor approval and final benchmark acceptance remain external gates. See OFFLINE-REPORT-DIAGNOSTICS-EV163-20260908.md and the current root progress ledger for exact evidence and limitations.


## EV-164 - native company fields and conservative policy replay - 2026-09-08

Added optional native HTML textRange selectors and 19 exact company-field leaves with source/parser/projection custody, fresh deterministic replay, units, qualifiers and scoped conflict sets. Composed 38 original authenticated semantic cases with canonical engineering policy/input/evidence bytes and identical policy replay: 25 review and 13 fail, with no independent corroboration or admission. Available captured verdicts now appear beside their fragments. Final installed proof: 33 files, 37,006 ms, expected exit 2, zero external calls.

Validation passed: contracts 85 tests, core verification 110, field/policy 9, API parity 1, installed CLI 1 (plus six earlier option/tamper tests), and retained pilot regression 1. Relevant builds and CLI typecheck passed. Independent range and policy integration reviews found no actionable defect. The initial unsupported inner selector and test/display encoding defects were corrected; earlier proof history remains preserved.

Final receipt: internal/verification-offline-demo-EV164-fields-policy-final-20260908.json, SHA256 a859263417af2e470b98a7fbb46c727c6725af442b50b83db71e9f7c1ac0d3a2. Aggregate: internal/verification-fields-policy-EV164-20260908.json, SHA256 155e30c82c4820d6eae4f4ac38c669753ce20ac341bf97c5d1bdd6d4f9210ed4. Its 20 exact snapshots and 33 output hashes all rehashed successfully.

The matrix remains 31 proved / 8 partial / 7 missing. Full structured/provider coverage, paired quality/gold measurements and final acceptance remain open. See OFFLINE-FIELDS-POLICY-EV164-20260908.md. Do not rerun successful paid plans or reopen completed migrations, Cloud or dashboard proofs.


## EV-167 - installed forty-case semantic replay - 2026-09-08

Composed the preserved 38-case fixture and EV166 two-case fixture into successor sha256:7067f432979212167ca1d7b797e37e6d0b5f5b180dc5919a210010017860c82c. All 40 case IDs exactly match the frozen dataset. Ten shared artifact handles and their bytes matched exactly; 524 distinct artifacts are retained. Fresh native replay of both originals and the combined fixture preserved every assessment, identity, deterministic result and authenticated source record unchanged. This is coverage across two engineering runs, not single-pass quality. Both original fixtures and prior failed attempts remain immutable.

CLI runtime and build asset pins now select the combined fixture. Installed retained proof (networking disabled, credentials removed): 35,005 ms, expected exit 2, 40 claim semantic replays, 40 policy replays (27 review / 13 fail), all 20 original/mutated pairs populated, 19 company-field leaves, one publication-eligibility abstention, 40 native claim checks, three native reports, 29 report diagnostics, four mechanical mutation families and 33 hash-verified output files. No provider calls.

Receipt: internal/verification-offline-demo-EV167-semantic-forty-20260908.json, SHA256 aaccbfe0c3fcbc152d154ae636e9309ef3eb65ecaa3ac55db378a1c60f90333b. Composition custody: internal/verification-semantic-forty-composition-20260908.json. CLI build and typecheck passed. Six CLI option/tamper tests passed initially; the installed test exposed an obsolete assertion explicitly excluding the two cases. Removed that stale assertion, retaining exact new verdict checks, and the installed target passed in 31.72 seconds. All seven relevant tests passed across these invocations. An extra ad hoc pair check initially used nonexistent key source, then was corrected to actual original; final 20/20 original+mutated presence check passed.

Acceptance remains 31 proved / 8 partial / 7 missing. Full structured/provider arms, missing named semantic mutation families, source rights, human labels/quality benchmark and final release acceptance remain open. No full semantic report admission is claimed. Native runtime, Cloud/Cursor, migrations and supported dashboard proofs need no repetition. Next: reconcile remaining required mutation/provider/extraction scope against existing pilot-v4 extraction replay and frozen-v1 grants; do not relabel pilot evidence as v1 or rerun the successful 40-case captures. Human review remains deferred.
