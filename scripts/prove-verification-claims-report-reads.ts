import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationClaimsReportReadService } from "@aiengineer/knowledge-application";
import { ClaimsReportReadError, PostgresCanonicalRepository, PostgresClaimsReportReadRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, createEd25519Verifier, digestCanonicalJson, sha256Digest, type AuditBundleSignatureVerifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";

type JsonRecord = Record<string, any>;
const encoder = new TextEncoder();
const sourceProofPath = resolve(process.argv[2] ?? "../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json");
const requestedOutputPath = process.argv[3]?.trim();
const sourceProof = JSON.parse(await readFile(sourceProofPath,"utf8")) as JsonRecord;
const local = await (await import("../../internal/verification-local-direct-config.mjs") as any).loadVerifiedLocalDevelopmentConfig();
for (const [value,port] of [[local.DB_URL,"54322"],[local.API_URL,"54321"]] as const) {
  const url=new URL(value);
  assert.ok(["localhost","127.0.0.1"].includes(url.hostname) && url.port===port);
}
const readOnlyUrl = new URL(local.DB_URL);
readOnlyUrl.searchParams.set("options","-c default_transaction_read_only=on");
const database = new PostgresCanonicalRepository({connectionString:readOnlyUrl.toString(),localOnly:true});

function databaseView(mutate:(sql:string,row:JsonRecord)=>JsonRecord) {
  return {
    transaction: async (tenantId:string,work:(client:any)=>Promise<any>) => database.transaction(tenantId,async client => work({
      query: async (sql:string,parameters?:readonly unknown[]) => {
        const result=await client.query(sql,parameters);
        return {...result,rows:result.rows.map(row=>mutate(sql,structuredClone(row as JsonRecord)))};
      },
    })),
  };
}

function resolverView(base:()=>TrustedArtifactResolver, overlay:()=>{artifactId:string;registration:JsonRecord;bytes:Uint8Array}|undefined, corruptArtifactId?:string) {
  return () => {
    const resolver=base();
    return {
      authorizeArtifact:(input:Parameters<TrustedArtifactResolver["authorizeArtifact"]>[0])=>resolver.authorizeArtifact(input),
      async hydrateRegisteredArtifact(input:Parameters<TrustedArtifactResolver["hydrateRegisteredArtifact"]>[0]) {
        const replacement=overlay();
        if(replacement?.artifactId===input.artifactId)return{registration:structuredClone(replacement.registration),bytes:replacement.bytes.slice()};
        const loaded=await resolver.hydrateRegisteredArtifact(input);
        if(corruptArtifactId===input.artifactId){const bytes=loaded.bytes.slice();bytes[0]=(bytes[0]??0)^1;return{registration:loaded.registration,bytes};}
        return loaded;
      },
    };
  };
}

function rewriteTerminalRow(row:JsonRecord, mutate:(result:JsonRecord,row:JsonRecord)=>void) {
  const original=row.body as JsonRecord;
  const {eventId,fencingToken,...result}=structuredClone(original);
  mutate(result,row);
  const {resultArtifact:oldHandle,...storedBody}=result;
  const bytes=encoder.encode(canonicalizeJson(storedBody));
  const handle={...oldHandle,digest:sha256Digest(bytes),byteLength:bytes.byteLength};
  result.resultArtifact=handle;
  const outputSha=digestCanonicalJson(result).slice(7);
  row.body={...result,eventId,fencingToken};
  row.output_sha256=outputSha;
  row.event_guarded_sha256=outputSha;
  row.event_payload={outputSha256:outputSha,fencingToken:String(fencingToken)};
  return{artifactId:handle.artifactId,registration:handle,bytes};
}

function terminalMutation(targetOperationId:string, mutate:(result:JsonRecord,row:JsonRecord)=>void) {
  let overlay:{artifactId:string;registration:JsonRecord;bytes:Uint8Array}|undefined;
  return {
    database:databaseView((sql,row)=>{
      if(sql.includes("from knowledge_service.operation o") && row.body?.operationId===targetOperationId)overlay=rewriteTerminalRow(row,mutate);
      return row;
    }),
    overlay:()=>overlay,
  };
}

async function expectIntegrity(promise:Promise<unknown>) {
  await assert.rejects(promise,error=>error instanceof ClaimsReportReadError && error.code==="INTEGRITY");
}

try {
  const readOnlyState=await database.transaction(sourceProof.tenantId,async client=>(await client.query<{transaction_read_only:string}>("show transaction_read_only")).rows[0]!.transaction_read_only);
  assert.equal(readOnlyState,"on");
  const verification=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:local.API_URL,serviceRoleKey:local.SECRET_KEY,bucket:"ai-engineer-cloud-bucket",maximumBytes:32_000_000}),{async authorize(){}});
  const baseResolver=()=>verification.createTrustedArtifactResolver();
  const verifier=createEd25519Verifier({[`claims-report-proof-${sourceProof.namespace}`]:sourceProof.publicKeyPem});
  const basePort=new PostgresClaimsReportReadRepository(database,baseResolver,verifier);
  const reader=new VerificationClaimsReportReadService(basePort);
  const claimsOperationId=sourceProof.results.claimsRecovery.operationId as string;
  const reportOperationId=sourceProof.results.reportRecovery.operationId as string;
  const claims=await reader.getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId});
  const report=await reader.getTerminal({tenantId:sourceProof.tenantId,operationId:reportOperationId});
  assert.equal(claims.useCase,"verifyClaims");
  assert.equal(report.useCase,"verifyReport");
  assert.equal(claims.sealedRun.manifestArtifact.digest,sourceProof.results.claimsRecovery.manifestArtifact.digest);
  assert.equal(report.sealedRun.manifestArtifact.digest,sourceProof.results.reportRecovery.manifestArtifact.digest);
  assert.equal(report.output.reportGateArtifact.digest.startsWith("sha256:"),true);
  const serialized=JSON.stringify([claims,report]);
  for(const forbidden of ["objectKey","rawBundle","providerResponse","SECRET_KEY","BEGIN PUBLIC KEY","missingQualifierAssertionIds","pointerFailures"]){assert.equal(serialized.includes(forbidden),false);}

  const before=await database.transaction(sourceProof.tenantId,async client=>(await client.query<{count:number}>("select count(*)::int count from knowledge_service.operation where tenant_id=$1",[sourceProof.tenantId])).rows[0]!.count);
  await assert.rejects(reader.getTerminal({tenantId:sourceProof.tenantId,operationId:"00000000-0000-4000-8000-000000000000"}));
  const after=await database.transaction(sourceProof.tenantId,async client=>(await client.query<{count:number}>("select count(*)::int count from knowledge_service.operation where tenant_id=$1",[sourceProof.tenantId])).rows[0]!.count);
  assert.equal(after,before);

  const reusedRunDb=databaseView((sql,row)=>sql.includes("from evidence.verification_run")?{...row,operation_id:"00000000-0000-4000-8000-000000000099"}:row);
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(reusedRunDb as any,baseResolver,verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId}));

  const crossKindDb=databaseView((sql,row)=>sql.includes("from knowledge_service.operation o")?{...row,operation_kind:row.operation_kind==="verification_claims"?"verification_report":"verification_claims"}:row);
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(crossKindDb as any,baseResolver,verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId}));

  const fenceDb=databaseView((sql,row)=>sql.includes("from knowledge_service.operation o")?{...row,event_payload:{...row.event_payload,fencingToken:"999999"}}:row);
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(fenceDb as any,baseResolver,verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId}));

  const sourceDrift=terminalMutation(claimsOperationId,result=>{result.output.verified.sourceArtifacts=[];});
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(sourceDrift.database as any,resolverView(baseResolver,sourceDrift.overlay),verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId}));

  const captureDrift=terminalMutation(claimsOperationId,(result,row)=>{
    row.request.input.request.captureIds=["unbound-capture"];
    row.input.operationInput.request.captureIds=["unbound-capture"];
    row.request_sha256=digestCanonicalJson(row.request).slice(7);
    row.input_sha256=digestCanonicalJson(row.input).slice(7);
    row.receipt_input_sha256=row.input_sha256;
    result.requestDigest=digestCanonicalJson(row.request.input.request);
    const parents=result.resultArtifact.parentArtifactIds;
    result.resultArtifact.transformationSignature=digestCanonicalJson({operationId:result.operationId,requestDigest:result.requestDigest,parents});
  });
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(captureDrift.database as any,resolverView(baseResolver,captureDrift.overlay),verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId}));

  const reportAliasDrift=terminalMutation(reportOperationId,result=>{
    const verified=result.output.verified;
    verified.assertionsArtifact={...verified.assertionsArtifact,artifactId:"00000000-0000-4000-8000-000000000098",objectKey:"in-memory/alternate-ledger"};
    const parents=[...new Set([verified.assertionsArtifact.artifactId,verified.reportArtifact.artifactId,verified.claimLedgerArtifact.artifactId,result.output.sealedRun.manifestArtifact.artifactId])];
    result.resultArtifact.parentArtifactIds=parents;
    result.resultArtifact.transformationSignature=digestCanonicalJson({operationId:result.operationId,requestDigest:result.requestDigest,parents});
  });
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(reportAliasDrift.database as any,resolverView(baseResolver,reportAliasDrift.overlay),verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:reportOperationId}));

  const reportSnapshot=await basePort.loadVerifiedClaimsReport(sourceProof.tenantId,reportOperationId);
  assert.equal(reportSnapshot.state,"succeeded");
  const gate=(reportSnapshot as any).reportGateArtifact as JsonRecord;
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(database,resolverView(baseResolver,()=>undefined,gate.artifactId),verifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:reportOperationId}));

  const rejectingVerifier:AuditBundleSignatureVerifier={verify:async()=>false};
  await expectIntegrity(new VerificationClaimsReportReadService(new PostgresClaimsReportReadRepository(database,baseResolver,rejectingVerifier)).getTerminal({tenantId:sourceProof.tenantId,operationId:claimsOperationId}));

  const output=requestedOutputPath ? resolve(requestedOutputPath) : resolve("../internal",`verification-claims-report-reads-r2-${sourceProof.namespace}.json`);
  const receipt={schemaVersion:"verification-claims-report-reads-proof.v2",scope:"database-enforced read-only local PostgreSQL and Storage retained claims/report terminal custody with in-memory hostile views",sourceProof:{path:sourceProofPath,sha256:createHash("sha256").update(await readFile(sourceProofPath)).digest("hex")},tenantId:sourceProof.tenantId,checks:{database_default_transaction_read_only:true,claims_compact_signed_terminal:true,report_compact_signed_gate_terminal:true,no_storage_locator_raw_bundle_or_report_ids:true,notfound_creates_no_operation:true,native_run_reuse_rejected:true,cross_kind_rejected:true,event_fence_tamper_rejected:true,source_set_tamper_rejected:true,request_capture_set_tamper_rejected:true,report_ledger_alias_tamper_rejected:true,report_gate_bytes_tamper_rejected:true,signature_tamper_rejected:true},claims,report,parserDispatches:0,providerDispatches:0};
  await writeFile(output,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({output,sha256:createHash("sha256").update(await readFile(output)).digest("hex"),checks:Object.keys(receipt.checks).length}));
} finally {
  await database.close();
}
