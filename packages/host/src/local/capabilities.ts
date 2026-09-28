/**
 * Capability matrix (FINAL-REVIEW R5) for the three execution contexts:
 *   server     — `createHost({ profile: "server" })` and its deployment; serves every operation it composes
 *                (until 5D the verification intent pipeline and registry run in the executor's serve mode);
 *   local      — `createHost({ profile: "local" })` over a file-backed store; offline operations need no
 *                network, database or credentials, provider operations need explicit provider configuration,
 *                and everything else is server-only;
 *   remote-cli — the CLI through `KnowledgeClient`; it never constructs host, so an authorization or network
 *                error surfaces to the caller and never falls back to local execution.
 */
export type ExecutionProfile = "server" | "local" | "remote-cli";

/** What a local operation needs beyond the file-backed store. */
export type LocalRequirement = "none" | "capture-provider" | "semantic-provider";

/** The local profile's operations, by their verification tool name, and the service method each calls. */
export const localVerificationOperations = {
  verify_supported_media_types: { method: "supportedMediaTypes", requires: "none" },
  // Text and HTML convert locally; document conversion is a capture-provider call (see LocalHostCapabilities).
  verify_capture_file: { method: "captureFile", requires: "none" },
  verify_capture_source: { method: "captureSource", requires: "capture-provider" },
  verify_list_captures: { method: "listCaptures", requires: "none" },
  verify_read_capture: { method: "readCapture", requires: "none" },
  verify_search_capture: { method: "searchCapture", requires: "none" },
  verify_locate_quote: { method: "locateQuote", requires: "none" },
  verify_register_artifact: { method: "registerArtifact", requires: "none" },
  verify_claims: { method: "verifyClaims", requires: "none" },
  verify_extraction: { method: "verifyExtraction", requires: "none" },
  verify_judge_semantics: { method: "judgeSemantics", requires: "semantic-provider" },
  verify_evaluate_policy: { method: "evaluatePolicy", requires: "none" },
  verify_seal_run: { method: "sealRun", requires: "none" },
  verify_check_report: { method: "checkReport", requires: "none" },
  verify_run_status: { method: "runStatus", requires: "none" },
  verify_get_artifact: { method: "artifact", requires: "none" },
} as const satisfies Record<string, { readonly method: string; readonly requires: LocalRequirement }>;

export type LocalOperation = keyof typeof localVerificationOperations;
export type LocalMethod = (typeof localVerificationOperations)[LocalOperation]["method"];

export type ProfileAvailability =
  | "server"
  | "offline"
  | "capture provider"
  | "semantic provider"
  | "server only"
  | "remote";

export function isLocalOperation(operation: string): operation is LocalOperation {
  return Object.hasOwn(localVerificationOperations, operation);
}

/** Where an operation can run under a profile. Operations the local profile does not compose are server-only. */
export function profileAvailability(profile: ExecutionProfile, operation: string): ProfileAvailability {
  if (profile === "server") return "server";
  if (profile === "remote-cli") return "remote";
  if (!isLocalOperation(operation)) return "server only";
  const { requires } = localVerificationOperations[operation];
  return requires === "none" ? "offline" : requires === "capture-provider" ? "capture provider" : "semantic provider";
}

export class HostCapabilityNotAdmittedError extends Error {
  readonly code = "CAPABILITY_NOT_ADMITTED" as const;
  constructor(
    readonly profile: ExecutionProfile,
    readonly operation: string,
    readonly requirement: Exclude<LocalRequirement, "none"> | "document-conversion" | "server-profile",
  ) {
    super(`CAPABILITY_NOT_ADMITTED:${profile}:${operation}:${requirement}`);
    this.name = "HostCapabilityNotAdmittedError";
  }
}
