# Unit 6 — canonical skills direction

Status: **proposed**, 2026-09-29. Direction stub; 5H writes the bounded implementation specification against its validated state. No skill implementation changes are made by this document.

## Target and ownership

Consolidate to the eight skills in [FINAL-LAYOUT §3](./FINAL-LAYOUT.md#3-target-layout): `knowledge-research`, `knowledge-sources`, `knowledge-preparation`, `knowledge-retrieval`, `knowledge-evaluation`, `knowledge-verification`, `knowledge-db`, `jev-system-one`. Preserve all operation coverage, recovery references, Jev capabilities and installed CLI packaging while applying that section's merge map.

Each `SKILL.md` uses the [Agent Skills standard](https://agentskills.io/specification) consumed by [DeepAgents](https://docs.langchain.com/oss/javascript/deepagents/skills):

- Required `name`: equals its directory name, lowercase letters/digits with single separating hyphens, no leading/trailing hyphen, at most 64 characters.
- Required `description`: what it does and when to use it, at most 1,024 characters.
- Optional top-level fields only: `license`, `compatibility` (at most 500 characters), `metadata` (string values only), `allowed-tools`. No KS-specific or other top-level keys.
- Concise body, under about 500 lines. Put detail in `references/`, `scripts/` and `assets/`, one level deep, and resolve every link in the installed package.

KS-specific version, operations, surfaces and per-file SHA-256 belong in `skills/manifest.json`. Stage files select skills by manifest id plus digest; the role-to-skill binding belongs to stage files, never KS or hardcoded agent roles. Pin the manifest and materialized bytes in every run manifest.

## Observed defect and exit gate

The [proof result](../../../../research_ingestion_systems_agent/agents/deepagents-stage/RESULT.md) found five skills without `name:`: `knowledge-acquisition-and-vetting`, `knowledge-evaluation`, `knowledge-preparation-and-promotion`, `knowledge-retrieval-and-evidence`, `vector-store-management`. DeepAgents warns and silently drops these; the proof loader fails closed. The current `skills/check.mjs` checks catalogs, coverage, links and digests but does not invoke DeepAgents' parser. Its existing pass is not parser conformance.

Extend that checker with the pinned DeepAgents 1.14.x `parseSkillMetadata` / `listSkills` parser path. Verify the actual exports/signatures at implementation entry. Compare the exact expected manifest ids to loaded ids and fail on every skip, invalid metadata, duplicate, missing file or digest mismatch. Enforce the stricter top-level/length rules above even if the parser only warns. Retain existing operation, surface, link and seal-versus-admission checks. Validate source and installed skill bundles; do not replace parser validation with a home-grown frontmatter approximation.

Exit: eight canonical skills with preserved coverage, conformant metadata, per-file digest manifest, zero parser skips, passing installed-bundle check and documented stage references. No Eve skill-pack-sync gate remains.

## Sequence

Unit 6 follows KS Unit 5; DR1–DR3 preparatory work may be scheduled in parallel only by explicit coordination. All Unit 6 conformance and [DR1–DR5](./DEEPAGENTS-READINESS.md) exits are required before fixtures. This stub does not reopen the accepted order: KS cleanup/readiness → DeepAgents readiness → real fixtures → Mission Control. Unit 7's previously accepted scheduling exception remains.
