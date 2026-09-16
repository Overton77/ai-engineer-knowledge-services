import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationAdmissionService } from "../packages/application/src/verification/admission/verification-admission.js";
import { StructuredExtractionProfileAdmission } from "../packages/application/src/verification/operations/verification-structured-extraction-profile.js";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, registeredProvider, sha256Digest } from "@aiengineer/knowledge-verification";

const pgUrl=process.env.POSTGRES_URL!,storageUrl=process.env.SUPABASE_URL!;
for(const [value,port]of [[pgUrl,"54322"],[storageUrl,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const namespace=randomUUID(),tenantId=randomUUID(),missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID(),captureId=randomUUID(),sourceId=randomUUID(),budgetId=randomUUID(),createdAt=new Date().toISOString();
const bucket="ai-engineer-cloud-bucket",imageDigest="sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37" as const;
const database=new PostgresCanonicalRepository({connectionString:pgUrl,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:storageUrl,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket,maximumBytes:8_000_000}),{async authorize(input){assert.equal(input.tenantId,tenantId);assert.equal(input.purpose,"verification_admission");}});
const config={storageBucket:bucket,producerVersion:"structured-extraction-proof.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>createdAt};
const native=new VerificationAdmissionService(repository,new SandboxedVerificationParser(imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest,limits:VERIFICATION_PARSER_LIMITS},config);
const register=(value:unknown,artifactType:string,mediaType="application/json")=>repository.registerContentAddressedArtifact({tenantId,bytes:new TextEncoder().encode(typeof value==="string"?value:canonicalizeJson(value)),mediaType,artifactType,bucketClass:"ledger",storageBucket:bucket,createdAt,producerActivityId:"structured-extraction-proof",producerVersion:"v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",producerAttemptId:attemptId,missionId});
try{
 await database.transaction(tenantId,async c=>{
  await c.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Native structured extraction proof')",[missionId,tenantId,namespace]);
  await c.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'verify_extraction')",[workItemId,tenantId,missionId]);
  await c.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'structured-extraction-proof')",[attemptId,tenantId,workItemId]);
 });
 const sourceArtifact=await register('<html><body><p id="value">Exact value 42</p></body></html>',"source_capture","text/html");
 await repository.recordCapture({tenantId,source:{sourceId,kind:"web_page",canonicalUri:"https://synthetic.invalid/structured-extraction",logicalIdentity:namespace},capture:{captureId,sourceId,capturedAt:createdAt,captureMethod:"synthetic-fixture",captureMethodVersion:"1",contentArtifact:sourceArtifact},producerAttemptId:attemptId});
 const projection=(await native.parseAndAdmit({tenantId,captureId,expectedSourceArtifact:{artifactId:sourceArtifact.artifactId,digest:sourceArtifact.digest as `sha256:${string}`},kind:"html"}))[0]!;assert.equal(projection.projectionKind,"html_dom");
 const extractionSchema=await register({schemaVersion:"verification-extraction-profile.v1",sourceArtifact:{artifactId:sourceArtifact.artifactId,digest:sourceArtifact.digest},extractionSchema:{schemaId:"native-synthetic",schemaVersion:"1",schema:{type:"object",description:"Native synthetic source field.",properties:{value:{type:"string",description:"Exact displayed value.",maxLength:32}},required:["value"],additionalProperties:false}},fields:[{path:"/value",comparison:"exact"}],evidence:[{path:"/value",captureId,projectionArtifactId:projection.projectionArtifact.artifactId,transformationArtifactId:projection.transformationArtifact.artifactId,selector:{kind:"html",css:"#value"},expectedSelectedContentDigest:sha256Digest("Exact value 42")}],normalizations:[],duplicates:[],totals:[]},"verification_bundle");
 const profiles=[];
 for(const providerId of ["gateway-structured-extraction.v1","interfaze-extraction.v1"] as const){
  const provider=registeredProvider(providerId);
  const profile={schemaVersion:"verification-structured-extraction-profile.v1",tenantId,profileId:"registered_default",profileVersion:"native-synthetic.v1",extractionSchema,providerId,providerConfigurationDigest:provider.configurationDigest,externalProcessing:{classification:"synthetic",modality:"text"},budget:{budgetId,budgetKey:"native-extraction-proof",ceilingCostMicros:10_000,reservationCostMicros:100},maximumPromptBytes:24_000};
  const producerProfile=await register(profile,"verification_structured_extraction_profile");
  const grant={tenantId,captureId,sourceArtifact,representation:projection.projectionArtifact,transformation:projection.transformationArtifact,extractionSchema,producerProfile};
  const request={verificationContractVersion:"verification.v1",captureId,representation:{artifactId:grant.representation.artifactId,digest:grant.representation.digest},extractionSchema:{artifactId:extractionSchema.artifactId,digest:extractionSchema.digest},extractionProfile:"registered_default"};
  const service=new StructuredExtractionProfileAdmission([grant],()=>repository.createTrustedArtifactResolver(),native);
  const prepared=await service.prepare({tenantId,request});assert.ok(prepared.prompt.includes("Exact value 42"));assert.equal(prepared.selectedEvidence[0]!.selectedContentDigest,sha256Digest("Exact value 42"));assert.equal(prepared.provider.promotionState,"lab");
  profiles.push({providerId,grant,request,promptDigest:prepared.promptDigest,selectedEvidence:prepared.selectedEvidence});
 }
 const output=resolve("../internal",`verification-structured-extraction-preparation-${namespace}.json`);
 await writeFile(output,JSON.stringify({passed:true,scope:"real native sandbox HTML parser and registered source/projection/profile admission; synthetic source; no provider dispatch",namespace,tenantId,missionId,workItemId,attemptId,captureId,budgetId,createdAt,imageDigest,projection,profiles,externalProviderRequests:0},null,2),{flag:"wx"});console.log(JSON.stringify({passed:true,output,profiles:profiles.length}));
}finally{await database.close();}
