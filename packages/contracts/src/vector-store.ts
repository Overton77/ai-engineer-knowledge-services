import { z } from "zod";
import { A2AOperationBindingSchema } from "./a2a.js";
import { JsonValueSchema, UuidSchema } from "./primitives.js";

export const VectorStoreCreateInputSchema=z.strictObject({schemaVersion:z.literal("knowledge.vector-store/v1"),slug:z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),name:z.string().trim().min(1).max(255),purpose:z.string().trim().min(1).max(2_000),storeClass:z.enum(["official_canonical","internal_exploratory","user_managed"]),visibility:z.enum(["private","tenant","public"]),quotaProfile:z.strictObject({maximumDocuments:z.int().positive().max(10_000_000),maximumBytes:z.int().positive().max(Number.MAX_SAFE_INTEGER),maximumSpaces:z.int().positive().max(100)}),retentionPolicy:z.discriminatedUnion("mode",[z.strictObject({mode:z.literal("indefinite")}),z.strictObject({mode:z.literal("duration"),days:z.int().positive().max(36_500)})]),deletionPolicy:z.strictObject({mode:z.enum(["tombstone_only","review_required"]),minimumRetentionDays:z.int().nonnegative().max(36_500)}),supersedesId:UuidSchema.optional()});
export type VectorStoreCreateInput=z.infer<typeof VectorStoreCreateInputSchema>;

export const VectorStoreDocumentsInputSchema=z.strictObject({schemaVersion:z.literal("knowledge.vector-store-documents/v1"),vectorStoreId:UuidSchema,documents:z.array(z.strictObject({documentId:UuidSchema,documentVersionId:UuidSchema,representationId:UuidSchema,requestedProfile:JsonValueSchema})).min(1).max(1_000)});
export type VectorStoreDocumentsInput=z.infer<typeof VectorStoreDocumentsInputSchema>;

export const VectorStoreIngestionChainSchema=z.strictObject({attachmentId:UuidSchema,transformationOperationId:UuidSchema,chunkSetId:UuidSchema,chunkSetOperationId:UuidSchema,promotionProposalId:UuidSchema,promotionProposalOperationId:UuidSchema,promotionDecisionId:UuidSchema,promotionDecisionOperationId:UuidSchema,embeddingRunId:UuidSchema,embeddingOperationId:UuidSchema,publicationId:UuidSchema,publicationOperationId:UuidSchema});
export const VectorStoreIngestionInputSchema=z.strictObject({schemaVersion:z.literal("knowledge.vector-store-ingestion/v1"),vectorStoreId:UuidSchema,chains:z.array(VectorStoreIngestionChainSchema).min(1).max(1_000),a2a:A2AOperationBindingSchema.optional()});
export type VectorStoreIngestionInput=z.infer<typeof VectorStoreIngestionInputSchema>;
