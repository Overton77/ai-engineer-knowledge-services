import type { SemanticJudgeAdapter, SemanticJudgeExecution } from "../semantic/verification.js";
import { SemanticJudgeOutputSchema, type SemanticJudgeIdentity, type SemanticJudgeOutput } from "@aiengineer/knowledge-contracts";

/** Offline recorded fixture adapter. It never reads files, calls a network, or exposes tools. */
export class RecordedSemanticJudgeAdapter implements SemanticJudgeAdapter {
  readonly toolCatalog = [] as const;
  readonly maximumInputCharacters: number;
  readonly identity: SemanticJudgeIdentity;
  readonly #outputs: ReadonlyMap<string, SemanticJudgeOutput>;

  constructor(config: { readonly identity: SemanticJudgeIdentity; readonly outputs: ReadonlyMap<string, SemanticJudgeOutput>; readonly maximumInputCharacters?: number }) {
    this.identity = Object.freeze({ ...config.identity });
    const frozen = (value: unknown): unknown => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
        Object.freeze(value);
      }
      return value;
    };
    this.#outputs = new Map([...config.outputs].map(([key, value]) => [key, frozen(structuredClone(value)) as SemanticJudgeOutput]));
    this.maximumInputCharacters = config.maximumInputCharacters ?? 64_000;
  }

  async judge(input: Parameters<SemanticJudgeAdapter["judge"]>[0], execution: SemanticJudgeExecution): Promise<SemanticJudgeOutput> {
    if (execution.signal?.aborted) throw new Error("JUDGE_CANCELLED");
    const output = input.inputArtifactDigest === undefined ? undefined : this.#outputs.get(input.inputArtifactDigest);
    if (!output) throw new Error("RECORDED_JUDGE_FIXTURE_MISSING");
    return SemanticJudgeOutputSchema.parse(structuredClone(output));
  }
}

export type NliClassifier = (input: {
  readonly assertionId: string;
  readonly proposition: string;
  readonly qualifiers: readonly string[];
  readonly entityBindings: readonly { readonly role: string; readonly canonicalId: string }[];
  readonly fragments: readonly { readonly fragmentId: string; readonly exactText: string }[];
  readonly execution: SemanticJudgeExecution;
}) => Promise<Pick<SemanticJudgeOutput, "verdict" | "nliLabel" | "supportingFragmentIds" | "contradictingFragmentIds" | "unsupportedFacets" | "qualifiersPreserved" | "publicRationale">>;

/** Adapter boundary for a separately deployed three way NLI model. */
export class ThreeWayNliSemanticJudgeAdapter implements SemanticJudgeAdapter {
  readonly toolCatalog = [] as const;
  readonly maximumInputCharacters: number;
  readonly identity: SemanticJudgeIdentity;
  readonly #classify: NliClassifier;

  constructor(config: { readonly identity: SemanticJudgeIdentity; readonly classify: NliClassifier; readonly maximumInputCharacters?: number }) {
    if (config.identity.capability !== "trained_nli") throw new Error("NLI_IDENTITY_CAPABILITY_INVALID");
    this.identity = Object.freeze({ ...config.identity });
    this.#classify = config.classify;
    this.maximumInputCharacters = config.maximumInputCharacters ?? 64_000;
  }

  async judge(input: Parameters<SemanticJudgeAdapter["judge"]>[0], execution: SemanticJudgeExecution): Promise<SemanticJudgeOutput> {
    if (execution.signal?.aborted) throw new Error("JUDGE_CANCELLED");
    const classified = await this.#classify({ assertionId: input.assertionId, proposition: input.proposition, qualifiers: input.qualifiers, entityBindings: input.entityBindings, fragments: input.fragments, execution });
    return SemanticJudgeOutputSchema.parse({ schemaVersion: "verification-semantic-judge.v1", assertionId: input.assertionId, ...classified });
  }
}
