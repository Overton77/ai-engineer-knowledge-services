import { describe, expect, it } from "vitest";
import { allowsVerificationAdjudicationReadArtifact, createVerificationAdjudicationReads } from "./verification-adjudication-reads-runtime.js";

describe("adjudication read native runtime configuration", () => {
  it("stays disabled without server trust and rejects an incomplete enabled runtime", () => {
    expect(createVerificationAdjudicationReads(undefined, {})).toBeUndefined();
    expect(() => createVerificationAdjudicationReads(undefined, {
      VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: "key", publicKeyPem: "x".repeat(64) }]),
    })).toThrow("VERIFICATION_ADJUDICATION_READ_RUNTIME_REQUIRED");
  });

  it("allows only the three canonical replay purposes for the authorized tenant", () => {
    const tenantId = "00000000-0000-4000-8000-000000000001";
    for (const purpose of ["verification_replay", "policy_replay", "verification_admission"])
      expect(allowsVerificationAdjudicationReadArtifact({ tenantId, purpose }, tenantId)).toBe(true);
    expect(allowsVerificationAdjudicationReadArtifact({ tenantId, purpose: "verification_write" }, tenantId)).toBe(false);
    expect(allowsVerificationAdjudicationReadArtifact({ tenantId: "00000000-0000-4000-8000-000000000002", purpose: "policy_replay" }, tenantId)).toBe(false);
  });

  it("rejects an invalid replay deadline before accepting requests", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const artifactId = "00000000-0000-4000-8000-000000000002";
    expect(() => createVerificationAdjudicationReads({} as never, {
      VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: "key", publicKeyPem: "x".repeat(64) }]),
      VERIFICATION_ADJUDICATION_GRANTS_JSON: JSON.stringify([{ tenantId, auditArtifact: { artifactId, digest }, runKind: "claims" }]),
      VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify([{ tenantId, assertions: { artifactId, digest }, admissions: [{ captureId: artifactId, transformationArtifactId: artifactId, projectionArtifactId: artifactId }] }]),
      VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify([{ tenantId, actor: { kind: "service", id: artifactId, serviceIdentity: "mission_control_client" }, missionId: artifactId, agentDeploymentId: "worker", capabilityVersion: "verification-adjudication.v1" }]),
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SECRET_KEY: "local-test-key",
      VERIFICATION_PARSER_IMAGE_DIGEST: digest,
      VERIFICATION_ADJUDICATION_TIMEOUT_MS: "99",
    })).toThrow("VERIFICATION_ADJUDICATION_READ_TIMEOUT_INVALID");
  });
});
