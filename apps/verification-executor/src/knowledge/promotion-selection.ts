import { z } from "zod";
import { createHash } from "node:crypto";
import type { ArtifactLedger } from "@aiengineer/knowledge-db-read";
import { canonicalJson, sha256Digest } from "@aiengineer/knowledge-domain";
import { JsonValueSchema } from "@aiengineer/knowledge-contracts";
import { authenticateCanonicalContentEvidence, ContentSourceReader, readContentLinkReceipt } from "@aiengineer/knowledge-ingestion";
import type { PromotionSelectionPorts } from "@aiengineer/knowledge-persistence";
import type { ArtifactStore } from "@aiengineer/knowledge-runtime";
import type { CanonicalEvidenceClaim, CanonicalEvidenceReader } from "../evidence-reader.js";

interface SelectionHostConfig {
  readonly tenantId: string;
  readonly policyDigest: string;
  readonly artifacts: ArtifactLedger;
  readonly artifactStores: Readonly<Record<string, ArtifactStore>>;
  readonly evidence: CanonicalEvidenceReader;
  readonly measure: PromotionSelectionPorts["measure"];
}
const Pins = z.object({ tenantId: z.uuid(), policyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
function deny(code: string): never { throw new Error(code); }

/** Binds selected promotion to the existing canonical claim, source and receipt authenticators. */
export function createPromotionSelectionPorts(config: SelectionHostConfig): PromotionSelectionPorts {
  const pins = Pins.parse(config);
  function authorize(tenantId: string) {
    if (tenantId !== pins.tenantId) deny("PROMOTION_SELECTION_HOST_TENANT_MISMATCH");
  }
  return {
    async readArtifact(client, input) {
      authorize(input.tenantId);
      const row = (await client.query<{ sha256: string; storage_bucket: string; size_bytes: string | number; storage_state: string }>(
        "select sha256,storage_bucket,size_bytes,storage_state from orchestration.artifact where tenant_id=$1 and id=$2",
        [pins.tenantId, input.artifact.id])).rows[0];
      const size = Number(row?.size_bytes);
      if (!row || row.storage_state !== "available" || `sha256:${row.sha256}` !== input.artifact.digest
        || !Number.isSafeInteger(size) || size < 0 || size > MAX_ARTIFACT_BYTES) deny("PROMOTION_SELECTION_ARTIFACT_UNAVAILABLE");
      const store = config.artifactStores[row.storage_bucket];
      if (!store) deny("PROMOTION_SELECTION_ARTIFACT_BUCKET_DENIED");
      const bytes = await store.get(pins.tenantId, `sha256:${row.sha256}`);
      if (!bytes || bytes.byteLength !== size || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== input.artifact.digest) deny("PROMOTION_SELECTION_ARTIFACT_BYTES_MISMATCH");
      return bytes;
    },
    async reconcileContentLinkReceipt(client, input) {
      authorize(input.tenantId);
      return readContentLinkReceipt({ client, tenantId: pins.tenantId, artifacts: config.artifacts }, input.receiptId);
    },
    async authenticateClaim(client, input) {
      authorize(input.tenantId);
      if (input.policyDigest !== pins.policyDigest) deny("PROMOTION_SELECTION_HOST_POLICY_MISMATCH");
      const first = input.references[0];
      if (!first || input.references.some(reference => reference.claimId !== first.claimId
        || reference.runId !== input.binding.runId || reference.claimKey !== input.binding.claimId
        || reference.claimDigest !== input.binding.claimDigest)) deny("PROMOTION_SELECTION_CLAIM_REFERENCE_MISMATCH");
      const loaded = new Map<string, Promise<CanonicalEvidenceClaim>>();
      for (const reference of input.references) {
        await authenticateCanonicalContentEvidence({ client, tenantId: pins.tenantId, policyDigest: pins.policyDigest, reference,
          loadClaim(claim) {
            let pending = loaded.get(claim.manifestDigest);
            if (!pending) {
              pending = config.evidence.loadClaim({ tenantId: pins.tenantId, policyDigest: pins.policyDigest,
                claimId: first.claimId, ...claim });
              loaded.set(claim.manifestDigest, pending);
            }
            return pending;
          },
        });
      }
      if (loaded.size !== 1) deny("PROMOTION_SELECTION_CLAIM_MANIFEST_MISMATCH");
      const sealed = await loaded.values().next().value!;
      if (!sealed.claim.provenance) deny("PROMOTION_SELECTION_CLAIM_ADMISSION_MISSING");
      const admissionDigest = sha256Digest(canonicalJson(JsonValueSchema.parse(sealed.claim.provenance)));
      if (admissionDigest !== input.binding.admissionDigest || sealed.assertionDigest !== input.binding.claimDigest) deny("PROMOTION_SELECTION_CLAIM_ADMISSION_MISMATCH");
      return { canonicalClaimId: first.claimId, runId: input.binding.runId, claimDigest: sealed.assertionDigest,
        admissionDigest, statement: sealed.claim.statement, qualifiers: sealed.claim.qualifiers };
    },
    async authenticateSource(client, input) {
      authorize(input.tenantId);
      const source = await new ContentSourceReader({ client, tenantId: pins.tenantId, artifacts: config.artifacts }).chunk(input.reference);
      const row = (await client.query<{ source_id: string }>("select source_id from evidence.source_capture where tenant_id=$1 and id=$2",
        [pins.tenantId, input.reference.captureId])).rows[0];
      if (!row || input.reference.captureId !== input.source.captureId) deny("PROMOTION_SELECTION_SOURCE_CAPTURE_MISMATCH");
      return { text: source.text, sourceFamilyId: row.source_id };
    },
    async authenticateNode(client, input) {
      authorize(input.tenantId);
      return new ContentSourceReader({ client, tenantId: pins.tenantId, artifacts: config.artifacts }).node(input.reference);
    },
    measure: config.measure,
  };
}
