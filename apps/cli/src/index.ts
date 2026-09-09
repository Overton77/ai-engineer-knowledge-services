#!/usr/bin/env node
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { JsonValueSchema,OperationContextSchema } from "@aiengineer/knowledge-contracts";
import { dispatchCliCommand,resolveCommand } from "./commands.js";
import { runLocalDiagnosticsDemo } from "./diagnostics-demo.js";
import { runLocalBenchmarkVersionDiff } from "./benchmark-version-diff.js";
import { runDiagnosticsBenchmarkCapture } from "./benchmark-capture.js";
import { writeBenchmarkRefreshProposal } from "./benchmark-refresh-writer.js";
import { waitForVerification } from "./verification-completion.js";
import { isVerificationAttestationCliError, runVerificationAttestationExport, runVerificationAttestationInspect } from "./verification-attestation.js";
const args=process.argv.slice(2),human=args.includes("--human");
const option=(name:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const group=args[0]??"",action=args[1]??"",command=resolveCommand(group,action);
const print=(value:unknown)=>process.stdout.write(`${JSON.stringify(value,human?null:undefined,human?2:undefined)}\n`);
if(group==="demo"&&action==="diagnostics-companies"){
  try { const result=await runLocalDiagnosticsDemo(args); print(result); process.exitCode=result.exitCode; }
  catch(error){process.stderr.write(`${JSON.stringify({code:"DEMO_ERROR",message:error instanceof Error?error.message:"Unknown error"})}\n`);process.exitCode=2;}
}
else if(group==="benchmark"&&action==="capture"&&args[2]==="diagnostics-companies"){
  try { const result=await runDiagnosticsBenchmarkCapture(args,{writer:{writeBenchmarkRefreshProposal}});print(result);process.exitCode=result.exitCode; }
  catch(error){process.stderr.write(`${JSON.stringify({code:"BENCHMARK_CAPTURE_ERROR",message:error instanceof Error?error.message:"Unknown error"})}\n`);process.exitCode=2;}
}
else if(group==="benchmark"&&action==="diff"){
  try { print(await runLocalBenchmarkVersionDiff(args)); }
  catch(error){process.stderr.write(`${JSON.stringify({code:"BENCHMARK_DIFF_ERROR",message:error instanceof Error?error.message:"Unknown error"})}\n`);process.exitCode=2;}
}
else if(group==="verification"&&action==="attestation-export"){
  try { const result=await runVerificationAttestationExport(args);print(result.output);process.exitCode=result.exitCode; }
  catch(error){process.stderr.write(`${JSON.stringify({code:isVerificationAttestationCliError(error)?error.code:"ATTESTATION_EXPORT_FAILED"})}\n`);process.exitCode=2;}
}
else if(group==="verification"&&action==="attestation-inspect"){
  try { const result=await runVerificationAttestationInspect(args);print(result.output);process.exitCode=result.exitCode; }
  catch(error){process.stderr.write(`${JSON.stringify({code:isVerificationAttestationCliError(error)?error.code:"ATTESTATION_INSPECTION_FAILED"})}\n`);process.exitCode=2;}
}
else if(!command){process.stderr.write(`${JSON.stringify({code:"UNKNOWN_COMMAND",group,action})}\n`);process.exitCode=2;}
else try{
  if(command.mode==="unsupported")throw new Error(`CAPABILITY_NOT_ADMITTED:${command.reason}`);
  const baseUrl=option("--base-url")??process.env.KNOWLEDGE_API_URL;if(!baseUrl)throw new Error("KNOWLEDGE_API_URL or --base-url is required");
  const token=process.env.KNOWLEDGE_API_TOKEN;if(!token)throw new Error("KNOWLEDGE_API_TOKEN is required");
  const context=OperationContextSchema.parse(JSON.parse(option("--context")??"null"));
  const input=JsonValueSchema.parse(JSON.parse(option("--input")??"{}"));
  const timeoutMs=Number(option("--timeout-ms")??"60000");
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000)throw new Error("CLI_TIMEOUT_INVALID");
  const deadline=Date.now()+timeoutMs,signal=AbortSignal.timeout(timeoutMs);
  const client=new KnowledgeClient({baseUrl,getAccessToken:()=>token,fetch:(url,init)=>fetch(url,{...init,signal})});
  const accepted=await dispatchCliCommand(client,command,input,context);
  if(args.includes("--wait")&&command.mode==="verification_mutation"){
    const operationId=(accepted as {operationId?:string}).operationId;if(!operationId)throw new Error("OPERATION_ID_REQUIRED");
    const completed=await waitForVerification(client,operationId,context,Math.max(0,deadline-Date.now()));print(completed);process.exitCode=completed.exitCode;
  }else print(accepted);
}catch(error){process.stderr.write(`${JSON.stringify({code:"CLI_ERROR",message:error instanceof Error?error.message:"Unknown error"})}\n`);process.exitCode=2;}
