# Experimental embedding bundles for vector-space implementation

Status: supplementary briefing for the vector-space management swarm  
Authority: this note describes **fixture input**, not a second publication path  
Store class of the seed: `internal_exploratory`  
Canonical spec in this folder: `AGENTIC_KNOWLEDGE_PREPARATION_AND_RETRIEVAL_SERVICE_SPEC.md`  
Database contract: sibling repo `ai-engineer-db-contract`  
Seed home (sibling repo): `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/`

Use this seed to mock **vetting and content choice** while you implement vector-space management, chunking, projections, embeddings, publication, and retrieval. The hard identity work (who the engineer is, which org/product/library is real, which URLs are official) is already done. You do **not** need to re-run research-starter pre-research.

Implementors may enrich the files if a more realistic conversion or extraction fixture is needed. Treat that as local experiment input. Do not silently promote this seed to `official_canonical`.

## Why this exists

The knowledge-service pipeline is:

```text
content choice → document conversion → extraction → optional summaries
  → split → embed → retrieve
```

The research-starter flywheel already finished three AI Engineer talks. A later vetting pass then:

1. Picked the obvious primary engineer, organization, products, libraries, papers, case studies, and official sources.
2. Wrote those identities into `corpus.*` and `evidence.source` (plus typed relations).
3. Slightly cleaned transcripts and rewrote research summaries around engineering claims and strategy.
4. Emitted JSON documents that can be the first admitted inputs to this service.

Pre-research had treated talk concepts as libraries (`Value when right`, `evals`, `Context Engineering`, `Dumb Zone`). Those were rejected. Libraries in this seed are real packages or official source repos.

## Start here

From the workspace root (`aiengineer/`):

| Role | Path |
| --- | --- |
| Catalog of all three talks | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/outputs/catalog.json` |
| Seed README | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/README.md` |
| Bundle JSON contract | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/contracts/embedding-bundle.schema.md` |
| Apply receipts | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/outputs/apply-receipt.json` |

The three **embedding bundles** (the files you should open first):

| Talk | Bundle |
| --- | --- |
| Harrison Chase / LangChain | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/videos/kTnfJszFxCg/outputs/embedding-bundle.json` |
| Doug Guthrie / Braintrust | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/videos/bk0TmxoZlUY/outputs/embedding-bundle.json` |
| Dex Horthy / HumanLayer | `research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/videos/rmvDxxNubIg/outputs/embedding-bundle.json` |

Each `embedding-bundle.json` is schema `ai-engineer-embedding-bundle/0.1.0`. It contains:

- `store_class`: `internal_exploratory`
- `primary.engineer` / `primary.organization`
- `selected_documents[]` — already-chosen texts with `document_kind`, `canonical_url`, `source_role`, `source_class`, `target_vector_spaces`, and `text`
- `engineering_claims[]` — attributed speaker assertions with locator excerpts

Suggested first spaces from the spec: `engineering_claims`, `entity_profiles`, `tool_capabilities`, `source_native_sections`. `paper_case_study_knowledge` is listed in the catalog but this seed has almost no papers (Braintrust has one customer case study).

## Per-talk file set

Every video folder has the same layout.

```text
research_starter_pre_research_agent/experiments/embedding-bundle-seed-2026-09-01/videos/<video_id>/
  inputs/                         downloaded pre-research packet + raw transcript
  outputs/
    embedding-bundle.json         selected documents + claims (pipeline input)
    optimized-transcript.txt      light ASR cleanup only
    optimized-summary.json        claims, strategy, surrounding capability context
    dossier.json                  entities, official sources, rejected items
    ingestion-intent.json         deterministic corpus/source write (already applied)
    STATUS.md                     selected vs rejected, open questions
```

| File | Use it for |
| --- | --- |
| `embedding-bundle.json` | Default admitted input to conversion / chunk / embed experiments |
| `optimized-transcript.txt` | Faithful `source_native_sections` / transcript representation |
| `optimized-summary.json` | Derived `semantic_projection` candidate (must stay evidence-linked) |
| `dossier.json` | Entity-resolution and content-choice mock: people, orgs, products, libraries, sources |
| `ingestion-intent.json` | What was upserted into the shared DB; do not re-author unless you are adding identities |
| `inputs/` | Rawer packet if you want a less-cleaned conversion fixture |

## The three talks

### 1. LangChain — `kTnfJszFxCg`

- Title: *3 ingredients for building reliable enterprise agents*
- Engineer: Harrison Chase (`harrison-chase`, GitHub `hwchase17`)
- Org: LangChain (`langchain`, vendor, langchain.com)
- Products: LangGraph, LangSmith, LangChain (platforms)
- Libraries: `pypi/langgraph`, `pypi/langchain`
- Papers / case studies: none promoted
- 14 speaker-attributed claims (reliability equation, workflow-and-agents, LangSmith for review boards, ambient ≠ autonomous)
- Official sources include langchain.com, docs.langchain.com, github.com/langchain-ai, Chase’s ambient-agents blog

### 2. Braintrust — `bk0TmxoZlUY`

- Title: *Evals 101*
- Engineer: Doug Guthrie (`doug-guthrie`, solutions engineer)
- Secondary person: Ankur Goyal (`ankur-goyal`, CEO/founder; ASR said “Anker Goyle”)
- Org: Braintrust (`braintrust`, braintrust.dev, GitHub `braintrustdata`)
- Product: hosted Braintrust platform (`braintrust-platform`) — not the same as the open SDKs
- Libraries: `braintrust` and `autoevals` on both PyPI and npm
- Case study: Notion HITL customer page (`notion-braintrust-hitl`)
- Papers: none
- 15 claims (offline/online evals, task/dataset/scores, autoevals, human review, SDK vs platform)

### 3. HumanLayer — `rmvDxxNubIg`

- Title: *No Vibes Allowed: Solving Hard Problems in Complex Codebases*
- Engineer: Dex Horthy (`dex-horthy`)
- Org: HumanLayer (`humanlayer`, humanlayer.dev)
- Product: HumanLayer IDE
- Library: `source/humanlayer` (registry package was not assumed)
- Concepts kept as claims, not libraries: Context Engineering, Frequent Intentional Compaction, Dumb Zone
- Papers: none — the 100k-developer rework citation has no verified DOI/arXiv
- 12 claims (brownfield agents, compaction, sub-agents for context control)

## What is already in the shared database

Tenant: `00000000-0000-7000-8000-000000000001`.

Applied intents (idempotent; do not mint a second identity for the same slug):

| Video | Idempotency key | Intent id |
| --- | --- | --- |
| `kTnfJszFxCg` | `video:kTnfJszFxCg:corpus-seed:v1` | `01a06006-506b-7151-b618-86c879010cd9` |
| `bk0TmxoZlUY` | `video:bk0TmxoZlUY:corpus-seed:v1` | `01a06006-6efd-7e15-a080-c1c27861b017` |
| `rmvDxxNubIg` | `video:rmvDxxNubIg:corpus-seed:v1` | `01a06006-d76a-76f8-bcc0-fdc7efa41f7a` |

You should find typed rows for:

- `corpus.person`, `corpus.organization`, `corpus.product`, `corpus.library`, `corpus.repository`, `corpus.video`, `corpus.talk`
- `corpus.case_study` (Notion / Braintrust only)
- identifiers, employment/founding, appearances, org–product, library–repo, repo maintained-by-org
- `evidence.source` rows pointing at official homepages, docs, GitHub orgs/repos, first-party blogs, and the YouTube recordings

An older Cohere / Vivek Muppalla seed is also in this tenant. Leave it alone unless a test explicitly needs it.

Lookup examples:

```sql
select slug, display_name from corpus.person
 where slug in ('harrison-chase','doug-guthrie','ankur-goyal','dex-horthy');

select slug, display_name, website_url from corpus.organization
 where slug in ('langchain','braintrust','humanlayer','notion');

select ecosystem, package_name from corpus.library
 where package_name in ('langchain','langgraph','braintrust','autoevals','humanlayer');

select platform, external_id, title from corpus.video
 where external_id in ('kTnfJszFxCg','bk0TmxoZlUY','rmvDxxNubIg');

select source_class, canonical_url, publisher from evidence.source
 where canonical_url ilike '%langchain%'
    or canonical_url ilike '%braintrust%'
    or canonical_url ilike '%humanlayer%';
```

Re-apply (only if a local DB is missing the rows):

```bash
# from research_starter_pre_research_agent/
node --experimental-strip-types --import ./scripts/register-ts.mjs \
  experiments/embedding-bundle-seed-2026-09-01/scripts/apply-corpus-intents.mts --apply
```

## How implementor agents should use this

Default path:

1. Read `outputs/catalog.json`, then one `embedding-bundle.json`.
2. Treat `selected_documents[]` as already-vetted content-choice output.
3. Map each document into knowledge-service identities: source → capture/document/version → representation → chunk set → `search_projection` → vector item.
4. Bind embeddings to the spec spaces. Do not add embedding columns on `corpus.*`.
5. Keep `store_class` as `internal_exploratory` until evaluation gates exist.
6. Join retrieval results to the corpus slugs already stored (`harrison-chase`, `langgraph`, `braintrust`, …).

You may operate on the input to make fixtures more realistic. Allowed:

- Fetch the official URLs already listed in `dossier.json` / `evidence.source` and run them through conversion (Unstructured / Docling) so you have real structural nodes.
- Split the optimized transcript into document nodes and claim-linked chunks.
- Author extra `search_projection` texts from the existing claims (keep attribution and locators).
- Add eval queries grounded in the claim statements.
- Copy a bundle into this knowledge-services repo as a test fixture if the worker/API needs an in-repo path. Prefer a `testkit` / `catalog` fixture over inventing a second seed.

Still required:

- New papers need DOI, arXiv, or OpenReview.
- Do not invent libraries from talk jargon.
- Do not write `pre_research_pipeline_finished` or re-run Eve pre-research.
- Do not publish this seed as `official_canonical` from a vector-space experiment.
- Do not create shadow person/org/library rows inside retrieval tables. Point at `corpus` ids/slugs.

## Bundle document kinds you will see

`talk_transcript`, `research_summary`, `entity_profile`, `official_homepage`, `official_docs`, `official_repository`, `official_blog`, `case_study`.

Source roles: `official`, `primary`, `authoritative_secondary`.

Claims use `claim_role: attributed_speaker_assertion` unless a first-party doc independently matches the statement.

## Do not treat this folder as the service

`ai-engineer-knowledge-services` still owns conversion, chunk identity, projections, embeddings, vector-space versions, publication, and retrieval. The seed is only admitted **input**. Schema and grants stay in `ai-engineer-db-contract`.
