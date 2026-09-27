import type { ReadExecutor } from "@aiengineer/knowledge-db";
import type { IngestionIntentInput } from "../../src/ingestion/intent.js";
export function withSnapshot(reads: ReadExecutor, intent: IngestionIntentInput): Promise<IngestionIntentInput>;
