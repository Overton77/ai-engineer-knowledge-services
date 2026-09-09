import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import {
  EveRuntimeAttestationEnvelopeSchema,
  EveRuntimeAttestationPayloadSchema,
  type EveRuntimeAttestationEnvelope,
  type EveRuntimeAttestationPayload,
} from "@aiengineer/knowledge-contracts";
import { canonicalJson } from "@aiengineer/knowledge-domain";

const HEADER_MAXIMUM_BYTES = 8_192;
const DOMAIN = "knowledge-services:eve-runtime-attestation.v1\n";
const base64url = /^[A-Za-z0-9_-]+$/u;

function bytesFor(payload: EveRuntimeAttestationPayload): Buffer {
  return Buffer.from(`${DOMAIN}${canonicalJson(payload)}`, "utf8");
}

function fail(code: string): never { throw new Error(code); }

/** Parses canonical, untrusted header material. Call verify before authority use. */
export function parseEveRuntimeAttestation(header: string): EveRuntimeAttestationEnvelope {
  if (typeof header !== "string" || Buffer.byteLength(header, "utf8") === 0 || Buffer.byteLength(header, "utf8") > HEADER_MAXIMUM_BYTES || !base64url.test(header)) fail("EVE_RUNTIME_ATTESTATION_HEADER_INVALID");
  let decoded: string;
  try {
    const bytes = Buffer.from(header, "base64url");
    if (bytes.toString("base64url") !== header) fail("EVE_RUNTIME_ATTESTATION_ENCODING_INVALID");
    decoded = bytes.toString("utf8");
  } catch { fail("EVE_RUNTIME_ATTESTATION_ENCODING_INVALID"); }
  let unknown: unknown;
  try { unknown = JSON.parse(decoded); } catch { fail("EVE_RUNTIME_ATTESTATION_JSON_INVALID"); }
  const envelope = EveRuntimeAttestationEnvelopeSchema.safeParse(unknown);
  if (!envelope.success) fail("EVE_RUNTIME_ATTESTATION_SCHEMA_INVALID");
  // This comparison rejects duplicate keys and whitespace/order variants: the wire
  // representation is exactly base64url(canonicalJson(envelope)).
  if (canonicalJson(envelope.data) !== decoded) fail("EVE_RUNTIME_ATTESTATION_NON_CANONICAL");
  return envelope.data;
}

export async function createEveRuntimeAttestation(
  payload: EveRuntimeAttestationPayload,
  privateKeyPem: string,
): Promise<string> {
  const parsed = EveRuntimeAttestationPayloadSchema.parse(payload);
  if (!privateKeyPem.trim()) fail("EVE_RUNTIME_ATTESTATION_PRIVATE_KEY_REQUIRED");
  let privateKey;
  try { privateKey = createPrivateKey(privateKeyPem); } catch { fail("EVE_RUNTIME_ATTESTATION_PRIVATE_KEY_INVALID"); }
  if (privateKey.asymmetricKeyType !== "ed25519") fail("EVE_RUNTIME_ATTESTATION_PRIVATE_KEY_ALGORITHM_INVALID");
  let signature: Buffer;
  try { signature = sign(null, bytesFor(parsed), privateKey); } catch { fail("EVE_RUNTIME_ATTESTATION_SIGNATURE_INVALID"); }
  if (signature.byteLength !== 64) fail("EVE_RUNTIME_ATTESTATION_SIGNATURE_INVALID");
  const envelope = { payload: parsed, signatureBase64: signature.toString("base64") };
  return Buffer.from(canonicalJson(envelope), "utf8").toString("base64url");
}

export async function verifyEveRuntimeAttestation(
  header: string,
  trusted: { readonly issuer: string; readonly keyId: string; readonly publicKeyPem: string; readonly nowSeconds?: number },
): Promise<EveRuntimeAttestationPayload> {
  const envelope = parseEveRuntimeAttestation(header);
  const { payload } = envelope;
  if (payload.issuer !== trusted.issuer || payload.keyId !== trusted.keyId || payload.audience !== "knowledge-services:verification") fail("EVE_RUNTIME_ATTESTATION_TRUST_INVALID");
  const now = trusted.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || payload.issuedAt > now + 5 || payload.expiresAt <= now) fail("EVE_RUNTIME_ATTESTATION_TIME_INVALID");
  let signature: Buffer;
  let publicKey;
  try { signature = Buffer.from(envelope.signatureBase64, "base64"); publicKey = createPublicKey(trusted.publicKeyPem); } catch { fail("EVE_RUNTIME_ATTESTATION_PUBLIC_KEY_INVALID"); }
  if (publicKey.asymmetricKeyType !== "ed25519") fail("EVE_RUNTIME_ATTESTATION_PUBLIC_KEY_ALGORITHM_INVALID");
  if (signature.byteLength !== 64 || signature.toString("base64") !== envelope.signatureBase64) fail("EVE_RUNTIME_ATTESTATION_SIGNATURE_INVALID");
  try { if (!verify(null, bytesFor(payload), publicKey, signature)) fail("EVE_RUNTIME_ATTESTATION_SIGNATURE_INVALID"); } catch (error) { if (error instanceof Error && error.message === "EVE_RUNTIME_ATTESTATION_SIGNATURE_INVALID") throw error; fail("EVE_RUNTIME_ATTESTATION_SIGNATURE_INVALID"); }
  return payload;
}
