import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_MCP_CAPABILITIES,
  MCP_TOOL_CATALOG,
  VERIFICATION_MCP_TOOL_NAMES,
} from "../catalog.js";
describe("bounded MCP catalog", () => {
  it("matches the admitted Gate 6 catalog and excludes authority bypasses", () => {
    expect(Object.keys(MCP_TOOL_CATALOG)).toHaveLength(40);
    expect(Object.keys(MCP_TOOL_CATALOG)).toContain(
      "retrieval.build_evidence_packet",
    );
    expect(Object.keys(MCP_TOOL_CATALOG)).not.toContain("publication.publish");
    for (const forbidden of FORBIDDEN_MCP_CAPABILITIES)
      expect(Object.keys(MCP_TOOL_CATALOG)).not.toContain(forbidden);
  });
  it("lists only complete bounded verification tools", () => {
    expect(VERIFICATION_MCP_TOOL_NAMES).toEqual([
      "knowledge_extract_structured_data",
      "knowledge_capture_source",
      "knowledge_parse_artifact",
      "knowledge_verify_extraction",
      "knowledge_verify_claims",
      "knowledge_verify_report",
      "knowledge_verify_metric",
      "knowledge_request_adjudication",
      "knowledge_record_adjudication_decision",
      "knowledge_inspect_audit_bundle",
      "knowledge_replay_run",
      "knowledge_run_benchmark",
      "knowledge_compare_benchmark_runs",
    ]);
  });
});
