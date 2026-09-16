import { z } from "zod";
import { DurableRecoveryClaimSchema, DurableRecoveryUsageSchema, VerificationRecoveryActionSchema,
  VerificationRecoveryPlanSchema, VerificationArtifactHandleSchema } from "@aiengineer/knowledge-contracts";
import { defineOperation, type OperationDefinition } from "../operations/define.js";
import type { KnowledgeServices } from "./context.js";
import { RecoverySelectorProbeRequestSchema } from "./recovery-probes.js";

const id = z.string().min(1).max(256), digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const define = <I extends z.ZodObject>(value: OperationDefinition<I, z.ZodUnknown, KnowledgeServices>) => defineOperation(value);
function host(services: KnowledgeServices) { if (!services.recovery) throw new Error("RECOVERY_HOST_NOT_CONFIGURED"); return services.recovery; }
async function scoped(services: KnowledgeServices, caseId: string) { const recovery = host(services); await recovery.authorizeCase(caseId); return recovery; }

/** Proposals carry selectors and reservations; verdicts, usage, original questions and budgets remain host-owned. */
export const recoveryHostOperations = [
  define({ name: "recovery_status", title: "Read native recovery host status", description: "Read configured native verification runs and bounded automatic-observer errors.",
    input: z.strictObject({}), output: z.unknown(), cli: { command: ["recovery", "status"] },
    run: async (_input, services) => host(services).status() }),
  define({ name: "recovery_submit", title: "Submit an authorized original verification", description: "Submit host-pinned original claims and complete question/budget authority through the existing canonical verification worker.",
    input: z.strictObject({ runId: z.uuid() }), output: z.unknown(), cli: { command: ["recovery", "submit"], positional: ["runId"] },
    run: async (input, services) => host(services).submit(input.runId) }),
  define({ name: "recovery_observe", title: "Observe an original verification", description: "Read authenticated canonical result and settled usage; automatically retain a durable recovery case for unsuccessful originals.",
    input: z.strictObject({ runId: z.uuid() }), output: z.unknown(), cli: { command: ["recovery", "observe"], positional: ["runId"] },
    run: async (input, services) => host(services).observe(input.runId) }),
  define({ name: "recovery_read", title: "Read recovery triage", description: "Read full original denominator, deterministic classifications/routes, remaining limits and durable artifact references.",
    input: z.strictObject({ caseId: id }), output: z.unknown(), cli: { command: ["recovery", "read"], positional: ["caseId"] },
    run: async (input, services) => (await scoped(services, input.caseId)).routing.read(input.caseId) }),
  define({ name: "recovery_probe", title: "Probe a bounded selector repair", description: "Run one durable provider-free representative/control probe against authorized retained bytes. This cannot admit a claim or question coverage.",
    input: RecoverySelectorProbeRequestSchema, output: z.unknown(), cli: { command: ["recovery", "probe"], positional: ["representatives"], jsonFiles: ["representatives"] },
    run: async (input, services) => (await scoped(services, input.caseId)).probes.run(input) }),
  define({ name: "recovery_plan", title: "Admit a bounded recovery plan", description: "Validate a complete original-item plan and trusted probes against original authority, limits and current revision; retain the admitted plan.",
    input: z.strictObject({ caseId: id, expectedRevision: z.int().positive(), actions: z.array(VerificationRecoveryActionSchema).min(1).max(512),
      probes: VerificationRecoveryPlanSchema.shape.probes, reservation: DurableRecoveryUsageSchema }), output: z.unknown(),
    cli: { command: ["recovery", "plan"], positional: ["actions"], jsonFiles: ["actions", "probes", "reservation"] },
    run: async (input, services) => { const recovery = await scoped(services, input.caseId); await recovery.service.plan(services.config.defaultTenantId, input); return recovery.routing.read(input.caseId); } }),
  define({ name: "recovery_claim", title: "Claim an admitted recovery plan", description: "Acquire the existing durable original/dependency locks under the configured host identity.",
    input: z.strictObject({ caseId: id, planDigest: digest, leaseMs: z.int().min(1000).max(300000).default(30000) }), output: z.unknown(),
    cli: { command: ["recovery", "claim"], positional: ["caseId", "planDigest"] },
    run: async (input, services) => (await scoped(services, input.caseId)).claim(input) }),
  define({ name: "recovery_execute", title: "Dispatch an admitted member repair", description: "Reserve one admitted original repair and dispatch its exact canonical verification operation. Replays retain the same operation identity.",
    input: z.strictObject({ claim: DurableRecoveryClaimSchema, originalId: id, reservation: DurableRecoveryUsageSchema }), output: z.unknown(),
    cli: { command: ["recovery", "execute"], positional: ["claim"], jsonFiles: ["claim", "reservation"] },
    run: async (input, services) => (await scoped(services, input.claim.caseId)).service.execute(services.config.defaultTenantId, input) }),
  define({ name: "recovery_reconcile", title: "Reconcile canonical recovery results", description: "Reconcile existing operations, authenticated usage and dependency closure without resubmitting or trusting producer verdicts.",
    input: z.strictObject({ caseId: id, planDigest: digest }), output: z.unknown(), cli: { command: ["recovery", "reconcile"], positional: ["caseId", "planDigest"] },
    run: async (input, services) => { const recovery = await scoped(services, input.caseId); await recovery.service.reconcile(services.config.defaultTenantId, input); return recovery.routing.read(input.caseId); } }),
  define({ name: "recovery_wait", title: "Checkpoint a recovery wait", description: "Enter a durable wait only after the existing checkpoint owner verifies the pinned case scope and artifact custody.",
    input: z.strictObject({ caseId: id, expectedRevision: z.int().positive(), checkpointId: z.uuid(), reason: z.string().min(1).max(1000) }), output: z.unknown(),
    cli: { command: ["recovery", "wait"], positional: ["caseId", "checkpointId"] },
    run: async (input, services) => { const recovery = await scoped(services, input.caseId); await recovery.service.wait(services.config.defaultTenantId, input); return recovery.routing.read(input.caseId); } }),
  define({ name: "recovery_resume", title: "Resume with newly authorized evidence", description: "Request resume with independently authorized new evidence; unchanged or caller-authored authority is rejected and budgets never reset.",
    input: z.strictObject({ caseId: id, expectedRevision: z.int().positive(), authorityArtifact: VerificationArtifactHandleSchema }), output: z.unknown(),
    cli: { command: ["recovery", "resume"], positional: ["authorityArtifact"], jsonFiles: ["authorityArtifact"] },
    run: async (input, services) => { const recovery = await scoped(services, input.caseId); await recovery.service.resume(services.config.defaultTenantId, input); return recovery.routing.read(input.caseId); } }),
];
