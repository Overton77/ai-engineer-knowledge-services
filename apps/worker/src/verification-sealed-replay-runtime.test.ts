import {describe,it,expect,vi} from "vitest";
import {createVerificationSealedMetricReplay} from "./verification-sealed-replay-runtime.js";

describe("canonical sealed replay authorization",()=>{
  it("does not look up another tenant's run",async()=>{
    const loadVerificationRunReplayBinding=vi.fn();
    const replay=createVerificationSealedMetricReplay({repository:{loadVerificationRunReplayBinding} as never,runtimePrincipals:{} as never,profiles:{} as never,admission:{} as never});
    await expect(replay({tenantId:"foreign",runId:"run",context:{tenantId:"owned"} as never})).rejects.toThrow("TENANT_MISMATCH");
    expect(loadVerificationRunReplayBinding).not.toHaveBeenCalled();
  });
  it("uses the dedicated missing signal only for an absent canonical run",async()=>{
    const replay=createVerificationSealedMetricReplay({repository:{loadVerificationRunReplayBinding:async()=>undefined} as never,runtimePrincipals:{} as never,profiles:{} as never,admission:{} as never});
    await expect(replay({tenantId:"owned",runId:"run",context:{tenantId:"owned"} as never})).rejects.toThrow("SEALED_REPLAY_RUN_NOT_FOUND");
  });
  it("denies another mission before audit hydration or principal lookup",async()=>{
    const loadAuditBundle=vi.fn(),bind=vi.fn();
    const replay=createVerificationSealedMetricReplay({repository:{loadVerificationRunReplayBinding:async()=>({missionId:"original"}),loadAuditBundle} as never,
      runtimePrincipals:{bind},profiles:{} as never,admission:{} as never});
    await expect(replay({tenantId:"owned",runId:"run",context:{tenantId:"owned",missionId:"different"} as never})).rejects.toThrow("MISSION_MISMATCH");
    expect(loadAuditBundle).not.toHaveBeenCalled();expect(bind).not.toHaveBeenCalled();
  });
});
