import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDiagnosticsGeneratedReportSemanticFixture } from "./verification-diagnostics-generated-report-semantic-fixture.js";

const repository=resolve(import.meta.dirname,"../../../.."),fixtureDigest="sha256:e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d" as const;
const fixtureDirectory=resolve(repository,"catalog/verification-semantic-fixtures",fixtureDigest.slice(7));
const temporary:string[]=[];
afterEach(async()=>{for(const path of temporary.splice(0))await rm(path,{recursive:true,force:true});});

describe("generated report semantic replay fixture",()=>{
 it("loads the pinned sealed fixture without exposing mutable response records",async()=>{
  const fixture=await loadDiagnosticsGeneratedReportSemanticFixture({directory:fixtureDirectory,expectedFixtureDigest:fixtureDigest});
  expect(fixture).toMatchObject({fixtureDigest,entryDigests:expect.any(Array)});
  expect(fixture.entryDigests).toHaveLength(29);expect(fixture).not.toHaveProperty("records");
 });

 it("rejects a retained response byte change before replay",async()=>{
  const parent=await mkdtemp(resolve(tmpdir(),"generated-report-semantics-"));temporary.push(parent);const copy=resolve(parent,"fixture");await cp(fixtureDirectory,copy,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(copy,"manifest.json"),"utf8")) as {artifacts:{kind:string;file:string}[]},artifact=manifest.artifacts.find(item=>item.kind==="raw_response")!;
  const path=resolve(copy,artifact.file),bytes=await readFile(path);await writeFile(path,Buffer.concat([bytes,Buffer.from("x")]));
  await expect(loadDiagnosticsGeneratedReportSemanticFixture({directory:copy,expectedFixtureDigest:fixtureDigest})).rejects.toThrow("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ARTIFACT_DIGEST_MISMATCH");
 });
});
