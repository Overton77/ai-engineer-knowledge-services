import { z } from "zod";
import { ImmutableResourceSchema, NonEmptyStringSchema, Sha256DigestSchema, SourceLocatorSchema, UuidSchema } from "./primitives.js";

export const ChunkSetSchema = ImmutableResourceSchema.extend({
  representationId: UuidSchema, procedureVersionId: UuidSchema, tokenizer: NonEmptyStringSchema,
  configurationDigest: Sha256DigestSchema, inputManifestDigest: Sha256DigestSchema,
  outputManifestDigest: Sha256DigestSchema, status: z.enum(["candidate", "validated", "accepted", "rejected", "superseded"]),
  qaEvaluationId: UuidSchema.optional(), promotionProposalId: UuidSchema.optional(), supersedesId: UuidSchema.optional(),
});
export type ChunkSet = z.infer<typeof ChunkSetSchema>;

export const RetrievalChunkSchema = ImmutableResourceSchema.extend({
  chunkSetId: UuidSchema, ordinal: z.int().nonnegative(), parentChunkId: UuidSchema.optional(),
  sourceText: NonEmptyStringSchema, sourceTextDigest: Sha256DigestSchema,
  contextualPrefix: z.string(), embeddingText: NonEmptyStringSchema, embeddingTextDigest: Sha256DigestSchema,
  sourceTokenCount: z.int().nonnegative(), embeddingTokenCount: z.int().positive(), role: NonEmptyStringSchema,
  language: NonEmptyStringSchema.optional(), lifecycle: z.enum(["candidate", "accepted", "superseded", "withdrawn"]),
});
export type RetrievalChunk = z.infer<typeof RetrievalChunkSchema>;

export const ChunkSpanSchema = ImmutableResourceSchema.extend({
  chunkId: UuidSchema, ordinal: z.int().nonnegative(), nodeId: UuidSchema, locator: SourceLocatorSchema,
});
export type ChunkSpan = z.infer<typeof ChunkSpanSchema>;
export const ChunkEdgeSchema = z.strictObject({
  fromChunkId: UuidSchema, toChunkId: UuidSchema,
  relation: z.enum(["parent", "continuation", "overlap", "elaboration", "summary", "same_table", "same_symbol", "cross_reference", "supersedes"]),
});
export type ChunkEdge = z.infer<typeof ChunkEdgeSchema>;
