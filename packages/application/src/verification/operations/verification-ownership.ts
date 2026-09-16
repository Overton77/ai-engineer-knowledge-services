import {
  ActorSchema,
  ExternalExecutionContextSchema,
  OperationContextSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  type Actor,
  type EveRuntimeAttestationEnvelope,
  type EveRuntimeAttestationPayload,
  type OperationContext,
  type VerificationOperationContextHints,
} from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import {
  deterministicUuid,
  parseEveRuntimeAttestation,
  verifyEveRuntimeAttestation,
} from "@aiengineer/knowledge-runtime";
import { createPublicKey } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type {
  ResolveVerificationContext,
  VerificationContextResolutionInput,
  VerificationOwnershipStore,
} from "./verification-transport.js";

const OWNERSHIP_CONFIG_MAX_BYTES = 262_144;
const EVE_ATTESTATION_HEADER_MAX_LENGTH = 8_192;
const EVE_VERIFICATION_USE_CASES = new Set(["verifyClaims", "verifyReport"]);
const EXTERNAL_EXECUTION_HEADER_NAMES = {
  runtime: "x-external-runtime",
  runId: "x-external-run-id",
  rootRunId: "x-external-root-run-id",
  sessionId: "x-external-session-id",
  turnId: "x-external-turn-id",
  toolCallId: "x-external-tool-call-id",
} as const;
const OWNED_ATTEMPT_SQL = `select a.id from orchestration.attempt a
        join orchestration.work_item w on w.id=a.work_item_id and w.tenant_id=a.tenant_id
        join orchestration.mission m on m.id=w.mission_id and m.tenant_id=w.tenant_id
        where a.tenant_id=$1 and a.id=$2 and w.id=$3 and m.id=$4 and a.agent_deployment_id=$5`;
const OWNED_OPERATION_READ_SQL = `select o.mission_id,a.agent_deployment_id,
        o.request->'authenticatedContext'->>'capabilityVersion' capability_version,o.request->'authenticatedContext'->'externalExecution' external_execution
        from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id
        join orchestration.work_item w on w.tenant_id=a.tenant_id and w.id=a.work_item_id and w.id=o.work_item_id and w.mission_id=o.mission_id
        where o.tenant_id=$1 and o.id=$2 and o.operation_kind=any($3::text[])`;

const grantSchema = z.strictObject({
  tenantId: z.uuid(),
  actor: ActorSchema,
  missionId: z.uuid(),
  agentDeploymentId: z.string().min(1).max(255),
  capabilityVersion: z.string().min(1).max(255),
  externalExecution: ExternalExecutionContextSchema.optional(),
  eveRuntimeAuthority: z
    .strictObject({
      grantId: z.string().trim().min(1).max(128),
      issuer: z.string().trim().min(1).max(128),
      keyIds: z
        .array(z.string().trim().min(1).max(128))
        .min(1)
        .max(16)
        .refine((value) => new Set(value).size === value.length, "duplicate Eve key ID"),
    })
    .optional(),
}).superRefine((value, context) => {
  if (value.externalExecution !== undefined && value.eveRuntimeAuthority !== undefined)
    context.addIssue({
      code: "custom",
      path: ["eveRuntimeAuthority"],
      message: "Eve authority and fixed external execution are mutually exclusive",
    });
});
const eveKeySchema = z.strictObject({
  issuer: z.string().trim().min(1).max(128),
  keyId: z.string().trim().min(1).max(128),
  publicKeyPem: z.string().trim().min(1).max(8_192),
});
const eveKeysSchema = z.array(eveKeySchema).min(1).max(64);
type OwnershipGrant = z.infer<typeof grantSchema>;
type EveAttestationKey = z.infer<typeof eveKeySchema>;
type EveRuntimeAuthority = NonNullable<OwnershipGrant["eveRuntimeAuthority"]>;

export type ResolveEveVerificationBinding = (
  envelope: EveRuntimeAttestationEnvelope,
) => Promise<unknown>;

export interface VerificationOwnershipResolverOptions {
  readonly eveRuntimeAttestationKeysJson?: string;
  readonly resolveEveBinding?: ResolveEveVerificationBinding;
}

const verifiedEveRetries = new WeakMap<object, { readonly context: OperationContext; readonly observed: unknown }>();

function actorsMatch(authenticated: Actor, asserted: Actor): boolean {
  if (authenticated.kind !== asserted.kind || authenticated.id !== asserted.id) return false;
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

function headerString(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function externalExecutionFromRequest(request: {
  readonly headers: Record<string, unknown>;
}): unknown {
  const fields = {
    runtime: headerString(request.headers, EXTERNAL_EXECUTION_HEADER_NAMES.runtime),
    runId: headerString(request.headers, EXTERNAL_EXECUTION_HEADER_NAMES.runId),
    rootRunId: headerString(request.headers, EXTERNAL_EXECUTION_HEADER_NAMES.rootRunId),
    sessionId: headerString(request.headers, EXTERNAL_EXECUTION_HEADER_NAMES.sessionId),
    turnId: headerString(request.headers, EXTERNAL_EXECUTION_HEADER_NAMES.turnId),
    toolCallId: headerString(request.headers, EXTERNAL_EXECUTION_HEADER_NAMES.toolCallId),
  };
  if (!Object.values(fields).some((value) => value !== undefined)) return undefined;
  return ExternalExecutionContextSchema.safeParse(fields).data;
}

/** Allows only the exact signed retry that the production resolver mapped for this request. */
export function isVerifiedEveRuntimeRetry(
  request: object,
  context: OperationContext,
): boolean {
  const entry = verifiedEveRetries.get(request);
  return (
    entry !== undefined &&
    isDeepStrictEqual(entry.context, context) &&
    isDeepStrictEqual(
      entry.observed,
      externalExecutionFromRequest(request as { headers: Record<string, unknown> }),
    )
  );
}

function assertUniqueKeys(keys: readonly string[], duplicateCode: string): void {
  if (new Set(keys).size !== keys.length) throw new Error(duplicateCode);
}

function parseOwnershipGrants(rawGrants: string): OwnershipGrant[] {
  if (Buffer.byteLength(rawGrants) > OWNERSHIP_CONFIG_MAX_BYTES)
    throw new Error("VERIFICATION_OWNERSHIP_CONFIG_TOO_LARGE");
  const grants = z.array(grantSchema).min(1).max(256).parse(JSON.parse(rawGrants));
  assertUniqueKeys(
    grants.map(
      (grant) => `${grant.tenantId}:${grant.actor.kind}:${grant.actor.id}:${grant.missionId}`,
    ),
    "DUPLICATE_VERIFICATION_OWNERSHIP_GRANT",
  );
  return grants;
}

function parseEveRuntimeAttestationKeys(
  raw: string | undefined,
): readonly EveAttestationKey[] {
  if (!raw?.trim()) return [];
  if (Buffer.byteLength(raw, "utf8") > OWNERSHIP_CONFIG_MAX_BYTES)
    throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_TOO_LARGE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_INVALID");
  }
  const keys = eveKeysSchema.parse(parsed);
  assertUniqueKeys(
    keys.map((key) => `${key.issuer}:${key.keyId}`),
    "DUPLICATE_VERIFICATION_EVE_RUNTIME_ATTESTATION_KEY",
  );
  for (const key of keys) {
    let publicKey;
    try {
      publicKey = createPublicKey(key.publicKeyPem);
    } catch {
      throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEY_INVALID");
    }
    if (publicKey.asymmetricKeyType !== "ed25519")
      throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEY_ALGORITHM_INVALID");
  }
  return keys;
}

function grantMatchesOwnedOperation(
  grant: OwnershipGrant,
  row: {
    readonly mission_id: string;
    readonly agent_deployment_id: string;
    readonly capability_version: string;
    readonly external_execution: unknown;
  },
): boolean {
  return (
    grant.missionId === row.mission_id &&
    grant.agentDeploymentId === row.agent_deployment_id &&
    grant.capabilityVersion === row.capability_version &&
    (!grant.externalExecution ||
      isDeepStrictEqual(grant.externalExecution, row.external_execution))
  );
}

/** Authenticated mission readers must match the same server-owned deployment and original attempt. */
export function createVerificationOperationReadAuthorizer(
  store: VerificationOwnershipStore,
  rawGrants: string,
  operationKinds: readonly string[] = ["verification_structured_extraction"],
) {
  const grants = parseOwnershipGrants(rawGrants);
  if (
    operationKinds.length < 1 ||
    operationKinds.length > 16 ||
    operationKinds.some((kind) => !kind.trim())
  )
    throw new Error("VERIFICATION_READ_OPERATION_KINDS_INVALID");
  return async (input: { tenantId: string; operationId: string; actor: Actor }) => {
    const matches = grants.filter(
      (grant) =>
        grant.tenantId === input.tenantId && actorsMatch(grant.actor, input.actor),
    );
    if (matches.length === 0) return false;
    return store.transaction(input.tenantId, async (client) => {
      const rows = (
        await client.query<{
          mission_id: string;
          agent_deployment_id: string;
          capability_version: string;
          external_execution: unknown;
        }>(OWNED_OPERATION_READ_SQL, [
          input.tenantId,
          input.operationId,
          [...operationKinds],
        ])
      ).rows;
      return (
        rows.length === 1 &&
        matches.some((grant) => grantMatchesOwnedOperation(grant, rows[0]!))
      );
    });
  };
}

function operationIdFor(input: {
  tenantId: string;
  useCase: string;
  idempotencyKey: string;
}): string {
  return deterministicUuid(
    "verification-http-operation",
    `${input.tenantId}:${input.useCase}:${input.idempotencyKey}`,
  );
}

function payloadMatchesOwnedRequest(input: {
  readonly payload: EveRuntimeAttestationPayload;
  readonly authority: EveRuntimeAuthority;
  readonly grant: OwnershipGrant;
  readonly resolution: VerificationContextResolutionInput;
  readonly expectedOperationId: string;
  readonly requestDigest: string;
}): boolean {
  const { payload, authority, grant, resolution } = input;
  return (
    payload.grantId === authority.grantId &&
    payload.tenantId === resolution.tenantId &&
    isDeepStrictEqual(payload.principal, resolution.identity.actor) &&
    isDeepStrictEqual(payload.principal, grant.actor) &&
    payload.missionId === grant.missionId &&
    payload.workItemId === resolution.hints.workItemId &&
    payload.attemptId === resolution.hints.attemptId &&
    payload.agentDeploymentId === grant.agentDeploymentId &&
    payload.capabilityVersion === grant.capabilityVersion &&
    payload.useCase === resolution.useCase &&
    payload.idempotencyKey === resolution.idempotencyKey &&
    payload.operationId === input.expectedOperationId &&
    payload.requestDigest === input.requestDigest &&
    isDeepStrictEqual(payload.externalExecution, resolution.hints.externalExecution)
  );
}

async function bindEveRuntime(
  resolveEveBinding: ResolveEveVerificationBinding | undefined,
  envelope: EveRuntimeAttestationEnvelope,
): Promise<unknown | undefined> {
  if (!resolveEveBinding) return undefined;
  try {
    return await resolveEveBinding(envelope);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EVE_")) return undefined;
    throw error;
  }
}

async function resolveEveExecution(args: {
  readonly resolveEveBinding: ResolveEveVerificationBinding | undefined;
  readonly keys: readonly EveAttestationKey[];
  readonly grant: OwnershipGrant;
  readonly resolution: VerificationContextResolutionInput;
}): Promise<unknown | undefined> {
  const { grant, resolution } = args;
  const authority = grant.eveRuntimeAuthority;
  if (
    !authority ||
    !resolution.request ||
    !EVE_VERIFICATION_USE_CASES.has(resolution.useCase)
  )
    return undefined;
  const expectedOperationId = operationIdFor(resolution);
  if (
    resolution.hints.causationId !== undefined ||
    resolution.correlationId !== `eve-verification:${expectedOperationId}`
  )
    return undefined;
  const rawHeader = resolution.request.headers["x-eve-runtime-attestation"];
  if (
    typeof rawHeader !== "string" ||
    rawHeader.length === 0 ||
    rawHeader.length > EVE_ATTESTATION_HEADER_MAX_LENGTH
  )
    return undefined;
  let envelope;
  try {
    envelope = parseEveRuntimeAttestation(rawHeader);
  } catch {
    return undefined;
  }
  const key = args.keys.find(
    (candidate) =>
      candidate.issuer === envelope.payload.issuer &&
      candidate.keyId === envelope.payload.keyId,
  );
  if (
    !key ||
    envelope.payload.issuer !== authority.issuer ||
    !authority.keyIds.includes(envelope.payload.keyId)
  )
    return undefined;
  let payload;
  try {
    payload = await verifyEveRuntimeAttestation(rawHeader, key);
  } catch {
    return undefined;
  }
  const parsedRequest =
    resolution.useCase === "verifyClaims"
      ? VerifyClaimsRequestSchema.safeParse(resolution.request.body)
      : VerifyReportRequestSchema.safeParse(resolution.request.body);
  if (!parsedRequest.success) return undefined;
  if (
    !payloadMatchesOwnedRequest({
      payload,
      authority,
      grant,
      resolution,
      expectedOperationId,
      requestDigest: sha256Digest(parsedRequest.data),
    })
  )
    return undefined;
  return bindEveRuntime(args.resolveEveBinding, envelope);
}

function findMatchingGrant(
  grants: readonly OwnershipGrant[],
  input: VerificationContextResolutionInput,
): OwnershipGrant | undefined {
  const { hints } = input;
  return grants.find(
    (item) =>
      item.tenantId === input.tenantId &&
      item.missionId === hints.missionId &&
      actorsMatch(item.actor, input.identity.actor),
  );
}

async function attemptIsOwned(input: {
  readonly store: VerificationOwnershipStore;
  readonly tenantId: string;
  readonly attemptId: string;
  readonly workItemId: string;
  readonly missionId: string;
  readonly agentDeploymentId: string;
}): Promise<boolean> {
  return input.store.transaction(input.tenantId, async (client) => {
    const result = await client.query(OWNED_ATTEMPT_SQL, [
      input.tenantId,
      input.attemptId,
      input.workItemId,
      input.missionId,
      input.agentDeploymentId,
    ]);
    return result.rows.length === 1;
  });
}

function parseOwnedOperationContext(input: {
  readonly resolution: VerificationContextResolutionInput;
  readonly grant: OwnershipGrant;
  readonly hints: VerificationOperationContextHints;
  readonly eveAuthority: EveRuntimeAuthority | undefined;
  readonly eveOriginalExecution: unknown;
}): OperationContext {
  const { resolution, grant, hints } = input;
  return OperationContextSchema.parse({
    tenantId: resolution.tenantId,
    actor: resolution.identity.actor,
    attemptId: hints.attemptId,
    missionId: grant.missionId,
    workItemId: hints.workItemId,
    operationId: operationIdFor(resolution),
    correlationId: resolution.correlationId,
    idempotencyKey: resolution.idempotencyKey,
    capabilityVersion: grant.capabilityVersion,
    reason: `authenticated ${resolution.useCase} request`,
    contractVersion: "v1",
    ...(hints.causationId ? { causationId: hints.causationId } : {}),
    ...(input.eveAuthority !== undefined
      ? { externalExecution: input.eveOriginalExecution }
      : grant.externalExecution
        ? { externalExecution: grant.externalExecution }
        : {}),
  });
}

function rememberVerifiedEveRetry(input: {
  readonly request: object;
  readonly context: OperationContext;
  readonly observed: unknown;
}): void {
  verifiedEveRetries.set(input.request, {
    context: OperationContextSchema.parse(structuredClone(input.context)),
    observed: ExternalExecutionContextSchema.parse(structuredClone(input.observed)),
  });
}

/** Server configuration grants mission access; request headers never create grants. */
export function createVerificationOwnershipResolver(
  store: VerificationOwnershipStore,
  rawGrants: string,
  options: VerificationOwnershipResolverOptions = {},
): ResolveVerificationContext {
  const grants = parseOwnershipGrants(rawGrants);
  const eveKeys = parseEveRuntimeAttestationKeys(options.eveRuntimeAttestationKeysJson);
  if (grants.some((grant) => grant.eveRuntimeAuthority !== undefined) && eveKeys.length === 0)
    throw new Error("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_REQUIRED");
  return async (input) => {
    const { hints } = input;
    if (!hints.attemptId || !hints.missionId || !hints.workItemId) return undefined;
    const grant = findMatchingGrant(grants, input);
    if (!grant) return undefined;
    const eveAuthority = grant.eveRuntimeAuthority;
    const eveOriginalExecution =
      eveAuthority === undefined
        ? undefined
        : await resolveEveExecution({
            resolveEveBinding: options.resolveEveBinding,
            keys: eveKeys,
            grant,
            resolution: input,
          });
    if (eveAuthority !== undefined && eveOriginalExecution === undefined) return undefined;
    if (
      eveAuthority === undefined &&
      hints.externalExecution &&
      !isDeepStrictEqual(hints.externalExecution, grant.externalExecution)
    )
      return undefined;
    const owned = await attemptIsOwned({
      store,
      tenantId: input.tenantId,
      attemptId: hints.attemptId,
      workItemId: hints.workItemId,
      missionId: grant.missionId,
      agentDeploymentId: grant.agentDeploymentId,
    });
    if (!owned) return undefined;
    const context = parseOwnedOperationContext({
      resolution: input,
      grant,
      hints,
      eveAuthority,
      eveOriginalExecution,
    });
    if (
      eveAuthority !== undefined &&
      input.request &&
      hints.externalExecution !== undefined &&
      !isDeepStrictEqual(eveOriginalExecution, hints.externalExecution)
    )
      rememberVerifiedEveRetry({
        request: input.request,
        context,
        observed: hints.externalExecution,
      });
    return context;
  };
}
