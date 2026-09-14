import { errorPayload, exitCodeFor, runKnowledgeCli } from "./knowledge/cli.js";

export { runKnowledgeCli, KNOWLEDGE_HELP } from "./knowledge/cli.js";

const invokedDirectly = (() => {
  const entry = process.argv[1] ?? "";
  return /verification-executor[\\/](dist|src)[\\/]knowledge\.(js|ts)$/.test(entry) || /[\\/]knowledge(\.cmd|\.js)?$/.test(entry);
})();

if (invokedDirectly) {
  runKnowledgeCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    process.exitCode = exitCodeFor(error);
  });
}
