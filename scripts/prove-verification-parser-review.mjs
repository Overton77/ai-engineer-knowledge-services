import assert from "node:assert/strict";
import { execFile,execFileSync } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { SandboxedVerificationParser } from "../packages/conversion/dist/index.js";
import { sha256Digest } from "../packages/verification/dist/index.js";

const execute=promisify(execFile),expectedImage="sha256:9dff779c9d5df3b80876b1017da24befdd241bdc28950e084c504e158e08c906";
const image=execFileSync("docker",["image","inspect","--format","{{.Id}}","aiengineer-verification-parser:v1"],{encoding:"utf8",windowsHide:true}).trim();
assert.equal(image,expectedImage);
const run=["run","--rm","--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges:true","--pids-limit","32","--memory","512m","--memory-swap","512m","--cpus","1","--tmpfs","/tmp:rw,noexec,nosuid,nodev,size=64m","--entrypoint","python",image,"-c"];
const probes=[];
for(const [name,code,expected] of [
  ["network","import socket\ntry:\n socket.create_connection(('1.1.1.1',443),1)\n raise Exception('NETWORK_ALLOWED')\nexcept OSError as e:\n assert e.errno == 101\n print('network_unreachable')","network_unreachable"],
  ["readonly","try:\n open('/var/tmp/review-write','w')\n raise Exception('ROOT_WRITABLE')\nexcept OSError as e:\n assert e.errno == 30\n print('root_readonly')","root_readonly"],
] ){
  const output=(await execute("docker",[...run,code],{timeout:10_000,windowsHide:true,maxBuffer:4_096})).stdout.trim();assert.equal(output,expected);probes.push({name,result:output});
}
const parser=new SandboxedVerificationParser(image);
const sourceRoot=resolve("..","internal","verification-source-captures","20260905");
const realPdf=await readFile(resolve(sourceRoot,"tru-sample-report.pdf"));
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1_000);const cancellationStart=Date.now();
await assert.rejects(parser.parse({kind:"pdf",bytes:realPdf,parentDigest:sha256Digest(realPdf),signal:controller.signal}),/PARSER_CANCELLED/);clearTimeout(timer);
const cancellationMs=Date.now()-cancellationStart;
const objects=["<< /Type /Catalog /Pages 2 0 R >>",`<< /Type /Pages /Count 41 /Kids [${Array.from({length:41},(_,index)=>`${index+3} 0 R`).join(" ")} ] >>`,...Array.from({length:41},()=>"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>")];
let pdf="%PDF-1.4\n";const offsets=[0];for(let index=0;index<objects.length;index+=1){offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await assert.rejects(parser.parse({kind:"pdf",bytes:Buffer.from(pdf),parentDigest:sha256Digest(pdf)}),/PARSER_INPUT_OR_RESOURCE_FAILURE/);
const remaining=execFileSync("docker",["ps","--all","--filter","name=verification-parser-","--format","{{.Names}}"],{encoding:"utf8",windowsHide:true}).trim();assert.equal(remaining,"");
const hash=async(path)=>createHash("sha256").update(await readFile(path)).digest("hex");
const evidence={status:"passed",image,probes,cancellationMs,pageLimitRejected:true,noRemainingJobContainers:true,sourceHashes:{adapter:await hash(resolve("packages","conversion","src","verification-parser.ts")),parser:await hash(resolve("services","verification-parser","parser.py")),requirements:await hash(resolve("services","verification-parser","requirements.txt")),dockerfile:await hash(resolve("services","verification-parser","Dockerfile"))}};
const output=resolve("..","internal",`verification-parser-independent-review-20260905-${randomUUID()}.json`);await writeFile(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,evidenceFile:output}));
