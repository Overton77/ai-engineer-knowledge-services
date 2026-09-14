import type { ReadExecutor } from "@aiengineer/knowledge-db-read";
import type { IngestionIntentInput } from "../src/intent.js";
export function withSnapshot(reads: ReadExecutor, intent: IngestionIntentInput): Promise<IngestionIntentInput>;
