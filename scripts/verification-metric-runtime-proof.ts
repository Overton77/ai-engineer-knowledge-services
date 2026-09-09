import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { OperationContext, VerifyMetricObservationRequest } from "@aiengineer/knowledge-contracts";
import type { VerificationMetricProfileGrant,VerificationSealPolicyGrant } from "@aiengineer/knowledge-application";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { createApiRuntime } from "../apps/api/src/index.js";
import { startWorker } from "../apps/worker/src/index.js";
import { buildKnowledgeMcpApp } from "../apps/mcp/src/index.js";
import { dispatchCliCommand, resolveCommand } from "../apps/cli/src/commands.js";
import { waitForVerification } from "../apps/cli/src/verification-completion.js";

/** Called only by the guarded local fixture; exercises normal runtime factories. */
export async function proveMetricRuntime(input: {
  context: OperationContext;
  request: VerifyMetricObservationRequest;
  profileGrant: VerificationMetricProfileGrant;
  verifierDeploymentId: string;
  imageDigest: string;
  sameDeploymentAttemptId: string;
  producerDeploymentId: string;
  sealingPolicyGrant?:VerificationSealPolicyGrant;
}): Promise<Record<string, boolean>> {
  const { context } = input;
  const connectionString = process.env.POSTGRES_URL!, projectUrl = process.env.SUPABASE_URL!;
  for (const [value, port] of [[connectionString, "54322"], [projectUrl, "54321"]]) {
    const url = new URL(value!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.port === port, "METRIC_RUNTIME_PROOF_LOCAL_ONLY");
  }
  const token = `local-metric-${randomUUID()}`;
  const identity = { actor: context.actor, grants: [{ tenantId: context.tenantId, roles: ["knowledge_operator" as const], scopes: [] }] };
  const environment = {
    NODE_ENV: "test", POSTGRES_URL: connectionString, SUPABASE_URL: projectUrl,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!, CANONICAL_LOCAL_ONLY: "1",
    KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: context.tenantId,
    WORKER_ID: `metric-runtime-${randomUUID()}`, WORKER_POLL_MS: "50",
    VERIFICATION_PARSER_IMAGE_DIGEST: input.imageDigest,
    VERIFICATION_STORAGE_BUCKET: "ai-engineer-cloud-bucket",
    VERIFICATION_METRIC_PROFILE_GRANTS_JSON: JSON.stringify([input.profileGrant]),
    VERIFICATION_METRIC_ENABLED: "1",
    ...(input.sealingPolicyGrant?{
      VERIFICATION_SEAL_POLICY_GRANTS_JSON:JSON.stringify([input.sealingPolicyGrant]),VERIFICATION_READS_ENABLED:"1",
      VERIFICATION_CODE_GIT_SHA:"local-runtime-seal-proof",VERIFICATION_CODE_DIRTY:"1",
      VERIFICATION_RUNTIME_PLATFORM:"local-supabase",VERIFICATION_RUNTIME_DEPLOYMENT_ID:input.verifierDeploymentId,
    }:{}),
    KNOWLEDGE_API_IDENTITIES: JSON.stringify([{ token, ...identity }]),
    VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify([{
      tenantId: context.tenantId, actor: context.actor, missionId: context.missionId,
      agentDeploymentId: input.verifierDeploymentId, capabilityVersion: context.capabilityVersion,
    }]),
  };
  const runtime = await createApiRuntime(environment);
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  const checks: Record<string, boolean> = {};
  try {
    const baseUrl = await runtime.server.listen({ host: "127.0.0.1", port: 0 });
    worker = await startWorker(environment);
    const client = new KnowledgeClient({ baseUrl, getAccessToken: () => token });
    const routing = { tenantId: context.tenantId, missionId: context.missionId!, workItemId: context.workItemId!,
      attemptId: context.attemptId, correlationId: context.correlationId, idempotencyKey: `metric-http-${randomUUID()}` };
    const accepted = await client.verifyMetricObservation(input.request, routing);
    const completed=await waitForVerification(client, accepted.operationId, routing, 15_000);
    assert.equal(completed.qualityPassed, true);
    if(input.sealingPolicyGrant){
      assert.ok(completed.receiptId);
      const receipt=await client.getReceipt(completed.receiptId,routing);
      const ref=(receipt.body as {output:{sealedRun:{runId:string;manifestDigest:string}}}).output.sealedRun;
      assert.ok(ref);
      const run=await client.getVerificationRun(ref.runId,routing);
      assert.equal(run.manifestDigest,ref.manifestDigest);
      assert.equal(run.lifecycle.policyOutcome,"abstain");
      checks.configuredWorkerSealReadThroughApi=true;
      const replayRequest={verificationContractVersion:"verification.v1" as const,runId:ref.runId,replayMode:"deterministic_only" as const};
      const replayRouting={...routing,idempotencyKey:`sealed-replay-${randomUUID()}`};
      const replayAccepted=await client.replayVerificationRun(replayRequest,replayRouting);
      const replayCompleted=await waitForVerification(client,replayAccepted.operationId,replayRouting,15_000);
      assert.equal(replayCompleted.qualityPassed,true);assert.ok(replayCompleted.receiptId);
      const replayReceipt=await client.getReceipt(replayCompleted.receiptId,replayRouting);
      const replayOutput=(replayReceipt.body as {output:{replayMatched:boolean;sourceRunId:string;deterministicResultDigest:string;policyOutcome:string}}).output;
      assert.equal(replayOutput.replayMatched,true);assert.equal(replayOutput.sourceRunId,ref.runId);
      assert.equal(replayOutput.deterministicResultDigest,run.resultDigest);assert.equal(replayOutput.policyOutcome,"abstain");
      assert.equal((await client.replayVerificationRun(replayRequest,replayRouting)).operationId,replayAccepted.operationId);
      checks.publicSealedRunReplayMatchesCanonicalAudit=true;
      checks.publicSealedRunReplayIdempotencyStable=true;
    }
    checks.configuredApiAndWorkerMetricPassed = true;
    assert.equal((await client.verifyMetricObservation(input.request, routing)).operationId, accepted.operationId);
    checks.metricHttpIdempotencyStable = true;
    const cliContext = { ...routing, idempotencyKey: `metric-cli-${randomUUID()}` };
    const cliAccepted = await dispatchCliCommand(client, resolveCommand("verify", "metric")!, input.request, cliContext) as { operationId: string };
    assert.equal((await waitForVerification(client, cliAccepted.operationId, cliContext, 15_000)).exitCode, 0);
    checks.metricCliDispatcherCompleted = true;
    const mcp = buildKnowledgeMcpApp({ operationService: {} as never, apiOrigin: baseUrl,
      resolveIdentity: value => value === token ? identity : undefined,
      createApiClient: accessToken => new KnowledgeClient({ baseUrl, getAccessToken: () => accessToken }) });
    try {
      const mcpUrl = await mcp.listen({ host: "127.0.0.1", port: 0 });
      const mcpContext = { ...routing, idempotencyKey: `metric-mcp-${randomUUID()}` };
      const response = await fetch(`${mcpUrl}/mcp`, { method: "POST", headers: {
        authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
      }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "knowledge_verify_metric", arguments: { context: mcpContext, request: input.request },
      } }) });
      assert.equal(response.status, 200);
      const rpc = await response.json() as { result: { isError?: boolean; structuredContent?: { operationId: string }; content: { text: string }[] } };
      assert.notEqual(rpc.result.isError, true);
      const operation = rpc.result.structuredContent ?? JSON.parse(rpc.result.content[0]!.text);
      assert.equal((await waitForVerification(client, operation.operationId, mcpContext, 15_000)).qualityPassed, true);
      checks.metricMcpHttpCompleted = true;
    } finally { await mcp.close(); }
    if(process.env.VERIFICATION_PROVE_TEMPORAL==="1"){
      const {proveVerificationTemporal}=await import("../../ai-engineer-mission-control/scripts/prove-verification-temporal.js");
      for(const testCase of [{context,deployment:input.verifierDeploymentId,expectedDisposition:"succeeded" as const},
        {context:{...context,attemptId:input.sameDeploymentAttemptId},deployment:input.producerDeploymentId,expectedDisposition:"quality_rejected" as const}]){
      const missionExecutionId=`verification-temporal-${randomUUID()}`;
      const temporalApi=await createApiRuntime({...environment,VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify([{
        tenantId:context.tenantId,actor:context.actor,missionId:context.missionId,agentDeploymentId:testCase.deployment,
        capabilityVersion:context.capabilityVersion,externalExecution:{runtime:"mission_control",runId:missionExecutionId},
      }])});
      temporalApi.server.addHook("onSend",async(_request,reply,payload)=>{
        if(reply.statusCode>=400){
          const problem=typeof payload==="string"?JSON.parse(payload):{};
          process.stdout.write(`${JSON.stringify({temporalProofApiRejection:{status:reply.statusCode,type:problem.type,title:problem.title,code:problem.code}})}\n`);
        }
        return payload;
      });
      try{
        const temporalUrl=await temporalApi.server.listen({host:"127.0.0.1",port:0});
        Object.assign(checks,await proveVerificationTemporal({baseUrl:temporalUrl,token,context:testCase.context,request:input.request,missionExecutionId,expectedDisposition:testCase.expectedDisposition}));
      }finally{await temporalApi.server.close();await temporalApi.database?.close();}
      }
      // Stop service execution so the cancellation fixture observes durable queued
      // work, rather than racing an already completed verification.
      await worker.stop("temporal-cancellation-fixture");
      for(const recoveryCase of [{kind:"cancel",attemptNo:4},{kind:"recovery",attemptNo:5}]){
      const cancellationAttemptId=randomUUID(),missionExecutionId=`verification-${recoveryCase.kind}-${randomUUID()}`;
      await runtime.database!.transaction(context.tenantId,async database=>{
        await database.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,$4,$5)",
          [cancellationAttemptId,context.tenantId,context.workItemId,recoveryCase.attemptNo,input.verifierDeploymentId]);
      });
      const cancellationApi=await createApiRuntime({...environment,VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify([{
        tenantId:context.tenantId,actor:context.actor,missionId:context.missionId,agentDeploymentId:input.verifierDeploymentId,
        capabilityVersion:context.capabilityVersion,externalExecution:{runtime:"mission_control",runId:missionExecutionId},
      }])});
      let queuedOperationId:string|undefined,notifyQueued:((id:string)=>void)|undefined;
      cancellationApi.server.addHook("onSend",async(request,reply,payload)=>{
        if(request.method==="GET"&&reply.statusCode===200&&request.url.startsWith("/v1/verification/operations/")&&typeof payload==="string"){
          const operation=JSON.parse(payload);
          if(operation.state==="queued"){queuedOperationId=operation.operationId;notifyQueued?.(operation.operationId);}
        }
        return payload;
      });
      try{
        const baseUrl=await cancellationApi.server.listen({host:"127.0.0.1",port:0});
        const fixture={baseUrl,token,context:{...context,attemptId:cancellationAttemptId},request:input.request,missionExecutionId,
          waitForQueuedOperation:()=>queuedOperationId?Promise.resolve(queuedOperationId):new Promise<string>((resolve,reject)=>{
            const timeout=setTimeout(()=>reject(new Error("TEMPORAL_QUEUED_OBSERVATION_TIMEOUT")),30_000);
            notifyQueued=id=>{clearTimeout(timeout);resolve(id);};
          })};
        if(recoveryCase.kind==="cancel"){
          const {proveVerificationTemporalCancellation}=await import("../../ai-engineer-mission-control/scripts/prove-verification-temporal-cancellation.js");
          Object.assign(checks,await proveVerificationTemporalCancellation(fixture));
        }else{
          const {proveVerificationTemporalRecovery}=await import("../../ai-engineer-mission-control/scripts/prove-verification-temporal-recovery.js");
          const recovered=await proveVerificationTemporalRecovery({...fixture,resumeServiceWorker:async()=>{worker=await startWorker(environment);}});
          Object.assign(checks,recovered.checks);
          const records=await runtime.database!.transaction(context.tenantId,async database=>
            (await database.query("select id from knowledge_service.operation where tenant_id=$1 and attempt_id=$2 and operation_kind='verification_metric'",[context.tenantId,cancellationAttemptId])).rows);
          assert.deepEqual(records.map(record=>record.id),[recovered.operationId],"RECOVERY_MUST_NOT_DUPLICATE_DURABLE_OPERATION");
          checks.temporalRecoverySingleDurableOperation=true;
        }
      }finally{await cancellationApi.server.close();await cancellationApi.database?.close();}
      }
    }
    if(["1","http"].includes(process.env.VERIFICATION_PROVE_TEMPORAL??"")){
      const {proveVerificationHttp}=await import("../../ai-engineer-mission-control/scripts/prove-verification-http.js");
      for(const testCase of [{attemptNo:6,deployment:input.verifierDeploymentId,expectedDisposition:"succeeded" as const},
        {attemptNo:7,deployment:input.producerDeploymentId,expectedDisposition:"quality_rejected" as const}]){
        const attemptId=randomUUID(),missionExecutionId=`verification-http-${randomUUID()}`;
        await runtime.database!.transaction(context.tenantId,async database=>{
          await database.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,$4,$5)",
            [attemptId,context.tenantId,context.workItemId,testCase.attemptNo,testCase.deployment]);
        });
        const httpApi=await createApiRuntime({...environment,VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify([{
          tenantId:context.tenantId,actor:context.actor,missionId:context.missionId,agentDeploymentId:testCase.deployment,
          capabilityVersion:context.capabilityVersion,externalExecution:{runtime:"mission_control",runId:missionExecutionId},
        }])});
        try{
          const baseUrl=await httpApi.server.listen({host:"127.0.0.1",port:0});
          Object.assign(checks,await proveVerificationHttp({baseUrl,token,context:{...context,attemptId},request:input.request,
            missionExecutionId,expectedDisposition:testCase.expectedDisposition}));
        }finally{await httpApi.server.close();await httpApi.database?.close();}
      }
    }
    if(["1","uncertain"].includes(process.env.VERIFICATION_PROVE_TEMPORAL??"")){
      await worker.stop("temporal-uncertain-cancellation-fixture");
      const attemptId=randomUUID(),missionExecutionId=`verification-uncertain-${randomUUID()}`;
      await runtime.database!.transaction(context.tenantId,async database=>{
        await database.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,$4,$5)",
          [attemptId,context.tenantId,context.workItemId,8,input.verifierDeploymentId]);
      });
      const uncertainApi=await createApiRuntime({...environment,VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify([{
        tenantId:context.tenantId,actor:context.actor,missionId:context.missionId,agentDeploymentId:input.verifierDeploymentId,
        capabilityVersion:context.capabilityVersion,externalExecution:{runtime:"mission_control",runId:missionExecutionId},
      }])});
      try{
        const baseUrl=await uncertainApi.server.listen({host:"127.0.0.1",port:0});
        const {proveVerificationTemporalUncertainCancellation}=await import("../../ai-engineer-mission-control/scripts/prove-verification-temporal-uncertain-cancellation.js");
        Object.assign(checks,await proveVerificationTemporalUncertainCancellation({baseUrl,token,context:{...context,attemptId},request:input.request,missionExecutionId}));
        const records=await runtime.database!.transaction(context.tenantId,async database=>
          (await database.query("select status from knowledge_service.operation where tenant_id=$1 and attempt_id=$2 and operation_kind='verification_metric'",[context.tenantId,attemptId])).rows);
        assert.deepEqual(records,[{status:"cancelled"}],"UNCERTAIN_CANCELLATION_MUST_LEAVE_ONE_CANCELLED_OPERATION");
        checks.temporalUncertainCancellationSingleDurableOperation=true;
      }finally{await uncertainApi.server.close();await uncertainApi.database?.close();}
    }
    return checks;
  } finally {
    await worker?.stop("metric-proof-complete");
    await runtime.server.close();
    await runtime.database?.close();
  }
}
