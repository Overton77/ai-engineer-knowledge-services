import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createVerificationClaimsReportReads } from "../verification-claims-report-reads-runtime.js";

describe("claims/report read runtime", () => {
  it("stays unavailable unless server-owned signature trust is configured", () => {
    expect(createVerificationClaimsReportReads(undefined, {})).toBeUndefined();
  });
  it("fails closed when signature trust is configured without native storage and ownership", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const environment = {
      VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON: JSON.stringify([
        { keyId: "trusted", publicKeyPem },
      ]),
    };
    expect(() =>
      createVerificationClaimsReportReads(undefined, environment),
    ).toThrow(
      "VERIFICATION_CLAIMS_REPORT_READS_STORAGE_AND_OWNERSHIP_REQUIRED",
    );
  });
});
