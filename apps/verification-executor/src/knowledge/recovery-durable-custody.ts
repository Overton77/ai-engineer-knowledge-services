import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import type { DurableRecoveryCustody } from "@aiengineer/knowledge-application";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { assertSameArtifact, validateStoredArtifact, type ArtifactCustody } from "../store-custody.js";
import type { FilesystemStore } from "../store.js";

const maximumJsonBytes = 16_000_000;

/** Recovery records share the executor's existing logical identity and remote byte custody. */
export function createDurableRecoveryCustody(store: FilesystemStore, custody: ArtifactCustody): DurableRecoveryCustody {
  function requireTenant(tenantId: string): void {
    if (tenantId !== store.tenantId) throw new Error("RECOVERY_CUSTODY_TENANT_DENIED");
  }

  async function read(input: { tenantId: string; artifact: VerificationArtifactHandle }): Promise<unknown> {
    requireTenant(input.tenantId);
    const visited = new Set<string>();
    const active = new Set<string>();
    let totalBytes = 0;
    async function verified(artifactId: string): Promise<Awaited<ReturnType<ArtifactCustody["resolve"]>>> {
      if (active.has(artifactId)) throw new Error("RECOVERY_ARTIFACT_DEPENDENCY_CYCLE");
      if (visited.has(artifactId)) return undefined;
      if (visited.size >= 10_000) throw new Error("RECOVERY_ARTIFACT_DEPENDENCY_LIMIT");
      const value = await custody.resolve(artifactId);
      if (!value) throw new Error("RECOVERY_ARTIFACT_UNAVAILABLE");
      if (value.handle.artifactId !== artifactId) throw new Error("RECOVERY_ARTIFACT_RESOLVER_IDENTITY_MISMATCH");
      validateStoredArtifact(input.tenantId, value.handle, value.bytes);
      totalBytes += value.bytes.byteLength;
      if (totalBytes > 256_000_000) throw new Error("RECOVERY_ARTIFACT_DEPENDENCY_LIMIT");
      visited.add(artifactId);
      active.add(artifactId);
      for (const parent of [...value.handle.parentArtifactIds, ...(value.handle.attestationArtifactId ? [value.handle.attestationArtifactId] : [])]) {
        await verified(parent);
      }
      active.delete(artifactId);
      return value;
    }
    const stored = (await verified(input.artifact.artifactId))!;
    assertSameArtifact(input.artifact, stored.handle);
    if (stored.handle.mediaType !== "application/json" && !stored.handle.mediaType.endsWith("+json")) {
      return stored.bytes;
    }
    if (stored.bytes.byteLength > maximumJsonBytes) throw new Error("RECOVERY_ARTIFACT_TOO_LARGE");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes));
  }

  return {
    read,
    async register(input): Promise<VerificationArtifactHandle> {
      requireTenant(input.tenantId);
      if (!input.identity.trim() || input.identity.length > 512) throw new Error("RECOVERY_ARTIFACT_IDENTITY_INVALID");
      const bytes = new TextEncoder().encode(canonicalizeJson(input.value));
      if (bytes.byteLength > maximumJsonBytes) throw new Error("RECOVERY_ARTIFACT_TOO_LARGE");
      const artifact = await store.put({
        bytes,
        mediaType: `application/vnd.aiengineer.verification-recovery-${input.kind.replaceAll("_", "-")}+json`,
        producerActivityId: `knowledge:verification-recovery:${digestCanonicalJson(input.identity)}`,
        producerVersion: "verification-recovery-durable.v1",
        dataClassification: "internal",
        parentArtifactIds: [...input.parentArtifactIds],
        transformation: { kind: "verification-recovery", recordKind: input.kind, identity: input.identity },
      });
      await read({ tenantId: input.tenantId, artifact });
      return artifact;
    },
  };
}
