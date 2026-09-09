import { ActorSchema, ExternalExecutionContextSchema, OperationContextSchema, VerifyClaimsRequestSchema, VerifyReportRequestSchema, type Actor, type OperationContext, type VerificationOperationContextHints } from "@aiengineer/knowledge-contracts";
import { actorsMatch } from "@aiengineer/knowledge-config";
import { deterministicUuid, parseEveRuntimeAttestation, verifyEveRuntimeAttestation } from "@aiengineer/knowledge-runtime";
import { resolveEveVerificationBinding, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { createPublicKey } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const grantSchema = z.strictObject({
  tenantId: z.uuid(), actor: ActorSchema, missionId: z.uuid(),
  agentDeploymentId: z.string().min(1).max(255),
  capabilityVersion: z.string().min(1).max(255),
  externalExecution: ExternalExecutionContextSchema.optional(),
  eveRuntimeAuthority: z.strictObject({
    grantId: z.string().trim().min(1).max(128),
    issuer: z.string().trim().min(1).max(128),
    keyIds: z.array(z.string().trim().min(1).max(128)).min(1).max(16).refine((value) => new Set(value).size === value.length, "duplicate Eve key ID"),
  }).optional(),
}).superRefine((value, context) => {
  if (value.externalExecution !== undefined && value.eveRuntimeAuthority !== undefined)
    context.addIssue({ code: "custom", path: ["eveRuntimeAuthority"], message: "Eve authority and fixed external execution are mutually exclusive" });
});
const eveKeySchema = z.strictObject({ issuer: z.string().trim().min(1).max(128), keyId: z.string().trim().min(1).max(128), publicKeyPem: z.string().trim().min(1).max(8_192) });
const eveKeysSchema = z.array(eveKeySchema).min(1).max(64);
type OwnershipGrant = z.infer<typeof grantSchema>;
type EveAttestationKey = z.infer<typeof eveKeySchema>;

const verifiedEveRetries = new WeakMap<object, { readonly context: OperationContext; readonly observed: unknown }>();

function externalExecutionFromRequest(request: { readonly headers: Record<string, unknown> }): unknown {
  const get = (name: string) => {
    const value = request.headers[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const fields = { runtime: get("x-external-runtime"), runId: get("x-external-run-id"), rootRunId: get("x-external-root-run-id"), sessionId: get("x-external-session-id"), turnId: get("x-external-turn-id"), toolCallId: get("x-external-tool-call-id") };
  if (!Object.values(fields).some((value) => value !== undefined)) return undefined;
  return ExternalExecutionContextSchema.safeParse(fields).data;
}

/** Allows only the exact signed retry that the production resolver mapped for this request. */
export function isVerifiedEveRuntimeRetry(request: object, context: OperationContext): boolean {
  const entry = verifiedEveRetries.get(request);
  return entry !== undefined && isDeepStrictEqual(entry.context, context) && isDeepStrictEqual(entry.observed, externalExecutionFromRequest(request as { headers: Record<string, unknown> }));
}

function parseOwnershipGrants(rawGrants:string){
  if (Buffer.byteLength(rawGrants) > 262_144) throw new Error("VERIFICATION_OWNERSHIP_CONFIG_TOO_LARGE");
  const grants = z.array(grantSchema).min(1).max(256).parse(JSON.parse(rawGrants));
  const keys = new Set<string>();
  for (const grant of grants) {
    const key = `${grant.tenantId}:${grant.actor.kind}:${grant.actor.id}:${grant.missionId}`;
    if (keys.has(key)) throw new Error("DUPLICATE_VERIFICATION_OWNERSHIP_GRANT");
    keys.add(key);
  }
  return grants;
}

function parseEveRuntimeAttestationKeys(raw: string | undefined): readonly EveAttestationKey[] {
  if (!raw?.trim()) return [];
  if (Buffer.byteLength(raw, "utf8") > 262_144) throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_INVALID"); }
  const keys = eveKeysSchema.parse(parsed);
  if (new Set(keys.map((key) => `${key.issuer}:${key.keyId}`)).size !== keys.length) throw new Error("DUPLICATE_VERIFICATION_EVE_RUNTIME_ATTESTATION_KEY");
  for (const key of keys) {
    let publicKey;
    try { publicKey = createPublicKey(key.publicKeyPem); } catch { throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEY_INVALID"); }
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEY_ALGORITHM_INVALID");
  }
  return keys;
}

/** Authenticated mission readers must match the same server-owned deployment and original attempt. */
export function createVerificationOperationReadAuthorizer(database:Pick<PostgresCanonicalRepository,"transaction">,rawGrants:string,operationKinds:readonly string[]=["verification_structured_extraction"]){
  const grants=parseOwnershipGrants(rawGrants);
  if(operationKinds.length<1||operationKinds.length>16||operationKinds.some(kind=>!kind.trim()))throw new Error("VERIFICATION_READ_OPERATION_KINDS_INVALID");
  return async(input:{tenantId:string;operationId:string;actor:Actor})=>{
    const matches=grants.filter(grant=>grant.tenantId===input.tenantId&&actorsMatch(grant.actor,input.actor));
    if(matches.length===0)return false;
    return database.transaction(input.tenantId,async client=>{
      const rows=(await client.query<{mission_id:string;agent_deployment_id:string;capability_version:string;external_execution:unknown}>(`select o.mission_id,a.agent_deployment_id,
        o.request->'authenticatedContext'->>'capabilityVersion' capability_version,o.request->'authenticatedContext'->'externalExecution' external_execution
        from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id
        join orchestration.work_item w on w.tenant_id=a.tenant_id and w.id=a.work_item_id and w.id=o.work_item_id and w.mission_id=o.mission_id
        where o.tenant_id=$1 and o.id=$2 and o.operation_kind=any($3::text[])`,[input.tenantId,input.operationId,[...operationKinds]])).rows;
      return rows.length===1&&matches.some(grant=>grant.missionId===rows[0]!.mission_id&&grant.agentDeploymentId===rows[0]!.agent_deployment_id
        &&grant.capabilityVersion===rows[0]!.capability_version&&(!grant.externalExecution||isDeepStrictEqual(grant.externalExecution,rows[0]!.external_execution)));
    });
  };
}

function operationIdFor(input: { tenantId: string; useCase: string; idempotencyKey: string }): string {
  return deterministicUuid("verification-http-operation", `${input.tenantId}:${input.useCase}:${input.idempotencyKey}`);
}

async function resolveEveExecution(
  database: Pick<PostgresCanonicalRepository, "transaction">,
  keys: readonly EveAttestationKey[],
  grant: OwnershipGrant,
  input: { readonly request?: { readonly headers: Record<string, unknown>; readonly body: unknown }; readonly tenantId: string; readonly identity: { actor: Actor }; readonly correlationId: string; readonly idempotencyKey: string; readonly useCase: string; readonly hints: VerificationOperationContextHints },
): Promise<unknown | undefined> {
  const authority = grant.eveRuntimeAuthority;
  if (!authority || !input.request || (input.useCase !== "verifyClaims" && input.useCase !== "verifyReport")) return undefined;
  const expectedOperationId = operationIdFor(input);
  if (input.hints.causationId !== undefined || input.correlationId !== `eve-verification:${expectedOperationId}`) return undefined;
  const rawHeader = input.request.headers["x-eve-runtime-attestation"];
  if (typeof rawHeader !== "string" || rawHeader.length === 0 || rawHeader.length > 8_192) return undefined;
  let envelope;
  try { envelope = parseEveRuntimeAttestation(rawHeader); } catch { return undefined; }
  const key = keys.find((candidate) => candidate.issuer === envelope.payload.issuer && candidate.keyId === envelope.payload.keyId);
  if (!key || envelope.payload.issuer !== authority.issuer || !authority.keyIds.includes(envelope.payload.keyId)) return undefined;
  let payload;
  try { payload = await verifyEveRuntimeAttestation(rawHeader, key); } catch { return undefined; }
  const parsedRequest = input.useCase === "verifyClaims" ? VerifyClaimsRequestSchema.safeParse(input.request.body) : VerifyReportRequestSchema.safeParse(input.request.body);
  if (!parsedRequest.success) return undefined;
  if (payload.grantId !== authority.grantId || payload.tenantId !== input.tenantId || !isDeepStrictEqual(payload.principal, input.identity.actor) || !isDeepStrictEqual(payload.principal, grant.actor) || payload.missionId !== grant.missionId || payload.workItemId !== input.hints.workItemId || payload.attemptId !== input.hints.attemptId || payload.agentDeploymentId !== grant.agentDeploymentId || payload.capabilityVersion !== grant.capabilityVersion || payload.useCase !== input.useCase || payload.idempotencyKey !== input.idempotencyKey || payload.operationId !== expectedOperationId || payload.requestDigest !== sha256Digest(parsedRequest.data) || !isDeepStrictEqual(payload.externalExecution, input.hints.externalExecution)) return undefined;
  try { return await resolveEveVerificationBinding(database as PostgresCanonicalRepository, envelope); }
  catch (error) { if (error instanceof Error && error.message.startsWith("EVE_")) return undefined; throw error; }
}

/** Server configuration grants mission access; request headers never create grants. */
export function createVerificationOwnershipResolver(
  database: Pick<PostgresCanonicalRepository, "transaction">,
  rawGrants: string,
  options: { readonly eveRuntimeAttestationKeysJson?: string } = {},
) {
  const grants=parseOwnershipGrants(rawGrants);
  const eveKeys = parseEveRuntimeAttestationKeys(options.eveRuntimeAttestationKeysJson);
  if (grants.some((grant) => grant.eveRuntimeAuthority !== undefined) && eveKeys.length === 0) throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_REQUIRED");
  return async (input: {
    request?: { readonly headers: Record<string, unknown>; readonly body: unknown };
    tenantId: string; identity: { actor: Actor }; correlationId: string;
    idempotencyKey: string; useCase: string; hints: VerificationOperationContextHints;
  }) => {
    const { hints } = input;
    if (!hints.attemptId || !hints.missionId || !hints.workItemId) return undefined;
    const grant = grants.find(item => item.tenantId === input.tenantId && item.missionId === hints.missionId && actorsMatch(item.actor, input.identity.actor));
    if (!grant) return undefined;
    const eveAuthority = grant.eveRuntimeAuthority;
    const eveOriginalExecution = eveAuthority === undefined ? undefined : await resolveEveExecution(database, eveKeys, grant, input);
    if (eveAuthority !== undefined && eveOriginalExecution === undefined) return undefined;
    if (eveAuthority === undefined && hints.externalExecution && !isDeepStrictEqual(hints.externalExecution, grant.externalExecution)) return undefined;
    const owned = await database.transaction(input.tenantId, async client => {
      const result = await client.query(`select a.id from orchestration.attempt a
        join orchestration.work_item w on w.id=a.work_item_id and w.tenant_id=a.tenant_id
        join orchestration.mission m on m.id=w.mission_id and m.tenant_id=w.tenant_id
        where a.tenant_id=$1 and a.id=$2 and w.id=$3 and m.id=$4 and a.agent_deployment_id=$5`,
      [input.tenantId,hints.attemptId,hints.workItemId,grant.missionId,grant.agentDeploymentId]);
      return result.rows.length === 1;
    });
    if (!owned) return undefined;
    const context = OperationContextSchema.parse({
      tenantId:input.tenantId, actor:input.identity.actor, attemptId:hints.attemptId,
      missionId:grant.missionId, workItemId:hints.workItemId,
      operationId:operationIdFor(input), correlationId:input.correlationId,idempotencyKey:input.idempotencyKey,
      capabilityVersion:grant.capabilityVersion,reason:`authenticated ${input.useCase} request`,contractVersion:"v1",
      ...(hints.causationId ? {causationId:hints.causationId} : {}),
      ...(eveAuthority !== undefined ? { externalExecution: eveOriginalExecution } : grant.externalExecution ? {externalExecution:grant.externalExecution} : {}),
    });
    if (eveAuthority !== undefined && input.request && hints.externalExecution !== undefined && !isDeepStrictEqual(eveOriginalExecution, hints.externalExecution)) verifiedEveRetries.set(input.request, {
      context: OperationContextSchema.parse(structuredClone(context)),
      observed: ExternalExecutionContextSchema.parse(structuredClone(hints.externalExecution)),
    });
    return context;
  };
}
