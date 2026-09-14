export const reportFixture = () => ({
  schemaVersion: "research-report.v1", reportId: "94000000-0000-7000-8000-000000000001", revisionId: "94000000-0000-7000-8000-000000000002", version: 1,
  title: "Example research", slug: "example", reportType: "research_synthesis", purpose: "Explain an illustrative example",
  authoringMode: "incremental", asOf: "2026-09-12T00:00:00Z", scope: { exclusions: ["Real-world claims"] }, producer: { identity: "test", version: "1" },
  sections: [{ key: "example", heading: "Example", kind: "finding", blocks: [{ key: "body", markdown: "🧪 Cafe\u0301 example.", assertions: [{ key: "a1", start: 3, end: 8, kind: "illustrative" }] }] }],
  questions: [{ key: "q1", question: "What remains unknown?", coverage: "unanswered", explanation: "Illustrative fixture only", sectionKeys: [] as string[] }],
});

