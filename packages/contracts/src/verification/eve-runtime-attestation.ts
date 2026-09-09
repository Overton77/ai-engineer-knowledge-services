import { z } from "zod";

import { Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { ServiceIdentitySchema } from "../identity.js";

const bounded = (maximum: number) => z.string().trim().min(1).max(maximum);
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const serviceActor = z.strictObject({
  kind: z.literal("service"),
  id: UuidSchema,
  serviceIdentity: ServiceIdentitySchema,
});
const externalExecution = z.strictObject({
  runtime: z.literal("eve"),
  runId: bounded(255),
  rootRunId: bounded(255),
  sessionId: bounded(255),
  turnId: bounded(255),
  toolCallId: bounded(255),
}).superRefine((value, context) => {
  if (value.runId !== `${value.sessionId}:${value.turnId}`) {
    context.addIssue({ code: "custom", path: ["runId"], message: "runId must equal sessionId:turnId" });
  }
});

export const EveRuntimeAttestationPayloadSchema = z.strictObject({
  schemaVersion: z.literal("eve-runtime-attestation.v1"),
  issuer: bounded(128),
  keyId: bounded(128),
  jti: UuidSchema,
  issuedAt: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  audience: z.literal("knowledge-services:verification"),
  grantId: bounded(128),
  tenantId: UuidSchema,
  principal: serviceActor,
  missionId: UuidSchema,
  workItemId: UuidSchema,
  attemptId: UuidSchema,
  operationId: UuidSchema,
  agentDeploymentId: bounded(128),
  capabilityVersion: bounded(128),
  useCase: z.enum(["verifyClaims", "verifyReport"]),
  requestDigest: Sha256DigestSchema,
  idempotencyKey: bounded(255),
  externalExecution,
}).superRefine((value, context) => {
  if (value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 120) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "validity must be positive and at most 120 seconds" });
  }
});

export const EveRuntimeAttestationEnvelopeSchema = z.strictObject({
  payload: EveRuntimeAttestationPayloadSchema,
  // A 64-byte Ed25519 signature has 86 data characters then `==`; canonical
  // base64 requires the final six-bit value's unused low four bits to be zero.
  signatureBase64: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u).refine((value) => base64Alphabet.indexOf(value[85]!) % 16 === 0, "canonical Ed25519 signature encoding required"),
});

export type EveRuntimeAttestationPayload = z.infer<typeof EveRuntimeAttestationPayloadSchema>;
export type EveRuntimeAttestationEnvelope = z.infer<typeof EveRuntimeAttestationEnvelopeSchema>;
