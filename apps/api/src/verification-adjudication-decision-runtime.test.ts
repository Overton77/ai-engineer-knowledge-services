import {describe,it,expect} from "vitest";
import {createVerificationAdjudicationDecisionRuntime as create} from "./verification-adjudication-decision-runtime.js";

describe("decision API runtime configuration",()=>{
 it("requires explicit enablement and refuses dormant authority",()=>{
  expect(create(undefined,{})).toBeUndefined();
  expect(create(undefined,{VERIFICATION_ADJUDICATION_DECISIONS_ENABLED:"0"})).toBeUndefined();
  expect(()=>create(undefined,{VERIFICATION_ADJUDICATION_DECISIONS_ENABLED:"yes"})).toThrow("ENABLED_INVALID");
  expect(()=>create(undefined,{VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON:"[]"})).toThrow("DISABLED_WITH_GRANTS");
 });
 it("requires canonical ownership and signed packet verification",()=>{
  expect(()=>create(undefined,{VERIFICATION_ADJUDICATION_DECISIONS_ENABLED:"1"})).toThrow("RUNTIME_REQUIRED");
  expect(()=>create({} as never,{VERIFICATION_ADJUDICATION_DECISIONS_ENABLED:"1",VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:"[]"})).toThrow("SIGNED_READER_REQUIRED");
 });
 it("rejects caller-like provenance, ambiguous and oversized server grants",()=>{
  const grant={tenantId:"00000000-0000-4000-8000-000000000001",actorId:"00000000-0000-4000-8000-000000000002",role:"reviewer"};
  const base={VERIFICATION_ADJUDICATION_DECISIONS_ENABLED:"1",VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:"[]"};
  for(const value of ["{",JSON.stringify([{...grant,provenance:"human_origin"}]),JSON.stringify([grant,grant])])expect(()=>create({} as never,{...base,VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON:value})).toThrow("GRANTS_INVALID");
  expect(()=>create({} as never,{...base,VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON:"x".repeat(262_145)})).toThrow("GRANTS_TOO_LARGE");
 });
});
