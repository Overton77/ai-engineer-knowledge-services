import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";

const FIXTURE_ROWS = 6_000;
const FILTER_BUCKETS = 20;
const RESULT_LIMIT = 20;
const QUERY_SEEDS = [347, 2_563, 5_719] as const;
const PROOF_TENANT_ID = "00000000-0000-7000-8000-000000000099";

const connectionString = process.env.POSTGRES_URL?.trim();
if (!connectionString) throw new Error("POSTGRES_URL_REQUIRED");
const database = new PostgresCanonicalRepository({ connectionString, localOnly: true });

type ExplainRow = { "QUERY PLAN": unknown };
type ResultRow = { id: number };

function planUsesIndex(value: unknown, indexName: string): boolean {
  if (Array.isArray(value)) return value.some((item) => planUsesIndex(item,indexName));
  if (!value || typeof value !== "object") return false;
  const record=value as Record<string,unknown>;
  return record["Index Name"]===indexName || Object.values(record).some((item)=>planUsesIndex(item,indexName));
}

function planUsesNode(value:unknown,nodeType:string):boolean{
  if(Array.isArray(value))return value.some((item)=>planUsesNode(item,nodeType));
  if(!value||typeof value!=="object")return false;
  const record=value as Record<string,unknown>;
  return record["Node Type"]===nodeType||Object.values(record).some((item)=>planUsesNode(item,nodeType));
}

function redactQueryVector(value:unknown):unknown{
  if(Array.isArray(value))return value.map(redactQueryVector);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,redactQueryVector(item)]));
  if(typeof value==="string")return value.replace(/'\[[^']+\]'::halfvec\(1536\)/g,"'<query-vector-redacted>'::halfvec(1536)");
  return value;
}

try {
  const startedAt = new Date().toISOString();
  const observations = await database.transaction(PROOF_TENANT_ID,async(client)=>{
    await client.query(`create temporary table local_hnsw_fixture (
      id integer primary key,
      filter_bucket integer not null,
      embedding extensions.halfvec(1536) not null
    ) on commit drop`);
    await client.query(`insert into local_hnsw_fixture(id,filter_bucket,embedding)
      select i,i%$1,(
        array[
          sin(i*0.011)::real,cos(i*0.013)::real,sin(i*0.017)::real,cos(i*0.019)::real,
          sin(i*0.023+(i%$1)*0.071)::real,cos(i*0.029+(i%$1)*0.053)::real,
          ((i%97)-48)::real/97.0,((i%193)-96)::real/193.0
        ] || array_fill(0::real,array[1528])
      )::extensions.halfvec(1536)
      from generate_series(1,$2) i`,[FILTER_BUCKETS,FIXTURE_ROWS]);
    await client.query("create index local_hnsw_fixture_embedding_idx on local_hnsw_fixture using hnsw(embedding extensions.halfvec_cosine_ops) with (m=16,ef_construction=96)");
    await client.query("analyze local_hnsw_fixture");

    const results=[];
    for(const seed of QUERY_SEEDS){
      const bucket=seed%FILTER_BUCKETS;
      const queryVector=String((await client.query<{embedding:string}>("select embedding::text embedding from local_hnsw_fixture where id=$1",[seed])).rows[0]!.embedding);
      await client.query("set local hnsw.ef_search=400");
      await client.query("set local enable_indexscan=on");
      await client.query("set local enable_bitmapscan=on");
      await client.query("set local enable_seqscan=off");
      const explain=(await client.query<ExplainRow>(`explain (analyze,buffers,format json)
        select id from local_hnsw_fixture where filter_bucket=$2
        order by embedding operator(extensions.<=>) $1::extensions.halfvec(1536) limit $3`,[queryVector,bucket,RESULT_LIMIT])).rows[0]!["QUERY PLAN"];
      const ann=(await client.query<ResultRow>(`select id from local_hnsw_fixture where filter_bucket=$2
        order by embedding operator(extensions.<=>) $1::extensions.halfvec(1536) limit $3`,[queryVector,bucket,RESULT_LIMIT])).rows.map((row)=>row.id);

      await client.query("set local enable_indexscan=off");
      await client.query("set local enable_bitmapscan=off");
      await client.query("set local enable_seqscan=on");
      const exactExplain=(await client.query<ExplainRow>(`explain (analyze,buffers,format json)
        select id from local_hnsw_fixture where filter_bucket=$2
        order by embedding operator(extensions.<=>) $1::extensions.halfvec(1536) limit $3`,[queryVector,bucket,RESULT_LIMIT])).rows[0]!["QUERY PLAN"];
      const exact=(await client.query<ResultRow>(`select id from local_hnsw_fixture where filter_bucket=$2
        order by embedding operator(extensions.<=>) $1::extensions.halfvec(1536) limit $3`,[queryVector,bucket,RESULT_LIMIT])).rows.map((row)=>row.id);
      const exactSet=new Set(exact);
      const overlap=ann.filter((id)=>exactSet.has(id)).length;
      results.push({seed,filter:{field:"filter_bucket",value:bucket,selectivity:1/FILTER_BUCKETS},annIds:ann,exactIds:exact,overlap,recallAtK:overlap/exact.length,annExplain:redactQueryVector(explain),exactExplain:redactQueryVector(exactExplain)});
    }
    return results;
  });

  const hnswPlanObserved=observations.every((item)=>planUsesIndex(item.annExplain,"local_hnsw_fixture_embedding_idx"));
  const exactPlansForced=observations.every((item)=>planUsesNode(item.exactExplain,"Seq Scan")&&!planUsesIndex(item.exactExplain,"local_hnsw_fixture_embedding_idx"));
  const averageRecallAtK=observations.reduce((sum,item)=>sum+item.recallAtK,0)/observations.length;
  if(!hnswPlanObserved)throw new Error("HNSW_PLAN_NOT_OBSERVED");
  if(!exactPlansForced)throw new Error("EXACT_PLAN_NOT_FORCED");
  if(averageRecallAtK<0.8)throw new Error(`ANN_RECALL_BELOW_PROOF_FLOOR:${averageRecallAtK}`);
  const core={
    schemaVersion:"local-hnsw-proof/1.0.0",
    localOnly:true,
    canonicalAuthority:false,
    persistence:"temporary-table-on-commit-drop",
    tenantId:PROOF_TENANT_ID,
    dimensions:1536,
    fixtureRows:FIXTURE_ROWS,
    filterBuckets:FILTER_BUCKETS,
    resultLimit:RESULT_LIMIT,
    plannerSettings:{ann:{enableSeqscan:false,hnswEfSearch:400},exact:{enableIndexscan:false,enableBitmapscan:false}},
    hnswPlanObserved,
    exactPlansForced,
    averageRecallAtK,
    minimumRecallAtK:Math.min(...observations.map((item)=>item.recallAtK)),
    observations,
    startedAt,
    completedAt:new Date().toISOString(),
  };
  const receipt={...core,receiptDigest:sha256Digest(JSON.parse(JSON.stringify(core)))};
  const output=resolve("catalog/local-hnsw-proof.json");
  await mkdir(resolve("catalog"),{recursive:true});
  await writeFile(output,`${JSON.stringify(receipt,null,2)}\n`,"utf8");
  process.stdout.write(`${JSON.stringify({ok:true,output,fixtureRows:FIXTURE_ROWS,hnswPlanObserved,averageRecallAtK,minimumRecallAtK:receipt.minimumRecallAtK,receiptDigest:receipt.receiptDigest})}\n`);
} finally {
  await database.close();
}
