import {PostgresCanonicalRepository,type LeasedStep} from "@aiengineer/knowledge-persistence";
import {createConfiguredVerificationStructuredExtractionHandler} from "../apps/worker/src/verification-structured-extraction-runtime.js";
import {CanonicalActivityRegistry,createCanonicalActivityExecutor} from "../apps/worker/src/activity-registry.js";
import {CanonicalDurableKnowledgeWorker} from "../apps/worker/src/canonical-worker.js";

// Private signing material travels only through local IPC and is never logged or retained.
process.once("message",async(value:unknown)=>{
  const input=value as {tenantId:string;operationId:string;namespace:string;scenario:"accepted"|"http"|"schema";environment:Record<string,string>};
  const database=new PostgresCanonicalRepository({connectionString:process.env.POSTGRES_URL!,localOnly:true});
  let activeLease:LeasedStep|undefined;
  try{
    const handler=createConfiguredVerificationStructuredExtractionHandler({database,tenantId:input.tenantId,projectUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,maximumArtifactBytes:16_000_000,environment:input.environment,
      syntheticFetch:async(_url,options)=>{
        process.send?.({kind:"synthetic_dispatch"});
        process.send?.({kind:"dispatched_before_response",lease:activeLease});
        await new Promise(()=>{});
        const wire=JSON.parse(new TextDecoder().decode(options?.body as Uint8Array)),raw={id:`${input.namespace}-${input.scenario}-${input.operationId}`,model:wire.model,...(input.scenario==="http"?{error:{message:"Synthetic unavailable"}}:{choices:[{message:{content:JSON.stringify({value:input.scenario==="accepted"?"Exact value 42":42})}}],precontext:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost:0.00001}})};
        return new Response(JSON.stringify(raw),{status:input.scenario==="http"?503:200});
      }});
    if(!handler)throw new Error("HANDLER_MISSING");
    const registry=new CanonicalActivityRegistry([handler]);
    const repository=new Proxy(database,{get(target,property){
      if(property==="completeStep"||property==="failStructuredExtractionStep")return async(_tenant:string,lease:LeasedStep)=>{
        process.send?.({kind:"dispatched_before_response",lease});
        await new Promise(()=>{});
      };
      const member=Reflect.get(target,property,target);return typeof member==="function"?member.bind(target):member;
    }});
    const worker=new CanonicalDurableKnowledgeWorker(`${input.namespace}-child`,input.tenantId,repository,async lease=>{activeLease=lease;return createCanonicalActivityExecutor(database,registry)(lease);},2_000,registry.operationKinds());
    await worker.runOperationOnce(input.operationId);throw new Error("EXPECTED_CRASH_BOUNDARY_MISSING");
  }catch{process.send?.({kind:"failed"});process.exitCode=1;await database.close();process.disconnect?.();}
});
