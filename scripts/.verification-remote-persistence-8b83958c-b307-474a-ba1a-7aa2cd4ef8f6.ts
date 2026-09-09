import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Assertion, Judgment, VerificationArtifactHandle, VerificationBundle, VerificationPolicyDefinition, VerificationRunManifest } from "@aiengineer/knowledge-contracts";
import { createOfflineVerificationPolicyReplayPort } from "@aiengineer/knowledge-application";
import { PostgresCanonicalRepository, PostgresVerificationRepository, createVerificationArtifactHandle } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid, type ArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, replayAuditBundle, sealAuditBundle, sha256Digest, verificationManifestDigest, verifyDeterministicBundle } from "@aiengineer/knowledge-verification";

const postgresUrl = process.env.POSTGRES_URL?.trim();
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
if (!postgresUrl || !supabaseUrl || !supabaseSecretKey) throw new Error("LOCAL_PERSISTENCE_CONFIGURATION_REQUIRED");
const pgTarget=new URL(postgresUrl),storageTarget=new URL(supabaseUrl);
if (!(pgTarget.hostname==='db.wkythqbofmckbuoothhn.supabase.co'||(pgTarget.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(pgTarget.username)==='postgres.wkythqbofmckbuoothhn')) || storageTarget.origin!=='https://wkythqbofmckbuoothhn.supabase.co' || pgTarget.searchParams.get('sslmode')!=='verify-full') throw new Error('REMOTE_PROOF_TARGET_DENIED');
const proofNamespace = `verification-remote-persistence-${randomUUID()}`;
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const id = (label: string) => deterministicUuid("verification-persistence-proof", `${proofNamespace}:${label}`);
const createdAt = new Date().toISOString();
const bucket = "ai-engineer-cloud-bucket";
const encode = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const database = new PostgresCanonicalRepository({ connectionString:postgresUrl,localOnly:false,connectionTimeoutMs:15_000 });
const store = new SupabaseArtifactStore({ projectUrl:supabaseUrl,serviceRoleKey:supabaseSecretKey,bucket,maximumBytes:4_194_304 });
const authorizedTenant = tenantId;
const repository = new PostgresVerificationRepository(database,store,{
  async authorize(input) { if (input.tenantId !== authorizedTenant) throw new Error("ARTIFACT_ACCESS_DENIED"); },
});

const checks: Record<string, boolean> = {};
const expectFailure = async (name: string, action: () => Promise<unknown>, pattern: RegExp) => {
  try { await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) throw new Error(`${name}_WRONG_FAILURE:${message}`);
    checks[name] = true;
    return;
  }
  throw new Error(`${name}_DID_NOT_FAIL`);
};

const handle = (bytes: Uint8Array, activity: string, options: {
  mediaType?: string; parents?: readonly string[]; transformation?: `sha256:${string}`; classification?: "public"|"internal"|"confidential"|"restricted";
} = {}) => createVerificationArtifactHandle({
  tenantId,bytes,mediaType:options.mediaType??"application/json",createdAt,producerActivityId:activity,producerVersion:"proof.v1",
  encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:options.classification??"internal",
  parentArtifactIds:options.parents??[],...(options.transformation?{transformationSignature:options.transformation}:{}),
});

async function register(artifact: VerificationArtifactHandle, bytes: Uint8Array, artifactType: string, bucketClass: "source_captures"|"candidate"|"accepted"|"ledger"|"published") {
  return repository.registerArtifact({ handle:artifact,bytes,artifactType,bucketClass,storageBucket:bucket,producerAttemptId,missionId });
}

const missionId = id("mission");
const workItemId = id("work-item");
const producerAttemptId = id("producer-attempt");
const verifierAttemptId = id("verifier-attempt");
const sameDeploymentAttemptId = id("same-deployment-attempt");
const runId = id("run");
const sourceId = id("source");
const captureId = id("capture");
const locatorId = id("locator");
const claimId = id("claim");

try {
  await database.transaction(tenantId, async (client) => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId,tenantId,proofNamespace,"Prove verification persistence"]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_claims',$4::jsonb)", [workItemId,tenantId,missionId,JSON.stringify({ proofNamespace })]);
    await client.query(`insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values
      ($1,$2,$3,1,'proof-producer',$4),($5,$2,$3,2,'proof-verifier',$4),($6,$2,$3,3,'proof-producer',$4)`,
      [producerAttemptId,tenantId,workItemId,createdAt,verifierAttemptId,sameDeploymentAttemptId]);
  });

  const sourceDocument = { package:"@aiengineer/verification",claim:"The verification result is replayable.",version:1 };
  const sourceBytes = new TextEncoder().encode(JSON.stringify(sourceDocument,null,2));
  const sourceArtifact = handle(sourceBytes,"capture-source",{ mediaType:"application/json" });
  await register(sourceArtifact,sourceBytes,"source_capture","source_captures");

  const projectionBytes = encode(sourceDocument);
  const projectionTransform = sha256Digest("json-canonicalization:RFC8785:v1");
  const projectionArtifact = handle(projectionBytes,"canonicalize-json",{ parents:[sourceArtifact.artifactId],transformation:projectionTransform });
  await register(projectionArtifact,projectionBytes,"canonical_source_projection","source_captures");

  const policyDefinition: VerificationPolicyDefinition = {
    schemaVersion:"verification-policy.v1",policyVersion:"verification-policy-proof.v1",definitionId:"verification-persistence-proof-policy",
    criticalDownstreamUses:["publication","clinical_decision"],requireCrossFamilyForRisk:["high","critical"],
    requireIndependentAuthorityForScopes:["population_accuracy","clinical_utility","comparative_superiority","causal","product_validation"],
    mixedEvidenceOutcome:"review",unknownCriticalOutcome:"abstain",authorityWithheldOutcome:"review",reviewAvailable:true,
  };
  const policyBytes = encode(policyDefinition);
  const policyArtifact = handle(policyBytes,"publish-policy");
  await register(policyArtifact,policyBytes,"verification_policy","ledger");

  const selectedBytes = encode(sourceDocument.claim);
  const assertion: Assertion = {
    assertionId:claimId,kind:"claim",claimType:"attribute",proposition:"The verification result is replayable.",
    producer:{deploymentId:"proof-producer",attemptId:producerAttemptId,capabilityVersion:"proof.v1"},qualifiers:[],entityBindings:[],derivation:"direct",
    evidence:[{ evidenceId:id("evidence"),fragment:{fragmentId:id("fragment"),captureId,representationArtifactId:projectionArtifact.artifactId,selector:{kind:"json_pointer",pointer:"/claim"}},
      role:"supports",origin:"declared",expectedSelectedContentDigest:sha256Digest(selectedBytes),authority:{authority:"primary",independence:"independent",directness:"direct",freshness:"current",applicability:"direct"},parserLineageArtifactIds:[projectionArtifact.artifactId] }],
    intent:{intentId:id("intent"),operation:"verify_claim_support",subject:claimId,expectedResult:"The JSON claim field resolves exactly.",method:"RFC8785 projection plus JSON Pointer",
      acceptanceCriteria:["one selector occurrence","matching selected-content digest"],abstainWhen:["capture or locator cannot be replayed"]},
    riskClass:"medium",downstreamUse:["persistence proof"],atomic:true,
  };
  const verificationBundle: VerificationBundle = {
    verificationContractVersion:"verification.v1",bundleId:id("bundle-contract"),policyVersion:policyDefinition.policyVersion,
    producer:assertion.producer,verifier:{deploymentId:"proof-verifier",attemptId:verifierAttemptId,capabilityVersion:"proof.v1"},
    sources:[{sourceId,kind:"api",canonicalUri:`proof:${proofNamespace}`,logicalIdentity:`proof-document:${proofNamespace}`}],
    captures:[{captureId,sourceId,capturedAt:createdAt,captureMethod:"local-fixture",captureMethodVersion:"proof.v1",contentArtifact:sourceArtifact,canonicalProjectionArtifact:projectionArtifact}],
    assertions:[assertion],metricObservations:[],lineage:[{edgeId:id("projection-lineage"),fromArtifactId:projectionArtifact.artifactId,toArtifactId:sourceArtifact.artifactId,relation:"derived_from",activityId:"canonicalize-json",activityVersion:"proof.v1"}],
  };
  const runtimePrincipals = { basis:"runtime_principal_binding" as const,producerDeploymentId:"proof-producer",verifierDeploymentId:"proof-verifier",
    producerPrincipalDigest:sha256Digest("proof-producer-principal"),verifierPrincipalDigest:sha256Digest("proof-verifier-principal") };
  const deterministicResult = verifyDeterministicBundle({bundle:verificationBundle,artifacts:[{artifactId:sourceArtifact.artifactId,content:sourceBytes},{artifactId:projectionArtifact.artifactId,content:projectionBytes}],runtimePrincipals});
  if (deterministicResult.status !== "passed") throw new Error(`DETERMINISTIC_FIXTURE_FAILED:${deterministicResult.summary.failedCheckCodes.join(",")}`);

  const bundleBytes = encode(verificationBundle);
  const bundleTransform = sha256Digest("verification-bundle-assembly:proof.v1");
  const bundleArtifact = handle(bundleBytes,"assemble-verification-bundle",{ parents:[projectionArtifact.artifactId,policyArtifact.artifactId],transformation:bundleTransform });
  await register(bundleArtifact,bundleBytes,"verification_bundle","ledger");
  const resultBytes = encode(deterministicResult);
  const resultArtifact = handle(resultBytes,"verify-deterministically",{ parents:[bundleArtifact.artifactId],transformation:sha256Digest("verifyDeterministicBundle:proof.v1") });
  await register(resultArtifact,resultBytes,"deterministic_verification_result","accepted");
  if (resultArtifact.digest !== digestCanonicalJson(deterministicResult)) throw new Error("RESULT_CANONICAL_DIGEST_MISMATCH");

  const recordedPolicyInputs = {
    schemaVersion:"verification-policy-inputs.v1" as const,policyVersion:policyDefinition.policyVersion,runId,recordedAt:createdAt,deterministicResult,
    assertions:[{assertionId:claimId,riskClass:"medium" as const,downstreamUse:["persistence proof"],claimScope:"source_summary" as const,
      semantic:{assertionId:claimId,verdict:"directly_supported" as const,disposition:"admit" as const,evidenceSupport:"satisfied" as const,worldCorrectness:"not_assessed" as const,
        attributionFaithfulness:"not_assessed" as const,sourceAuthority:"satisfied" as const,provenanceIntegrity:"satisfied" as const,judgeIdentities:[],
        supportingFragmentIds:[assertion.evidence[0]!.fragment.fragmentId],contradictingFragmentIds:[],unsupportedFacets:[],reasonCodes:[],crossFamilySecondJudge:false,rawProviderConfidences:[]},
      authorityStatus:"sufficient" as const,independentCorroboration:true,conflictPresent:false,criticalFactsKnown:true}],
    metrics:[],sourceAssessments:[{assessmentId:id("source-assessment"),assertionId:claimId,fragmentId:assertion.evidence[0]!.fragment.fragmentId,
      sourceFamilyId:"local-proof-independent",sourceOrganizationId:"local-proof",vector:assertion.evidence[0]!.authority,claimScope:"source_summary" as const,
      evidenceScope:"company_statement" as const,publicationRelation:"not_publication" as const,jurisdictionKnown:true,licenseKnown:true,freshnessKnown:true}],
  };
  const recordedPolicyInputsBytes = encode(recordedPolicyInputs);
  const recordedPolicyInputsArtifact = handle(recordedPolicyInputsBytes,"record-policy-inputs",{parents:[resultArtifact.artifactId],transformation:sha256Digest("verification-policy-inputs:proof.v1")});
  await register(recordedPolicyInputsArtifact,recordedPolicyInputsBytes,"verification_policy_inputs","ledger");

  const policyReplay = createOfflineVerificationPolicyReplayPort();
  const policyResult = await policyReplay.replay({tenantId,policyVersion:policyDefinition.policyVersion,policyArtifact,policyBytes,
    recordedPolicyInputsArtifact,recordedPolicyInputsBytes,recordedPolicyInputs,verificationBundle,deterministicResult});
  if(policyResult.outcome!=="pass")throw new Error(`POLICY_FIXTURE_FAILED:${policyResult.outcome}`);
  const policyDecision = policyResult.decision;
  const decisionBytes = encode(policyDecision);
  const decisionArtifact = handle(decisionBytes,"replay-policy",{ parents:[resultArtifact.artifactId,policyArtifact.artifactId,recordedPolicyInputsArtifact.artifactId],transformation:sha256Digest("policy-replay:proof.v1") });
  await register(decisionArtifact,decisionBytes,"verification_policy_decision","accepted");
  let manifest: VerificationRunManifest = {
    verificationContractVersion:"verification.v1",manifestId:id("manifest-contract"),runId,versions:{policy:policyDefinition.policyVersion,schema:"verification.v1",normalizer:"RFC8785.v1"},
    code:{gitSha:"local-proof",dirty:true},runtime:{platform:"local-supabase",deploymentId:"proof-verifier"},
    provider:{endpointIdentity:"local-deterministic",model:"none",nativeConfiguration:{inputTokens:0,outputTokens:0,tokenUsage:0},pricingSnapshotArtifactId:policyArtifact.artifactId},
    inputArtifacts:[sourceArtifact,projectionArtifact,policyArtifact,bundleArtifact,recordedPolicyInputsArtifact],outputArtifacts:[resultArtifact,decisionArtifact],
    stages:[{name:"deterministic",status:"succeeded",startedAt:createdAt,endedAt:createdAt},{name:"policy",status:"succeeded",startedAt:createdAt,endedAt:createdAt}],calls:[],
    randomSeed:0,toolPolicy:[],networkPolicy:"disabled",deterministicResult,judgments:[],policyOutcome:"pass",resultDigest:resultArtifact.digest,
    lineage:[
      {edgeId:id("manifest-projection-source"),fromArtifactId:projectionArtifact.artifactId,toArtifactId:sourceArtifact.artifactId,relation:"derived_from",activityId:"canonicalize-json",activityVersion:"proof.v1"},
      {edgeId:id("manifest-bundle-projection"),fromArtifactId:bundleArtifact.artifactId,toArtifactId:projectionArtifact.artifactId,relation:"generated",activityId:"assemble-verification-bundle",activityVersion:"proof.v1"},
      {edgeId:id("manifest-bundle-policy"),fromArtifactId:bundleArtifact.artifactId,toArtifactId:policyArtifact.artifactId,relation:"generated",activityId:"assemble-verification-bundle",activityVersion:"proof.v1"},
      {edgeId:id("manifest-result-bundle"),fromArtifactId:resultArtifact.artifactId,toArtifactId:bundleArtifact.artifactId,relation:"generated",activityId:"verify-deterministically",activityVersion:"proof.v1"},
      {edgeId:id("manifest-policy-inputs-result"),fromArtifactId:recordedPolicyInputsArtifact.artifactId,toArtifactId:resultArtifact.artifactId,relation:"generated",activityId:"record-policy-inputs",activityVersion:"proof.v1"},
      {edgeId:id("manifest-decision-result"),fromArtifactId:decisionArtifact.artifactId,toArtifactId:resultArtifact.artifactId,relation:"generated",activityId:"replay-policy",activityVersion:"proof.v1"},
      {edgeId:id("manifest-decision-policy"),fromArtifactId:decisionArtifact.artifactId,toArtifactId:policyArtifact.artifactId,relation:"generated",activityId:"replay-policy",activityVersion:"proof.v1"},
      {edgeId:id("manifest-decision-policy-inputs"),fromArtifactId:decisionArtifact.artifactId,toArtifactId:recordedPolicyInputsArtifact.artifactId,relation:"generated",activityId:"replay-policy",activityVersion:"proof.v1"},
    ],
    canonicalization:{algorithm:"RFC8785",implementationVersion:"knowledge-verification.v1",manifestDigest:sha256Digest("")},startedAt:createdAt,completedAt:createdAt,
  };
  manifest = {...manifest,canonicalization:{...manifest.canonicalization,manifestDigest:verificationManifestDigest(manifest)}};
  const auditBundle = await sealAuditBundle({tenantId,verificationBundle,manifest,policyBinding:{policyVersion:policyDefinition.policyVersion,policyArtifact,recordedPolicyInputsArtifact},recordedPolicyInputsBytes,policyDecision});
  const auditBytes = encode(auditBundle);
  const manifestArtifact = handle(auditBytes,"seal-audit-bundle",{parents:[bundleArtifact.artifactId,resultArtifact.artifactId,policyArtifact.artifactId,recordedPolicyInputsArtifact.artifactId],transformation:sha256Digest("audit-seal:proof.v1")});
  await register(manifestArtifact,auditBytes,"verification_run_manifest","ledger");
  checks.detached_digests_distinct = manifestArtifact.digest !== auditBundle.manifest.canonicalization.manifestDigest && manifestArtifact.digest !== auditBundle.seal.payloadDigest;

  await repository.recordCapture({tenantId,source:verificationBundle.sources[0]!,capture:verificationBundle.captures[0]!,producerAttemptId});
  const evidenceResult = deterministicResult.assertions[0]!.evidence[0]!;
  await repository.recordResolvedLocator({tenantId,locatorId,captureId,mediaType:"application/json",selector:assertion.evidence[0]!.fragment.selector,
    resolution:evidenceResult.resolution,selectedBytes,producerAttemptId});
  await repository.recordAssertion({tenantId,assertion,producerAttemptId});
  await repository.recordVerificationRun({tenantId,runId,producerAttemptId,verifierAttemptId,policyVersion:policyDefinition.policyVersion,bundleArtifact,resultArtifact,policyArtifact,manifestArtifact,
    startedAt:createdAt,endedAt:createdAt,status:"succeeded",missionId,workItemId});
  const mismatchedRunId=id("mismatched-inner-run");
  await repository.recordVerificationRun({tenantId,runId:mismatchedRunId,producerAttemptId,verifierAttemptId,policyVersion:policyDefinition.policyVersion,bundleArtifact,resultArtifact,policyArtifact,manifestArtifact,
    startedAt:createdAt,status:"running",missionId,workItemId});
  await expectFailure("audit_requested_run_binding",()=>repository.loadAuditBundle(tenantId,mismatchedRunId),/AUDIT_BUNDLE_REQUEST_BINDING_MISMATCH/);
  const judgment: Judgment = {judgmentId:id("judgment"),assertionId:claimId,evidenceId:assertion.evidence[0]!.evidenceId,judgeKind:"deterministic",graderVersion:"proof.v1",
    outputSchemaDigest:sha256Digest("judgment-schema:proof.v1"),blindedInputArtifactDigest:bundleArtifact.digest,verdict:"directly_supported",
    properties:{evidenceSupport:{status:"satisfied",rationale:"Exact source-bound pointer replayed."},worldCorrectness:{status:"not_assessed",rationale:"No external-world judgment was performed."},
      attributionFaithfulness:{status:"satisfied",rationale:"The selected bytes match the assertion."},sourceAuthority:{status:"satisfied",rationale:"The fixture is the primary source."},provenanceIntegrity:{status:"satisfied",rationale:"Registered hashes and lineage replayed."}},
    supportingFragmentIds:[assertion.evidence[0]!.fragment.fragmentId],contradictingFragmentIds:[],unsupportedFacets:[],publicRationale:"Exact source-bound pointer replayed.",
    latencyMs:0,tokenUsage:0,costMicros:0,retries:0,observedAt:createdAt};
  await repository.appendJudgment({tenantId,runId,claimId,judgment,replaySignatureMatch:true});
  const modelJudgment: Judgment={...judgment,judgmentId:id("model-judgment"),judgeKind:"llm",graderVersion:"proof-model.v1",publicRationale:"A model judgment recorded without a replay receipt.",
    properties:{...judgment.properties,worldCorrectness:{status:"unknown",rationale:"Model judgment is not a deterministic replay receipt."}}};
  await repository.appendJudgment({tenantId,runId,claimId,judgment:modelJudgment});
  checks.model_judgment_replay_unknown = await database.transaction(tenantId,async(client)=>(await client.query<{replay_signature_match:boolean|null}>(
    "select replay_signature_match from evidence.verification_finding where tenant_id=$1 and judgment_id=$2",[tenantId,modelJudgment.judgmentId])).rows[0]!.replay_signature_match===null);

  const loadedAudit = await repository.loadAuditBundle(tenantId,runId);
  const replay = await replayAuditBundle(loadedAudit,{artifactResolver:repository.createTrustedArtifactResolver(),runtimePrincipals,policyReplay});
  checks.storage_roundtrip = replay.deterministicResultDigest===resultArtifact.digest && replay.policyDecisionDigest===decisionArtifact.digest
    && replay.policyDecisionDigest===digestCanonicalJson(policyDecision);
  const storedResolver = repository.createTrustedArtifactResolver();
  const tamperedPolicyInputs = recordedPolicyInputsBytes.slice();
  tamperedPolicyInputs[tamperedPolicyInputs.length-2] = tamperedPolicyInputs[tamperedPolicyInputs.length-2]! ^ 1;
  await expectFailure("recorded_policy_inputs_tamper_rejected",()=>replayAuditBundle(loadedAudit,{runtimePrincipals,policyReplay,artifactResolver:{
    authorizeArtifact:(input)=>storedResolver.authorizeArtifact(input),
    hydrateRegisteredArtifact:async(input)=>{const hydrated=await storedResolver.hydrateRegisteredArtifact(input);return input.artifactId===recordedPolicyInputsArtifact.artifactId?{...hydrated,bytes:tamperedPolicyInputs}:hydrated;},
  }}),/ARTIFACT_DIGEST_MISMATCH/);

  const originalSource = await store.get(tenantId,sourceArtifact.digest as `sha256:${string}`);
  await expectFailure("registration_collision_no_overwrite",()=>repository.registerArtifact({handle:sourceArtifact,bytes:sourceBytes,artifactType:"verification_policy",bucketClass:"ledger",storageBucket:bucket,producerAttemptId,missionId}),/ARTIFACT_REGISTRATION_COLLISION/);
  const sourceAfterCollision = await store.get(tenantId,sourceArtifact.digest as `sha256:${string}`);
  checks.collision_bytes_unchanged = !!originalSource && !!sourceAfterCollision && sha256Digest(originalSource)===sha256Digest(sourceAfterCollision);

  const partialBytes = encode({partialWriteRecovery:proofNamespace});
  const partialArtifact = handle(partialBytes,"partial-write-proof");
  const failingStore: ArtifactStore = {async put(){throw new Error("INJECTED_OBJECT_WRITE_FAILURE");},async get(){return undefined;}};
  const failingRepository = new PostgresVerificationRepository(database,failingStore,{async authorize(){}});
  await expectFailure("partial_write_marks_failed",()=>failingRepository.registerArtifact({handle:partialArtifact,bytes:partialBytes,artifactType:"verification_policy_decision",bucketClass:"candidate",storageBucket:bucket,producerAttemptId,missionId}),/INJECTED_OBJECT_WRITE_FAILURE/);
  const failedState = await database.transaction(tenantId,async(client)=>(await client.query<{storage_state:string}>("select storage_state from orchestration.artifact where tenant_id=$1 and id=$2",[tenantId,partialArtifact.artifactId])).rows[0]!.storage_state);
  if(failedState!=="failed")throw new Error("PARTIAL_WRITE_NOT_MARKED_FAILED");
  await repository.registerArtifact({handle:partialArtifact,bytes:partialBytes,artifactType:"verification_policy_decision",bucketClass:"candidate",storageBucket:bucket,producerAttemptId,missionId});
  checks.partial_write_recovered = await database.transaction(tenantId,async(client)=>(await client.query<{storage_state:string}>("select storage_state from orchestration.artifact where tenant_id=$1 and id=$2",[tenantId,partialArtifact.artifactId])).rows[0]!.storage_state)==="available";

  const unauthorized = repository.createTrustedArtifactResolver();
  await expectFailure("authorize_before_cross_tenant_hydration",()=>unauthorized.authorizeArtifact({tenantId:otherTenantId,artifactId:sourceArtifact.artifactId,purpose:"verification_replay"}),/ARTIFACT_ACCESS_DENIED/);
  await expectFailure("no_ticket_hydration",()=>unauthorized.hydrateRegisteredArtifact({tenantId,artifactId:sourceArtifact.artifactId}),/ARTIFACT_HYDRATION_NOT_AUTHORIZED/);

  await expectFailure("capture_collision_full_identity",()=>repository.recordCapture({tenantId,source:verificationBundle.sources[0]!,capture:{...verificationBundle.captures[0]!,captureMethod:"forged"},producerAttemptId}),/CAPTURE_IDENTITY_COLLISION/);
  await expectFailure("symbolic_id_rejected_before_sql",()=>repository.recordCapture({tenantId,source:{...verificationBundle.sources[0]!,sourceId:"symbolic-id"},capture:{...verificationBundle.captures[0]!,sourceId:"symbolic-id"},producerAttemptId}),/PERSISTENCE_CANONICAL_UUID_REQUIRED:source.sourceId/);

  await expectFailure("wrong_cas_path",()=>database.transaction(tenantId,async(client)=>client.query(`insert into orchestration.artifact
    (id,tenant_id,artifact_type,sha256,bucket_class,storage_bucket,object_path,media_type,size_bytes,storage_state,available_at,verification_contract_version)
    values($1,$2,'verification_policy',$3,'ledger',$4,$5,'application/json',1,'pending',null,'verification.v1')`,[id("bad-cas"),tenantId,"0".repeat(64),bucket,`${tenantId}/ff/${"0".repeat(64)}`])),/verification_bucket_cas_path_ck/i);
  await expectFailure("locator_capture_lineage",()=>database.transaction(tenantId,async(client)=>client.query(`insert into evidence.locator
    (id,tenant_id,verification_contract_version,capture_id,representation_artifact_id,media_type,selector,selector_sha256,selected_content_sha256,
     selected_size_bytes,occurrence_count,resolution_state,normalization_policy,resolution_version,extractor_name,extractor_version,extraction_params)
    values($1,$2,'verification.v1',$3,$4,'application/json','{}',$5,$6,1,1,'resolved','none','proof','proof','proof','{}')`,
    [id("wrong-lineage-locator"),tenantId,captureId,policyArtifact.artifactId,"0".repeat(64),"0".repeat(64)])),/representation is not bound to capture|locator/i);
  await expectFailure("locator_required_fields_not_null",()=>database.transaction(tenantId,async(client)=>client.query(`insert into evidence.locator
    (id,tenant_id,verification_contract_version,capture_id,representation_artifact_id,media_type,selector,extractor_name,extractor_version,extraction_params)
    values($1,$2,'verification.v1',$3,$4,'application/json','{}','proof','proof','{}')`,[id("null-locator"),tenantId,captureId,projectionArtifact.artifactId])),/locator_resolution_cardinality_ck|not-null|null value|check constraint/i);
  await expectFailure("run_status_not_null",()=>database.transaction(tenantId,async(client)=>client.query(`insert into evidence.verification_run
    (id,tenant_id,producer_attempt_id,verifier_attempt_id,policy_version,started_at,contract_version,bundle_artifact_id,deterministic_result_artifact_id,
     policy_artifact_id,policy_artifact_sha256,run_manifest_artifact_id,manifest_sha256,status)
    values($1,$2,$3,$4,$5,$6,'verification.v1',$7,$8,$9,$10,$11,$12,null)`,[id("null-status-run"),tenantId,producerAttemptId,verifierAttemptId,policyDefinition.policyVersion,createdAt,
      bundleArtifact.artifactId,resultArtifact.artifactId,policyArtifact.artifactId,policyArtifact.digest.slice(7),manifestArtifact.artifactId,manifestArtifact.digest.slice(7)])),/verification_run_lifecycle_ck|check constraint/i);
  const legacyRunId=id("legacy-run");
  await database.transaction(tenantId,async(client)=>client.query("insert into evidence.verification_run(id,tenant_id,verifier_attempt_id,policy_version,started_at) values($1,$2,$3,'legacy-policy',$4)",[legacyRunId,tenantId,verifierAttemptId,createdAt]));
  await expectFailure("legacy_finalization_identity_immutable",()=>database.transaction(tenantId,async(client)=>client.query("update evidence.verification_run set ended_at=$1,policy_version='forged-policy' where id=$2",[createdAt,legacyRunId])),/only ended_at finalization|terminal status transition|append-only|immutable/i);
  await expectFailure("cross_tenant_capture_fk",()=>database.transaction(otherTenantId,async(client)=>client.query(`insert into evidence.source_capture
    (id,tenant_id,source_id,artifact_id,content_sha256,media_type,captured_at,capture_method,capture_method_version,context,produced_by_attempt_id)
    values($1,$2,$3,$4,$5,'application/json',$6,'proof','proof','{}',$7)`,[id("cross-tenant-capture"),otherTenantId,sourceId,sourceArtifact.artifactId,sourceArtifact.digest.slice(7),createdAt,producerAttemptId])),/same-tenant|source_capture_tenant_(source|artifact|attempt)_fk/i);
  await expectFailure("terminal_time_guard",()=>repository.recordVerificationRun({tenantId,runId:id("bad-time-run"),producerAttemptId,verifierAttemptId,policyVersion:policyDefinition.policyVersion,bundleArtifact,resultArtifact,policyArtifact,manifestArtifact,
    startedAt:createdAt,endedAt:new Date(Date.parse(createdAt)-1_000).toISOString(),status:"failed",missionId,workItemId}),/verification_run_lifecycle_ck|check constraint/i);
  await expectFailure("same_deployment_guard",()=>repository.recordVerificationRun({tenantId,runId:id("same-deployment-run"),producerAttemptId,verifierAttemptId:sameDeploymentAttemptId,policyVersion:policyDefinition.policyVersion,bundleArtifact,resultArtifact,policyArtifact,manifestArtifact,
    startedAt:createdAt,status:"running",missionId,workItemId}),/distinct|restrict|producer and verifier/i);
  await expectFailure("judgment_append_only",()=>database.transaction(tenantId,async(client)=>client.query("update evidence.verification_finding set public_rationale='forged' where tenant_id=$1 and judgment_id=$2",[tenantId,judgment.judgmentId])),/append-only|immutable|mutation/i);

  const evalInputBytes=encode({schemaVersion:"verification-persistence-case-input.v1",namespace:proofNamespace,input:{value:1}});
  const evalInputArtifact=handle(evalInputBytes,"freeze-eval-input");
  await register(evalInputArtifact,evalInputBytes,"evaluation_case_input","ledger");
  const evalExpectationBytes=encode({schemaVersion:"verification-persistence-engineering-expectation.v1",namespace:proofNamespace,expected:{value:1},humanGold:false});
  const evalExpectationArtifact=handle(evalExpectationBytes,"freeze-eval-expectation");
  await register(evalExpectationArtifact,evalExpectationBytes,"evaluation_case_input","ledger");
  const evalManifestBytes = encode({dataset:"verification-proof",caseCount:1,namespace:proofNamespace,inputArtifactId:evalInputArtifact.artifactId,engineeringExpectationArtifactId:evalExpectationArtifact.artifactId});
  const evalManifestArtifact = handle(evalManifestBytes,"freeze-eval-dataset");
  await register(evalManifestArtifact,evalManifestBytes,"evaluation_dataset_manifest","ledger");
  const datasetId=id("eval-dataset"),datasetVersionId=id("eval-dataset-version"),evalCaseId=id("eval-case"),evalRunId=id("eval-run"),evalScoreId=id("eval-score");
  await database.transaction(tenantId,async(client)=>{
    await client.query("insert into evaluation.eval_dataset(id,tenant_id,slug,purpose) values($1,$2,$3,'verification persistence proof')",[datasetId,tenantId,proofNamespace]);
    await client.query(`insert into evaluation.eval_dataset_version
      (id,tenant_id,dataset_id,version,manifest_sha256,manifest,contract_version,manifest_artifact_id,frozen_at,label_provenance,case_count)
      values($1,$2,$3,1,$4,$5::jsonb,'verification.v1',$6,$7,'synthetic',1)`,[datasetVersionId,tenantId,datasetId,evalManifestArtifact.digest.slice(7),JSON.stringify({artifactId:evalManifestArtifact.artifactId}),evalManifestArtifact.artifactId,createdAt]);
    await client.query(`insert into evaluation.eval_case
      (id,tenant_id,dataset_id,external_key,input,expected,metadata,dataset_version_id,verification_contract_version,input_manifest_artifact_id,gold_artifact_id,case_sha256)
      values($1,$2,$3,'case-1','{}','{}','{}',$4,'verification.v1',$5,$6,$7)`,[evalCaseId,tenantId,datasetId,datasetVersionId,evalInputArtifact.artifactId,evalExpectationArtifact.artifactId,digestCanonicalJson({input:evalInputArtifact.digest,expected:evalExpectationArtifact.digest}).slice(7)]);
    await client.query("insert into evaluation.eval_run(id,tenant_id,dataset_id,target_code_ref,config,code_ref) values($1,$2,$3,'proof','{}','proof')",[evalRunId,tenantId,datasetId]);
    await client.query(`insert into evaluation.eval_score(id,tenant_id,run_id,case_id,metrics,passed,verification_contract_version,result_artifact_id,result_sha256)
      values($1,$2,$3,$4,'{}',true,'verification.v1',$5,$6)`,[evalScoreId,tenantId,evalRunId,evalCaseId,resultArtifact.artifactId,resultArtifact.digest.slice(7)]);
  });
  await expectFailure("dataset_freeze_update",()=>database.transaction(tenantId,async(client)=>client.query("update evaluation.eval_dataset_version set case_count=2 where tenant_id=$1 and id=$2",[tenantId,datasetVersionId])),/immutable|mutation|append-only/i);
  await expectFailure("dataset_freeze_delete",()=>database.transaction(tenantId,async(client)=>client.query("delete from evaluation.eval_dataset_version where tenant_id=$1 and id=$2",[tenantId,datasetVersionId])),/immutable|mutation|append-only/i);

  const rls = await database.transaction(tenantId,async(client)=>{
    await client.query("set local role control_plane");
    const own = Number((await client.query<{count:string}>("select count(*) from evaluation.eval_score where id=$1",[evalScoreId])).rows[0]!.count);
    await client.query("select set_config('app.tenant_id',$1,true)",[otherTenantId]);
    const foreign = Number((await client.query<{count:string}>("select count(*) from evaluation.eval_score where id=$1",[evalScoreId])).rows[0]!.count);
    return {own,foreign};
  });
  checks.eval_score_rls = rls.own===1&&rls.foreign===0;
  const storageRls = await database.transaction(tenantId,async(client)=>{
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({tenant_id:tenantId,role:"authenticated"})]);
    const own=Number((await client.query<{count:string}>("select count(*) from storage.objects where bucket_id=$1 and name=$2",[bucket,sourceArtifact.objectKey])).rows[0]!.count);
    await client.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({tenant_id:otherTenantId,role:"authenticated"})]);
    const foreign=Number((await client.query<{count:string}>("select count(*) from storage.objects where bucket_id=$1 and name=$2",[bucket,sourceArtifact.objectKey])).rows[0]!.count);
    return{own,foreign};
  });
  checks.storage_rls = storageRls.own===1&&storageRls.foreign===0;

  const proof = {projectId:"wkythqbofmckbuoothhn",scope:"Remote synthetic persistence/Storage/replay; no provider dispatch",proofVersion:"verification-persistence-proof.v1",proofNamespace,tenantId,otherTenantId,runId,
    artifactIds:{source:sourceArtifact.artifactId,projection:projectionArtifact.artifactId,policy:policyArtifact.artifactId,bundle:bundleArtifact.artifactId,result:resultArtifact.artifactId,decision:decisionArtifact.artifactId,manifest:manifestArtifact.artifactId,partialRecovery:partialArtifact.artifactId,evalManifest:evalManifestArtifact.artifactId},
    digests:{source:sourceArtifact.digest,projection:projectionArtifact.digest,bundle:bundleArtifact.digest,result:resultArtifact.digest,policy:policyArtifact.digest,policyDecision:decisionArtifact.digest,
      storedManifestArtifact:manifestArtifact.digest,signableManifest:auditBundle.manifest.canonicalization.manifestDigest,sealPayload:auditBundle.seal.payloadDigest},checks};
  if(Object.values(checks).some((passed)=>!passed))throw new Error(`PROOF_CHECK_FAILED:${JSON.stringify(checks)}`);
  await mkdir("catalog/verification-proofs",{recursive:true});
  const outputPath=`catalog/verification-proofs/${proofNamespace}.json`;
  await writeFile(outputPath,`${canonicalizeJson(proof)}\n`,{encoding:"utf8",flag:"wx"});
  console.log(JSON.stringify({ok:true,outputPath,proof},null,2));
} finally {
  await database.close();
}
