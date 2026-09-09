import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { createApiRuntime } from "../apps/api/src/index.js";
import { buildKnowledgeMcpApp } from "../apps/mcp/src/index.js";
import { dispatchCliCommand,resolveCommand } from "../apps/cli/src/commands.js";

export async function proveVerificationReads(input:{tenantId:string;otherTenantId:string;runId:string;caseRunId?:string;evidenceId?:string;caseRunIds?:string[];unlinkedEvaluationRunId?:string;unlinkedEvaluationScoreId?:string;unlinkedLocatorId?:string}){
  const token=`run-read-${randomUUID()}`,foreignToken=`run-read-foreign-${randomUUID()}`;
  const identity={actor:{kind:"human" as const,id:randomUUID()},grants:[{tenantId:input.tenantId,roles:["knowledge_reader" as const],scopes:[]}]};
  const foreignIdentity={...identity,grants:[{...identity.grants[0]!,tenantId:input.otherTenantId}]};
  const runtime=await createApiRuntime({NODE_ENV:"test",POSTGRES_URL:process.env.POSTGRES_URL!,SUPABASE_URL:process.env.SUPABASE_URL!,
    SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY!,CANONICAL_LOCAL_ONLY:"1",VERIFICATION_READS_ENABLED:"1",
    KNOWLEDGE_API_IDENTITIES:JSON.stringify([{token,...identity},{token:foreignToken,...foreignIdentity}])});
  const checks:Record<string,boolean>={};
  try{
    const baseUrl=await runtime.server.listen({host:"127.0.0.1",port:0});
    const client=new KnowledgeClient({baseUrl,getAccessToken:()=>token});
    const context={tenantId:input.tenantId,correlationId:randomUUID()};
    const summary=await client.getVerificationRun(input.runId,context),manifest=await client.getVerificationRunManifest(input.runId,context);
    const caseReads:Array<{action:string;name:string;arguments:Record<string,unknown>;expected:unknown}>=[];
    if(input.caseRunId!==undefined&&input.evidenceId!==undefined){
      const page=await client.listVerificationRunCases(input.runId,{pageSize:1},context);
      const detail=await client.getVerificationCase(input.caseRunId,context);
      const evidence=await client.getVerificationEvidence(input.evidenceId,context);
      assert.equal(detail.runId,input.runId);assert.equal(evidence.caseRunId,input.caseRunId);
      assert.ok(detail.evidence.some(item=>item.evidenceId===input.evidenceId));
      const expectedIds=[...(input.caseRunIds??[input.caseRunId])].sort();
      assert.equal(page.cases[0]?.caseRunId,expectedIds[0]);
      const collected=page.cases.map(item=>item.caseRunId);
      let cursor=page.nextCursor;
      const seenCursors=new Set<string>();
      while(cursor!==undefined){
        assert.ok(!seenCursors.has(cursor));seenCursors.add(cursor);
        assert.ok(seenCursors.size<=expectedIds.length);
        const next=await client.listVerificationRunCases(input.runId,{pageSize:1,cursor},context);
        collected.push(...next.cases.map(item=>item.caseRunId));cursor=next.nextCursor;
      }
      assert.deepEqual(collected,expectedIds);
      const terminal=await client.listVerificationRunCases(input.runId,{pageSize:1,cursor:expectedIds.at(-1)!},context);
      assert.deepEqual(terminal.cases,[]);assert.equal(terminal.nextCursor,undefined);
      checks.actualApiCaseKeysetPaginationStable=true;
      if(input.unlinkedEvaluationRunId&&input.unlinkedEvaluationScoreId&&input.unlinkedLocatorId){
        for(const path of [`runs/${input.unlinkedEvaluationRunId}/cases`,`cases/${input.unlinkedEvaluationScoreId}`,`evidence/${input.unlinkedLocatorId}`]){
          const response=await fetch(`${baseUrl}/v1/verification/${path}`,{headers:{authorization:`Bearer ${token}`,"x-tenant-id":context.tenantId},signal:AbortSignal.timeout(15000)});
          assert.equal(response.status,404);
        }
        checks.actualUnlinkedCanonicalIdsDoNotAlias=true;
      }
      caseReads.push({action:"cases",name:"knowledge_list_verification_cases",arguments:{runId:input.runId,pageSize:1},expected:page},
        {action:"case",name:"knowledge_get_verification_case",arguments:{caseRunId:input.caseRunId},expected:detail},
        {action:"evidence",name:"knowledge_get_verification_evidence",arguments:{evidenceId:input.evidenceId},expected:evidence});
      for(const forbidden of ["objectKey","object_path","publicRationale","nativeConfiguration","selector"]){assert.equal(JSON.stringify(caseReads).includes(`"${forbidden}"`),false);}
      checks.actualApiReadsAuthoredCaseEvidence=true;
    }
    assert.equal(summary.runId,input.runId);assert.equal(manifest.runId,input.runId);
    checks.actualApiReadsCanonicalSealedRun=true;
    const text=JSON.stringify({summary,manifest});
    for(const forbidden of ["verificationBundle","objectKey","signatureBase64","judgments","nativeConfiguration","publicRationale"]){
      assert.equal(text.includes(`"${forbidden}"`),false);
    }
    checks.privatePayloadsExcluded=true;
    const cliContext={...context,actor:identity.actor,operationId:randomUUID(),attemptId:randomUUID(),capabilityVersion:"verification.v1",idempotencyKey:randomUUID(),reason:"read proof",contractVersion:"v1" as const};
    assert.deepEqual(await dispatchCliCommand(client,resolveCommand("verify","run")!,{runId:input.runId},cliContext),summary);
    assert.deepEqual(await dispatchCliCommand(client,resolveCommand("verify","manifest")!,{runId:input.runId},cliContext),manifest);
    checks.cliDispatchReadParity=true;
    for(const [action,expected] of [["run",summary],["manifest",manifest]] as const){
      const completed=await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../apps/cli/dist/index.js",import.meta.url)),"verify",action,
        "--base-url",baseUrl,"--input",JSON.stringify({runId:input.runId}),"--context",JSON.stringify(cliContext),"--timeout-ms","15000"],
        {windowsHide:true,timeout:20000,maxBuffer:1_048_576,env:{...process.env,KNOWLEDGE_API_TOKEN:token}});
      assert.deepEqual(JSON.parse(completed.stdout),expected);
    }
    checks.cliExecutableReadParity=true;
    for(const item of caseReads){
      assert.deepEqual(await dispatchCliCommand(client,resolveCommand("verify",item.action)!,item.arguments,cliContext),item.expected);
      const completed=await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../apps/cli/dist/index.js",import.meta.url)),"verify",item.action,
        "--base-url",baseUrl,"--input",JSON.stringify(item.arguments),"--context",JSON.stringify(cliContext),"--timeout-ms","15000"],
        {windowsHide:true,timeout:20000,maxBuffer:1_048_576,env:{...process.env,KNOWLEDGE_API_TOKEN:token}});
      assert.deepEqual(JSON.parse(completed.stdout),item.expected);
    }
    if(caseReads.length)checks.cliExecutableCaseEvidenceParity=true;
    const mcp=buildKnowledgeMcpApp({operationService:{} as never,apiOrigin:baseUrl,resolveIdentity:value=>value===token?identity:undefined,
      createApiClient:accessToken=>new KnowledgeClient({baseUrl,getAccessToken:()=>accessToken})});
    try{
      const mcpUrl=await mcp.listen({host:"127.0.0.1",port:0});
      for(const [name,expected] of [["knowledge_get_verification_run",summary],["knowledge_get_verification_manifest",manifest]] as const){
        const response=await fetch(`${mcpUrl}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},
          body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:{context,runId:input.runId}}}),signal:AbortSignal.timeout(15000)});
        assert.equal(response.status,200);const rpc=await response.json() as {result:{isError?:boolean;structuredContent:unknown}};
        assert.notEqual(rpc.result.isError,true);assert.deepEqual(rpc.result.structuredContent,expected);
      }
      checks.mcpHttpReadParity=true;
      for(const item of caseReads){
        const response=await fetch(`${mcpUrl}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},
          body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:item.name,arguments:{context,...item.arguments}}}),signal:AbortSignal.timeout(15000)});
        assert.equal(response.status,200);const rpc=await response.json() as {result:{isError?:boolean;structuredContent:unknown}};
        assert.notEqual(rpc.result.isError,true);assert.deepEqual(rpc.result.structuredContent,item.expected);
      }
      if(caseReads.length)checks.mcpHttpCaseEvidenceParity=true;
    }finally{await mcp.close();}
    for(const suffix of ["","/manifest"]){
      const path=`${baseUrl}/v1/verification/runs/${input.runId}${suffix}`;
      const foreign=await fetch(path,{headers:{authorization:`Bearer ${foreignToken}`,"x-tenant-id":input.otherTenantId},signal:AbortSignal.timeout(15000)});
      assert.equal(foreign.status,404);assert.equal((await fetch(path,{signal:AbortSignal.timeout(15000)})).status,401);
    }
    checks.foreignTenantCannotReadRun=true;checks.missingBearerDenied=true;
    if(caseReads.length){
      for(const path of [`runs/${input.runId}/cases`,`cases/${input.caseRunId}`,`evidence/${input.evidenceId}`]){
        const response=await fetch(`${baseUrl}/v1/verification/${path}`,{headers:{authorization:`Bearer ${foreignToken}`,"x-tenant-id":input.otherTenantId},signal:AbortSignal.timeout(15000)});
        assert.equal(response.status,404);
      }
      checks.foreignTenantCannotReadCaseEvidence=true;
    }
    const sourceHashes:Record<string,string>={};
    for(const path of ["packages/persistence/src/verification-case-reads.ts","packages/persistence/src/verification-case-writer.ts"]){
      if(caseReads.length)sourceHashes[path]=createHash("sha256").update(await readFile(new URL(`../${path}`,import.meta.url))).digest("hex");
    }
    for(const path of ["packages/contracts/src/verification/reads.ts","packages/application/src/verification-reads.ts","packages/persistence/src/verification.ts","apps/api/src/verification-reads-runtime.ts","apps/api/src/server.ts","apps/api/src/index.ts","packages/client-typescript/src/client.ts","apps/cli/src/commands.ts","apps/mcp/src/index.ts","scripts/verification-reads-runtime-proof.ts"]){
      sourceHashes[path]=createHash("sha256").update(await readFile(new URL(`../${path}`,import.meta.url))).digest("hex");
    }
    const receipt=fileURLToPath(new URL(`../../internal/verification-reads-runtime-${randomUUID()}.json`,import.meta.url));
    await writeFile(receipt,JSON.stringify({capturedAt:new Date().toISOString(),...input,summary,manifest,caseReads,checks,sourceHashes,providerDispatches:0,remoteWrites:0,passed:true},null,2),{flag:"wx"});
    process.stdout.write(JSON.stringify({verificationReadsReceipt:receipt})+"\n");
    return checks;
  }finally{await runtime.server.close();await runtime.database?.close();}
}
