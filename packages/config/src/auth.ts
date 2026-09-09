import { createHash } from "node:crypto";
import { ActorSchema, type Actor, type OperationKind } from "@aiengineer/knowledge-contracts";
import { z } from "zod";

export const API_ACTIONS = [
  "system.read",
  "knowledge.read",
  "operation.submit",
  "operation.control",
  "verification.drift.consume",
  "decision.record",
  "publication.execute",
  "callback.receive",
  "retrieval.plan.validate",
  "demo.evaluate",
] as const;
export type ApiAction = (typeof API_ACTIONS)[number];

export const requiredSubmissionAction = (kind: OperationKind): ApiAction =>
  ["representation_decision","promotion_decision","review_decision"].includes(kind)
    ? "decision.record"
    : ["space_publication","publication_rollback"].includes(kind)
      ? "publication.execute"
      : "operation.submit";

export const API_ROLES = [
  "knowledge_reader",
  "knowledge_operator",
  "knowledge_evaluator",
  "knowledge_admin",
] as const;
export type ApiRole = (typeof API_ROLES)[number];

const actionSchema = z.enum(API_ACTIONS);
const roleSchema = z.enum(API_ROLES);
const grantSchema = z.strictObject({
  tenantId: z.uuid(),
  roles: z.array(roleSchema).default([]),
  scopes: z.array(actionSchema).default([]),
});
const configuredIdentitySchema = z.strictObject({
  token: z.string().min(16),
  actor: ActorSchema,
  grants: z.array(grantSchema).min(1),
});
const configuredIdentitiesSchema = z.array(configuredIdentitySchema);

export interface TenantGrant {
  readonly tenantId: string;
  readonly roles: readonly ApiRole[];
  readonly scopes: readonly ApiAction[];
}

export interface LocalApiIdentity {
  readonly actor: Actor;
  readonly grants: readonly TenantGrant[];
}

export type ResolveApiIdentity = (
  token: string,
) => LocalApiIdentity | undefined | Promise<LocalApiIdentity | undefined>;

const ROLE_ACTIONS: Readonly<Record<ApiRole, readonly ApiAction[]>> = {
  knowledge_reader: ["system.read", "knowledge.read", "retrieval.plan.validate"],
  knowledge_operator: [
    "system.read",
    "knowledge.read",
    "retrieval.plan.validate",
    "operation.submit",
    "operation.control",
    "callback.receive",
  ],
  knowledge_evaluator: [
    "system.read",
    "knowledge.read",
    "retrieval.plan.validate",
    "demo.evaluate",
  ],
  knowledge_admin: API_ACTIONS,
};

const digestToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Resolves static local bearer identities. Both HTTP and MCP must use this
 * resolver so an asserted operation actor is always bound to the bearer.
 */
export function createLocalIdentityResolver(
  raw = process.env.KNOWLEDGE_API_IDENTITIES,
): ResolveApiIdentity {
  if (!raw?.trim()) return () => undefined;
  const parsed = configuredIdentitiesSchema.parse(JSON.parse(raw));
  const byDigest = new Map<string, LocalApiIdentity>();
  for (const configured of parsed) {
    const digest = digestToken(configured.token);
    if (byDigest.has(digest)) throw new Error("DUPLICATE_KNOWLEDGE_API_TOKEN");
    byDigest.set(digest, {
      actor: configured.actor,
      grants: configured.grants,
    });
  }
  return (token) => byDigest.get(digestToken(token));
}

export function isAuthorized(
  identity: LocalApiIdentity,
  tenantId: string,
  action: ApiAction,
): boolean {
  const grant = identity.grants.find(
    (candidate) => candidate.tenantId === tenantId,
  );
  if (!grant) return false;
  const actions = new Set<ApiAction>(grant.scopes);
  for (const role of grant.roles)
    for (const roleAction of ROLE_ACTIONS[role]) actions.add(roleAction);
  return actions.has(action);
}

export function actorsMatch(authenticated: Actor, asserted: Actor): boolean {
  if (
    authenticated.kind !== asserted.kind ||
    authenticated.id !== asserted.id
  )
    return false;
  if (authenticated.kind === "service" && asserted.kind === "service")
    return authenticated.serviceIdentity === asserted.serviceIdentity;
  if (authenticated.kind === "model" && asserted.kind === "model")
    return (
      authenticated.serviceIdentity === asserted.serviceIdentity &&
      authenticated.model === asserted.model &&
      authenticated.providerRunId === asserted.providerRunId
    );
  return true;
}
