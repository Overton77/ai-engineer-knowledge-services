import { authorizeSemanticCase, digestCanonicalJson, resolveWithAdmittedResolver, sha256Digest, type DeterministicSelectorResolver, type TrustedArtifactResolver, type VerificationSemanticReplayPort } from "@aiengineer/knowledge-verification";
import { replayCapturedSemanticAssessment } from "./verification-semantic-replay.js";

type ReplayInput = Parameters<VerificationSemanticReplayPort["replay"]>[0];
type Judges = Parameters<typeof replayCapturedSemanticAssessment>[0]["judges"];

/** Runtime resolver selects admitted profile/capture bindings; recorded judgments cannot choose them. */
export function createCapturedSemanticAuditReplay(options: {
  readonly createResolver: () => TrustedArtifactResolver;
  readonly resolveJudges: (input: { readonly auditBundle: ReplayInput["auditBundle"]; readonly assertionId: string }) => Promise<Judges>;
  readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
}): VerificationSemanticReplayPort {
  const { createResolver, resolveJudges } = options, selectorResolvers = [...(options.selectorResolvers ?? [])];
  return { async replay(input) {
    const audit = structuredClone(input.auditBundle), deterministic = structuredClone(input.deterministicResult), policyInputs = structuredClone(input.recordedPolicyInputs);
    const bytes = new Map([...input.verifiedRepresentationBytes].map(([id,value]) => [id,value.slice()]));
    const bundle = audit.verificationBundle, artifacts = new Map([...audit.manifest.inputArtifacts,...audit.manifest.outputArtifacts].map(handle => [handle.artifactId,handle]));
    const assessments = [], replayedArtifactIds = new Set<string>();
    for (const recorded of policyInputs.assertions) {
      if (!recorded.semantic.judgeIdentities.length && ["pending_semantic_review","unverifiable"].includes(recorded.semantic.verdict)) continue;
      const assertion = bundle.assertions.find(item => item.assertionId === recorded.assertionId), mechanical = deterministic.assertions.find(item => item.assertionId === recorded.assertionId);
      if (!assertion || !mechanical) throw new Error("SEMANTIC_AUDIT_ASSERTION_MISSING");
      const selected = assertion.evidence.map(edge => {
        const capture = bundle.captures.find(item => item.captureId === edge.fragment.captureId);
        const handle = capture && [capture.contentArtifact,...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])].find(item => item.artifactId === edge.fragment.representationArtifactId);
        const content = handle && bytes.get(handle.artifactId);
        if (!handle || !content || content.byteLength !== handle.byteLength || sha256Digest(content) !== handle.digest) throw new Error("SEMANTIC_AUDIT_REPRESENTATION_MISSING");
        const selection = resolveWithAdmittedResolver({ captureId: edge.fragment.captureId, representationArtifactId: handle.artifactId, representationDigest: handle.digest, selector: edge.fragment.selector, content: content.slice() },selectorResolvers);
        const original = mechanical.evidence.find(item => item.evidenceId === edge.evidenceId);
        if (!selection || !original || digestCanonicalJson(selection.resolution) !== digestCanonicalJson(original.resolution)) throw new Error("SEMANTIC_AUDIT_SELECTOR_DRIFT");
        return { evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: new TextDecoder("utf-8",{fatal:true}).decode(selection.selectedContent), selectedContentDigest: sha256Digest(selection.selectedContent) };
      });
      const semanticCase = authorizeSemanticCase(bundle,deterministic,recorded.assertionId,selected);
      const judges = await resolveJudges({ auditBundle: structuredClone(audit), assertionId: recorded.assertionId });
      for (const judge of judges) {
        for (const handle of [judge.profileArtifact,judge.observationArtifact]) if (digestCanonicalJson(artifacts.get(handle.artifactId) ?? null) !== digestCanonicalJson(handle)) throw new Error("SEMANTIC_AUDIT_JUDGE_ARTIFACT_UNLISTED");
        if (judge.capture.tenantId !== audit.tenantId || !artifacts.has(judge.capture.transportArtifactId)) throw new Error("SEMANTIC_AUDIT_CAPTURE_UNLISTED");
      }
      const replayed = await replayCapturedSemanticAssessment({ semanticCase, producerDeploymentId: bundle.producer.deploymentId, expectedAssessment: recorded.semantic, judges, createResolver });
      if (replayed.replayedArtifactIds.some(id => !artifacts.has(id))) throw new Error("SEMANTIC_AUDIT_CUSTODY_UNLISTED");
      assessments.push(replayed.assessment);
      for (const id of replayed.replayedArtifactIds) replayedArtifactIds.add(id);
    }
    return { assessments, replayedArtifactIds: [...replayedArtifactIds].sort() };
  } };
}
