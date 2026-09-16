import { describe,expect,it } from "vitest";
import { canonicalizeJson,sha256Digest } from "@aiengineer/knowledge-verification";
import { parseSemanticJudgeProfileCatalog,SemanticJudgeProfileCatalog,type SemanticJudgeProfileGrant } from "./verification-semantic-profile.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(){
 const identity={deploymentId:"judge",provider:"gateway",family:"openai",model:"luna",capability:"llm_evidence_rubric" as const,graderVersion:"evidence-only.v1",promptDigest:sha256Digest("prompt"),outputSchemaDigest:sha256Digest("schema"),configurationDigest:sha256Digest("configuration")};
 const bytes=new TextEncoder().encode(canonicalizeJson({schemaVersion:"verification-semantic-judge-profile.v1",identity}));
 const profileArtifact={artifactId:id(3),tenantId:id(1),digest:sha256Digest(bytes),byteLength:bytes.byteLength,mediaType:"application/json",objectKey:"fixture/profile",createdAt:"2026-09-07T00:00:00.000Z",producerActivityId:"profile",producerVersion:"v1",encryptionClass:"managed",retentionClass:"audit",dataClassification:"restricted" as const,parentArtifactIds:[]};
 const grant:SemanticJudgeProfileGrant={tenantId:id(1),operationId:id(2),host:"claims",role:"primary",profileArtifact,identity};
 return {grant,bytes,resolver:{async authorizeArtifact(){},async hydrateRegisteredArtifact(){return {registration:profileArtifact,bytes};}}};
}
describe("semantic profile catalog",()=>{
 it("hydrates the exact registered identity and isolates its grants from caller mutation",async()=>{const f=fixture(),catalog=new SemanticJudgeProfileCatalog([f.grant]);const issued=catalog.resolve(id(1),id(2),"claims")[0]!;await expect(catalog.hydrate(issued,f.resolver)).resolves.toMatchObject({profile:{identity:{deploymentId:"judge"}},role:"primary"});f.grant.identity.deploymentId="forged";expect(issued.identity.deploymentId).toBe("judge");expect(()=>catalog.resolve(id(1),id(4),"claims")).toThrow("SEMANTIC_PROFILE_GRANT_REQUIRED");expect(()=>catalog.resolve(id(1),id(2),"report")).toThrow("SEMANTIC_PROFILE_GRANT_REQUIRED");});
 it("rejects identity substitution even when the artifact hash remains valid",async()=>{const f=fixture();f.grant={...f.grant,identity:{...f.grant.identity,deploymentId:"forged"}};const catalog=new SemanticJudgeProfileCatalog([f.grant]);await expect(catalog.hydrate(f.grant,f.resolver)).rejects.toThrow("SEMANTIC_PROFILE_IDENTITY_MISMATCH");});
 it("rejects duplicate roles and a same-family cross-check judge",()=>{const f=fixture();expect(()=>new SemanticJudgeProfileCatalog([f.grant,f.grant])).toThrow("SEMANTIC_PROFILE_GRANT_DUPLICATE");expect(()=>new SemanticJudgeProfileCatalog([f.grant,{...f.grant,role:"cross_family",profileArtifact:{...f.grant.profileArtifact,artifactId:id(4)},identity:{...f.grant.identity,deploymentId:"second"}}])).toThrow("SEMANTIC_PROFILE_JUDGE_SEPARATION_REQUIRED");});
});

it("parses bounded nonempty server configuration and rejects malformed JSON",()=>{const f=fixture();expect(parseSemanticJudgeProfileCatalog(JSON.stringify([f.grant])).resolve(id(1),id(2),"claims")).toHaveLength(1);expect(()=>parseSemanticJudgeProfileCatalog("[")).toThrow("SEMANTIC_PROFILE_CONFIGURATION_INVALID");expect(()=>parseSemanticJudgeProfileCatalog("[]")).toThrow();expect(()=>parseSemanticJudgeProfileCatalog(" ".repeat(1_048_577))).toThrow("SEMANTIC_PROFILE_CONFIGURATION_TOO_LARGE");});
