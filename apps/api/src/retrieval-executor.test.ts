import {describe,expect,it} from "vitest";
import {validateRerankerOutput} from "./retrieval-executor.js";

describe("canonical retrieval reranker boundary",()=>{
  it("admits a unique finite subset of the bounded fused candidates",()=>{
    expect(()=>validateRerankerOutput(["a","b","c"],[{vectorItemId:"b",score:.9},{vectorItemId:"a",score:.2}])).not.toThrow();
  });
  it("rejects malformed output",()=>{for(const scores of [
    [{vectorItemId:"a",score:.2},{vectorItemId:"a",score:.1}],
    [{vectorItemId:"outside",score:.2}], [{vectorItemId:"a",score:Number.NaN}],
    [{vectorItemId:"a",score:2}], [],
  ])expect(()=>validateRerankerOutput(["a","b"],scores)).toThrow("INVALID_RERANKER_OUTPUT");});
});
