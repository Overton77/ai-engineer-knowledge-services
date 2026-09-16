import { z } from "zod";

const Key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Artifact = z.strictObject({ artifactId: z.uuid(), digest: Digest });
const Claim = z.strictObject({
  runId: z.string().min(1).max(200), claimId: z.string().min(1).max(120), digest: Digest,
  canonicalClaimId: z.uuid().optional(), evidenceManifest: Artifact,
  role: z.enum(["supports", "premise", "context", "caveat", "contradicts"]),
});
const Assertion = z.strictObject({
  key: Key, start: z.int().nonnegative(), end: z.int().positive(),
  kind: z.enum(["reported", "observed", "derived", "interpretation", "recommendation", "illustrative"]),
  qualifiers: z.array(z.string().min(1)).max(32).default([]),
  derivation: z.record(z.string(), z.unknown()).default({}),
  claims: z.array(Claim).max(32).default([]),
});
const Block = z.strictObject({ key: Key, markdown: z.string().min(1).max(100_000), assertions: z.array(Assertion).max(512).default([]) });
const Section = z.strictObject({
  key: Key, heading: z.string().min(1).max(400),
  kind: z.enum(["scope", "summary", "finding", "comparison", "timeline", "measurement", "synthesis", "limitations", "methods", "sources"]),
  question: z.string().max(4000).optional(), conclusion: z.string().max(8000).optional(),
  context: z.record(z.string(), z.unknown()).default({}),
  dependencies: z.array(z.strictObject({ reportVersionId: z.uuid(), sectionId: z.uuid(), relation: z.enum(["requires_context", "derived_from", "supersedes"]) })).max(64).default([]),
  blocks: z.array(Block).min(1).max(256),
});

export const ReportStructureSchema = z.strictObject({
  schemaVersion: z.literal("research-report.v1"),
  reportId: z.uuid(), revisionId: z.uuid(), version: z.int().positive(), predecessorVersionId: z.uuid().optional(),
  title: z.string().min(1).max(400), slug: Key, reportType: Key, purpose: z.string().min(1).max(4000),
  authoringMode: z.enum(["incremental", "post_research"]), asOf: z.iso.datetime({ offset: true }),
  scope: z.record(z.string(), z.unknown()),
  producer: z.strictObject({ identity: z.string().min(1).max(200), version: z.string().min(1).max(200), attemptId: z.uuid().optional() }),
  inputArtifacts: z.array(Artifact).max(2048).default([]),
  sections: z.array(Section).min(1).max(128),
  questions: z.array(z.strictObject({
    key: Key, question: z.string().min(1).max(4000), required: z.boolean().default(true),
    coverage: z.enum(["answered", "partial", "unanswered", "conflicting", "out_of_scope"]),
    explanation: z.string().max(8000), evidenceNeeded: z.string().max(4000).optional(), sectionKeys: z.array(Key).max(128),
  })).min(1).max(512),
}).superRefine((report, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const unique = (keys: string[], label: string) => { if (new Set(keys).size !== keys.length) issue(`duplicate ${label}`); };
  unique(report.sections.map((section) => section.key), "section key");
  unique(report.questions.map((question) => question.key), "question key");
  const assertions = report.sections.flatMap((section) => section.blocks.flatMap((block) => block.assertions));
  unique(assertions.map((assertion) => assertion.key), "assertion key");
  if (assertions.length > 4096) issue("report exceeds 4096 assertions; split into linked reports");
  if (report.predecessorVersionId === report.revisionId) issue("revision cannot precede itself");
  for (const section of report.sections) {
    unique(section.blocks.map((block) => block.key), "block key");
    for (const block of section.blocks) for (const assertion of block.assertions) {
      if (assertion.end <= assertion.start || assertion.end > block.markdown.length) issue(`invalid UTF-16 range: ${assertion.key}`);
      for (const offset of [assertion.start,assertion.end]) if (offset>0 && offset<block.markdown.length
        && /[\uD800-\uDBFF]/.test(block.markdown[offset-1]!) && /[\uDC00-\uDFFF]/.test(block.markdown[offset]!)) issue(`UTF-16 range splits a surrogate pair: ${assertion.key}`);
      if (assertion.kind !== "illustrative" && !assertion.claims.some((claim) => ["supports", "premise"].includes(claim.role))) issue(`missing claim binding: ${assertion.key}`);
      if (["derived", "interpretation", "recommendation"].includes(assertion.kind) && Object.keys(assertion.derivation).length === 0) issue(`missing derivation or premises: ${assertion.key}`);
    }
  }
  for (const question of report.questions) {
    if (question.coverage !== "answered" && !question.explanation.trim()) issue(`missing coverage explanation: ${question.key}`);
    if (["answered", "partial", "conflicting"].includes(question.coverage) && !question.sectionKeys.length) issue(`missing answering section: ${question.key}`);
    for (const key of question.sectionKeys) if (!report.sections.some((section) => section.key === key)) issue(`unknown answering section: ${key}`);
  }
});

export type ReportStructure = z.infer<typeof ReportStructureSchema>;
export type ReportClaimReference = z.infer<typeof Claim>;
export interface RenderedAssertion {
  readonly sectionKey: string; readonly blockPointer: string; readonly proposition: string;
  readonly start: number; readonly end: number; readonly assertion: z.infer<typeof Assertion>;
}

/** The ledger offsets are derived from the exact rendition, never manually copied. */
export function renderReport(report: ReportStructure): { markdown: string; assertions: RenderedAssertion[] } {
  let markdown = `# ${report.title}\n\n`;
  const assertions: RenderedAssertion[] = [];
  for (const [sectionIndex, section] of report.sections.entries()) {
    markdown += `## ${section.heading}\n\n`;
    for (const [blockIndex, block] of section.blocks.entries()) {
      const offset = markdown.length;
      markdown += `${block.markdown}\n\n`;
      for (const assertion of block.assertions) assertions.push({
        sectionKey: section.key, blockPointer: `/sections/${sectionIndex}/blocks/${blockIndex}`,
        proposition: block.markdown.slice(assertion.start, assertion.end),
        start: offset + assertion.start, end: offset + assertion.end, assertion,
      });
    }
  }
  return { markdown, assertions };
}
