import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// This is a curated regression suite. Native DB, Docker and deployment evidence
// remain separately named proofs; a unit-test pass cannot stand in for them.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const plan=[
 {boundary:'SSRF, redirects, pinned DNS, bounded acquisition',cwd:'packages/acquisition',files:['src/acquisition.test.ts','src/mapped-address.test.ts','src/deadline.test.ts']},
 {boundary:'Hostile document pre-execution admission',cwd:'packages/conversion',files:['src/verification-parser.test.ts']},
 {boundary:'Admitted source lineage and provider classification/custody',cwd:'packages/application',files:['src/verification-admission.test.ts','src/verification-provider.test.ts','src/verification-provider-transport.test.ts','src/verification-semantic-observation.test.ts','src/verification-adjudication-decision.test.ts']},
 {boundary:'Bounded tool-free providers and strict semantic output',cwd:'packages/verification',files:['src/providers/providers.test.ts','src/providers/semantic-judge.test.ts','src/providers/gateway-semantic-observation.test.ts']},
 {boundary:'Registered artifacts, fencing and packet-bound decision authority',cwd:'packages/persistence',files:['src/verification-artifact-registration.test.ts','src/verification-fenced-artifact.test.ts','src/verification-adjudication-decision.test.ts','src/verification-adjudication-decision-preparation.test.ts']},
 {boundary:'HTTP ownership and decision authorization before hydration',cwd:'apps/api',files:['src/verification-ownership.test.ts','src/verification-adjudication-decision-runtime.test.ts','src/verification-adjudication-decision-route.test.ts','src/verification-adjudication-decision-reads-route.test.ts']},
];
const hash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const output=resolve(root,'../internal',`verification-security-regressions-${randomUUID()}`);
await mkdir(output); // Unique directory: never overwrite retained evidence.
const runner=resolve(root,'node_modules/vitest/vitest.mjs');
const results=[];
for(const [index,item] of plan.entries()){
 const cwd=resolve(root,item.cwd);
 const sources=await Promise.all(item.files.map(async file=>({file:`${item.cwd}/${file}`,digest:hash(await readFile(resolve(cwd,file)))})));
 const report=resolve(output,`${index}.json`),logFile=resolve(output,`${index}.log`);
 const args=[runner,'run',...item.files,'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${report}`];
 const startedAt=new Date().toISOString();
 let log='';
 const code=await new Promise((done,reject)=>{
  const child=spawn(process.execPath,args,{cwd,env:{...process.env,VITEST_MAX_WORKERS:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
  child.on('error',reject);child.on('close',code=>done(code));
 });
 await writeFile(logFile,log,{flag:'wx'});
 let totals;try{const parsed=JSON.parse(await readFile(report,'utf8'));totals={total:parsed.numTotalTests,passed:parsed.numPassedTests,failed:parsed.numFailedTests,pending:parsed.numPendingTests,todo:parsed.numTodoTests};}catch{totals=null;}
 results.push({...item,startedAt,completedAt:new Date().toISOString(),exitCode:code,totals,sources,logDigest:hash(log)});
 console.log(`${item.cwd}: exit ${code}, ${totals?.passed??'?'} passed / ${totals?.total??'?'} tests`);
 if(code!==0)break;
}
const passed=results.length===plan.length&&results.every(item=>item.exitCode===0&&item.totals&&item.totals.failed===0&&item.totals.pending===0&&item.totals.todo===0);
await writeFile(resolve(output,'receipt.json'),JSON.stringify({schemaVersion:'verification-security-regressions.v1',passed,scope:'Curated local regression tests; test adapters are not native infrastructure proof.',runnerDigest:hash(await readFile(fileURLToPath(import.meta.url))),results},null,2)+'\n',{flag:'wx'});
console.log(`Receipt: ${resolve(output,'receipt.json')}`);
process.exitCode=passed?0:1;
