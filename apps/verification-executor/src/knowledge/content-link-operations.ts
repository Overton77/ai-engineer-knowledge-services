import { z } from "zod";
import { ContentLinkIntentSchema, ContentLinkOperationSchema } from "@aiengineer/knowledge-contracts";
import { defineOperation, type OperationDefinition } from "../operations/define.js";
import type { KnowledgeServices } from "./context.js";

const define = <I extends z.ZodObject>(operation: OperationDefinition<I, z.ZodUnknown, KnowledgeServices>) => defineOperation(operation);
const summaryOperation = ContentLinkOperationSchema.options.find(operation => operation.shape.kind.value === "summary.materialize")!;
function links(services: KnowledgeServices) {
  if (!services.contentLinks) throw new Error("CONTENT_LINK_HOST_NOT_CONFIGURED");
  return services.contentLinks;
}

export const contentLinkOperations = [
  define({ name: "content_link_plan", title: "Plan typed content links",
    description: "Read-only validation of content-link-intent.v1 against the pinned host, snapshot, admitted evidence and canonical targets; returns per-operation applied, held or no-op proposals.",
    input: z.strictObject({ intent: ContentLinkIntentSchema }), output: z.unknown(),
    cli: { command: ["content", "plan"], positional: ["intent"], jsonFiles: ["intent"] },
    run: async (input, services) => links(services).plan(input.intent) }),
  define({ name: "content_link_apply", title: "Apply typed content links",
    description: "Apply admitted content links under an exact knowledge-head lock; preserve immutable intent, plan and receipt. Replay reconciles the original receipt and canonical rows.",
    input: z.strictObject({ intent: ContentLinkIntentSchema }), output: z.unknown(),
    cli: { command: ["content", "apply"], positional: ["intent"], jsonFiles: ["intent"] },
    gate: output => (output as { outcome: string }).outcome === "rejected" ? "All content operations were held" : undefined,
    run: async (input, services) => links(services).apply(input.intent) }),
  define({ name: "content_link_receipt", title: "Reconcile a content-link receipt",
    description: "Authenticate retained receipt bytes, intent authority, dependencies and exact canonical row effects for the configured tenant.",
    input: z.strictObject({ receiptId: z.uuid() }), output: z.unknown(),
    cli: { command: ["content", "receipt"], positional: ["receiptId"] },
    run: async (input, services) => links(services).receipt(input.receiptId) }),
  define({ name: "content_summary_prepare", title: "Prepare an admitted summary representation",
    description: "Render exact admitted text and retained qualifications into a pending summary representation. Independent representation review is required before content-link summary materialization.",
    input: z.strictObject({ operation: summaryOperation }), output: z.unknown(),
    cli: { command: ["content", "prepare-summary"], positional: ["operation"], jsonFiles: ["operation"] },
    run: async (input, services) => {
      if (!services.contentSummaries) throw new Error("CONTENT_LINK_HOST_NOT_CONFIGURED");
      return services.contentSummaries.prepare(input.operation);
    } }),
];
