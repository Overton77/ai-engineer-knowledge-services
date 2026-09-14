import { z } from "zod";
import { SemanticBlindedInputSchema, SemanticJudgeIdentitySchema, VerificationArtifactHandleSchema, type SemanticBlindedInput, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, prepareGatewaySemanticRequest, providerDigest, sha256Digest, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { VerificationProviderTransportResponseSchema, prepareVerificationProviderTransportResponse, VerificationProviderTransportBindingSchema } from "./verification-provider-transport.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const captureSchema = VerificationProviderTransportBindingSchema.extend({ httpStatus: z.int().min(200).max(599), responseEnvelopeArtifactId: z.uuid(), transportArtifactId: z.uuid(), transportDigest: digest, capturedAt: z.iso.datetime() });
const envelopeSchema = z.strictObject({ schemaVersion: z.literal("verification-provider-response-envelope.v1"), requestDigest: digest, requestArtifactId: z.uuid(), rawResponseArtifactId: z.uuid(), rawResponseDigest: digest });
const decoder = new TextDecoder("utf-8", { fatal: true });
const equal = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const fail = (): never => { throw new Error("SEMANTIC_RECOVERY_CUSTODY_MISMATCH"); };

/** Rehydrates an already scoped capture. No network, accounting mutation, or judgment admission. */
export async function hydrateSemanticGatewayCapture(input: {
  readonly capture: z.infer<typeof captureSchema>;
  readonly profileArtifact: VerificationArtifactHandle;
  readonly blindedInputArtifact: VerificationArtifactHandle;
  readonly blindedInput: SemanticBlindedInput;
  readonly model: string;
  readonly createResolver: () => TrustedArtifactResolver;
  readonly signal?: AbortSignal;
}) {
  const capture = captureSchema.parse(input.capture), profile = VerificationArtifactHandleSchema.parse(input.profileArtifact);
  const blinded = VerificationArtifactHandleSchema.parse(input.blindedInputArtifact), body = SemanticBlindedInputSchema.parse(input.blindedInput);
  const model = input.model, signal = input.signal, resolver = input.createResolver();
  const active = () => { if (signal?.aborted) throw new Error("SEMANTIC_RECOVERY_CANCELLED"); };
  if (capture.tenantId !== profile.tenantId || capture.profileArtifactId !== profile.artifactId || capture.profileDigest !== profile.digest || blinded.tenantId !== capture.tenantId) fail();
  async function hydrate(expected: { artifactId: string; digest: string }, limit: number, full?: VerificationArtifactHandle) {
    active();
    if (full && full.byteLength > limit) fail();
    await resolver.authorizeArtifact({ tenantId: capture.tenantId, artifactId: expected.artifactId, purpose: "verification_admission" });
    active();
    const loaded = await resolver.hydrateRegisteredArtifact({ tenantId: capture.tenantId, artifactId: expected.artifactId });
    active();
    const registration = VerificationArtifactHandleSchema.parse(loaded.registration), bytes = new Uint8Array(loaded.bytes);
    if (registration.tenantId !== capture.tenantId || registration.artifactId !== expected.artifactId || registration.digest !== expected.digest || bytes.byteLength > limit || bytes.byteLength !== registration.byteLength || sha256Digest(bytes) !== expected.digest || (full && !equal(full, registration))) fail();
    return { registration, bytes };
  }
  const retainedProfile = await hydrate(profile, 96_000, profile);
  const profileBody = z.strictObject({ schemaVersion: z.literal("verification-semantic-judge-profile.v1"), identity: SemanticJudgeIdentitySchema }).parse(JSON.parse(decoder.decode(retainedProfile.bytes)));
  if (profileBody.identity.model !== model) fail();
  const retainedInput = await hydrate(blinded, 96_000, blinded);
  if (decoder.decode(retainedInput.bytes) !== canonicalizeJson(body) || blinded.parentArtifactIds.length !== 0) fail();
  const retainedTransport = await hydrate({ artifactId: capture.transportArtifactId, digest: capture.transportDigest }, 32_000);
  const transport = VerificationProviderTransportResponseSchema.parse(JSON.parse(decoder.decode(retainedTransport.bytes)));
  const prepared = prepareVerificationProviderTransportResponse(transport);
  const expectedBinding = VerificationProviderTransportBindingSchema.parse({ tenantId: capture.tenantId, operationId: capture.operationId, operationStepId: capture.operationStepId, providerAttemptId: capture.providerAttemptId, profileArtifactId: capture.profileArtifactId, profileDigest: capture.profileDigest, dispatchFencingToken: capture.dispatchFencingToken });
  if (!equal(transport.binding, expectedBinding) || transport.httpStatus !== capture.httpStatus || transport.responseEnvelope.artifactId !== capture.responseEnvelopeArtifactId || decoder.decode(retainedTransport.bytes) !== canonicalizeJson(transport) || retainedTransport.registration.transformationSignature !== prepared.transformationSignature || !equal(retainedTransport.registration.parentArtifactIds, prepared.parentArtifactIds)) fail();
  const retainedEnvelope = await hydrate(transport.responseEnvelope, 32_000, transport.responseEnvelope);
  const envelope = envelopeSchema.parse(JSON.parse(decoder.decode(retainedEnvelope.bytes)));
  if (decoder.decode(retainedEnvelope.bytes) !== canonicalizeJson(envelope) || envelope.requestDigest !== transport.requestDigest || envelope.rawResponseArtifactId !== transport.rawResponse.artifactId || envelope.rawResponseDigest !== transport.rawResponse.digest || !equal(retainedEnvelope.registration.parentArtifactIds, [envelope.requestArtifactId, envelope.rawResponseArtifactId]) || retainedEnvelope.registration.transformationSignature !== providerDigest({ kind: "verification_provider_response_envelope.v1", requestDigest: envelope.requestDigest, rawResponseDigest: envelope.rawResponseDigest })) fail();
  const request = await hydrate({ artifactId: envelope.requestArtifactId, digest: envelope.requestDigest }, 96_000);
  const expectedRequest = prepareGatewaySemanticRequest({ ...body, inputArtifactDigest: blinded.digest as `sha256:${string}` }, model, 64_000, profileBody.identity.promptDigest);
  if (expectedRequest.requestDigest !== envelope.requestDigest || !equal(JSON.parse(decoder.decode(request.bytes)), JSON.parse(decoder.decode(expectedRequest.requestBytes))) || !equal(request.registration.parentArtifactIds, [blinded.artifactId]) || request.registration.transformationSignature !== providerDigest({ kind: "verification_provider_request.v1", requestDigest: envelope.requestDigest })) fail();
  const raw = await hydrate(transport.rawResponse, 96_000, transport.rawResponse);
  active();
  return { capture, transportArtifact: retainedTransport.registration, responseEnvelopeArtifact: retainedEnvelope.registration, requestArtifact: request.registration, rawResponseArtifact: raw.registration, rawResponseBytes: raw.bytes, externalRequests: 0 as const };
}
