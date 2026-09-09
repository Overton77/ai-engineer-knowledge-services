import { pathToFileURL } from "node:url";
import { runDiagnosticsV1SemanticPairs } from "./prove-verification-diagnostics-v1-semantic-pairs.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDiagnosticsV1SemanticPairs("missing_two").catch(error => {
    process.stderr.write(`${JSON.stringify({ event: "verification.diagnostics_v1_semantic_missing_two.failed", errorClass: error instanceof Error ? error.name : "unknown" })}\n`);
    process.exitCode = 1;
  });
}
