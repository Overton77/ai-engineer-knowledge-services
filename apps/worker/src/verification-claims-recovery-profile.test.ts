import { describe, expect, it, vi } from "vitest";
import { recoverySemanticProfiles } from "./verification-claims-recovery-profile.js";
import type { SemanticJudgeProfileCatalog } from "@aiengineer/knowledge-application";

function fixture(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async () => ({ rows }));
  const resolve = vi.fn(() => { throw new Error("SEMANTIC_PROFILE_GRANT_REQUIRED"); });
  return { query, resolve, input: {
    tenantId: "11111111-1111-4111-8111-111111111111", operationId: "22222222-2222-4222-8222-222222222222", host: "claims" as const,
    profiles: { resolve } as unknown as SemanticJudgeProfileCatalog,
    database: { transaction: async (_tenantId: string, work: (client: unknown) => Promise<unknown>) => work({ query }) } as never,
    repository: { createTrustedArtifactResolver: vi.fn(() => { throw new Error("MUST_NOT_HYDRATE_UNAUTHORIZED_EXECUTION"); }) },
  } };
}

describe("worker recovery profile authority", () => {
  it("preserves an exact host grant without consulting recovery state", async () => {
    const f = fixture();
    const profiles = { resolve: () => [] } as unknown as SemanticJudgeProfileCatalog;
    expect(await recoverySemanticProfiles({ ...f.input, profiles })).toBe(profiles);
    expect(f.query).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{}, {}] }])("rejects absent or ambiguous execution ancestry", async ({ rows }) => {
    const f = fixture(rows);
    await expect(recoverySemanticProfiles(f.input)).rejects.toThrow("SEMANTIC_RECOVERY_EXECUTION_REQUIRED");
    expect(f.input.repository.createTrustedArtifactResolver).not.toHaveBeenCalled();
  });

  it("leaves the submit/link race retryable and never dispatches while waiting", async () => {
    const linking = fixture([{ state: "authorized", case_state: "active" }]);
    await expect(recoverySemanticProfiles(linking.input)).rejects.toThrow("VERIFICATION_CLAIMS_INFRASTRUCTURE_FAILURE");
    for (const row of [{ state: "linked", case_state: "waiting" }, { state: "settled", case_state: "active" }]) {
      const f = fixture([row]);
      await expect(recoverySemanticProfiles(f.input)).rejects.toThrow("SEMANTIC_RECOVERY_EXECUTION_INACTIVE");
    }
  });
});
