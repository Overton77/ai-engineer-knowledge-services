import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEd25519Verifier } from "@aiengineer/knowledge-verification";
import { createConfiguredVerificationAuditSigner } from "./verification-audit-signing-runtime.js";

describe("configured verification audit signer", () => {
  it("preserves unsigned deployments and rejects partial or invalid key settings", () => {
    expect(createConfiguredVerificationAuditSigner({})).toBeUndefined();
    expect(() => createConfiguredVerificationAuditSigner({VERIFICATION_AUDIT_SIGNING_KEY_ID:"key"})).toThrow("CONFIGURATION_INCOMPLETE");
    expect(() => createConfiguredVerificationAuditSigner({VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM:"secret"})).toThrow("CONFIGURATION_INCOMPLETE");
    expect(() => createConfiguredVerificationAuditSigner({VERIFICATION_AUDIT_SIGNING_KEY_ID:"key",VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM:"secret"})).toThrow("SIGNING_KEY_INVALID");
    const wrong = generateKeyPairSync("ec", {namedCurve:"prime256v1"});
    expect(() => createConfiguredVerificationAuditSigner({VERIFICATION_AUDIT_SIGNING_KEY_ID:"key",VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM:wrong.privateKey.export({type:"pkcs8",format:"pem"}).toString()})).toThrow("SIGNING_KEY_INVALID");
  });
  it("produces a signature verified by the separately configured public key and rejects tampering", async () => {
    const keys = generateKeyPairSync("ed25519");
    const signer = createConfiguredVerificationAuditSigner({VERIFICATION_AUDIT_SIGNING_KEY_ID:"audit",VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString()})!;
    const payload = new TextEncoder().encode("canonical audit payload");
    const signatureBase64 = await signer.sign(payload);
    const verifier = createEd25519Verifier({audit:keys.publicKey.export({type:"spki",format:"pem"}).toString()});
    expect(await verifier.verify({keyId:"audit",payload,signatureBase64})).toBe(true);
    expect(await verifier.verify({keyId:"audit",payload:new TextEncoder().encode("changed"),signatureBase64})).toBe(false);
    expect(await verifier.verify({keyId:"other",payload,signatureBase64})).toBe(false);
  });
});
