import type { Digest } from "@aiengineer/knowledge-db-read";
import type { PlannedOutcome, ProposalOutcome } from "./plan.js";

/** `knowledge-ingestion-receipt.v1` — backed by `orchestration.operation_receipt` plus `temporal.knowledge_batch`. */

export interface ProposalReceipt {
  readonly proposalId: string;
  readonly outcome: ProposalOutcome;
  readonly created?: Readonly<Record<string, string | readonly string[]>>;
  readonly existing?: Readonly<Record<string, unknown>>;
  readonly supersedes?: readonly string[];
  readonly reason?: string;
  readonly noop?: boolean;
}

export interface ReceiptFailure {
  readonly code: string;
  readonly message: string;
  readonly sqlstate?: string;
  readonly details?: unknown;
  readonly whatChanged?: readonly unknown[];
  readonly touchedBy?: readonly string[];
}

export interface AffectedRef { readonly schema: string; readonly table: string; readonly id: string }

export interface IngestionReceipt {
  readonly schemaVersion: "knowledge-ingestion-receipt.v1";
  readonly receiptId: string;
  readonly operationIntentId: string;
  readonly intentRef: { readonly intentId: string; readonly intentDigest: Digest; readonly idempotencyKey: Digest };
  readonly planRef: { readonly planId: string; readonly artifactId?: string };
  readonly outcome: PlannedOutcome;
  readonly knowledgeBatch: { readonly knowledgeSeq: number; readonly inputDigest: string } | null;
  readonly head: { readonly before: number; readonly after: number; readonly rebased: boolean };
  readonly proposals: readonly ProposalReceipt[];
  readonly subjects: readonly { ref: string; entityId: string | null; created: boolean }[];
  readonly claims: readonly { runId: string; claimId: string; claimRowId: string | null }[];
  readonly affectedRefs: readonly AffectedRef[];
  readonly duplicateOf: string | null;
  readonly priorReceiptsForIntentId: readonly string[];
  readonly failure: ReceiptFailure | null;
  readonly storage: { readonly intentArtifactId?: string; readonly planArtifactId?: string; readonly receiptArtifactId?: string; readonly storageState: "stored" | "pending" | "none"; readonly lineage?: "written" | "denied" };
  readonly verify: { readonly suggestedReadIntent: unknown } | null;
  readonly executedAt: string;
  readonly executorVersion: string;
}
