import { describe, expect, it } from "vitest";
import { ExploratoryPublicationCoordinator, InMemoryPublicationRepository, type PublicationInspection, type PublicationInspector, type PublicationManifests, type PublishExploratoryRequest } from "./publication.js";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const manifests: PublicationManifests = {
  source: digest("1"), representation: digest("2"), chunkSet: digest("3"), projection: digest("4"), vectorItem: digest("5"),
  embedding: digest("6"), index: digest("7"), retrievalPolicy: digest("8"), evaluation: digest("9"),
};

class MutableInspector implements PublicationInspector {
  readonly inspections = new Map<string, PublicationInspection>();
  async inspect(vectorSpaceVersionId: string) {
    const inspection = this.inspections.get(vectorSpaceVersionId);
    if (!inspection) throw new Error("missing version");
    return inspection;
  }
}

function inspection(vectorSpaceVersionId: string, overrides: Partial<PublicationInspection> = {}): PublicationInspection {
  return { vectorSpaceVersionId, itemCount: 2, dimensions: 1_536, precision: "halfvec", manifests, indexReady: true, authorizationPassed: true, evaluationPassed: true, sampleSearchPassed: true, ...overrides };
}

function request(version: string, publicationId: string, eventId: string): PublishExploratoryRequest {
  return {
    publicationId, eventId, receiptId: `receipt-${publicationId}`, tenantId: "tenant-1", vectorStoreId: "store-1", vectorStoreSpaceId: "space-1",
    vectorSpaceVersionId: version, storeClass: "internal_exploratory", expectedItemCount: 2, manifests,
    promotionDecisionId: `decision-${publicationId}`, evaluationGateResultId: `gate-${publicationId}`, reason: "verified evaluation promotion",
  };
}

describe("ExploratoryPublicationCoordinator", () => {
  it("verifies and atomically advances a versioned publication pointer", async () => {
    const repository = new InMemoryPublicationRepository();
    const inspector = new MutableInspector();
    inspector.inspections.set("v1", inspection("v1"));
    const coordinator = new ExploratoryPublicationCoordinator(repository, inspector, () => new Date("2026-09-03T12:00:00Z"));
    const published = await coordinator.publish(request("v1", "publication-1", "event-1"));
    expect(published).toMatchObject({ vectorSpaceVersionId: "v1", state: "published", dimensions: 1_536 });
    expect(await repository.getActivePointer("tenant-1", "space-1")).toMatchObject({ publicationId: "publication-1", revision: 1 });
    expect(await coordinator.publish(request("v1", "publication-1", "event-duplicate"))).toBe(published);
    expect((await repository.listEvents("tenant-1", "space-1"))).toHaveLength(1);
    await expect(coordinator.publish({ ...request("v1", "publication-1", "event-conflict"), vectorStoreSpaceId: "space-2" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("leaves no partial state when verification fails", async () => {
    const repository = new InMemoryPublicationRepository();
    const inspector = new MutableInspector();
    inspector.inspections.set("bad", inspection("bad", { itemCount: 1, sampleSearchPassed: false }));
    const coordinator = new ExploratoryPublicationCoordinator(repository, inspector);
    await expect(coordinator.publish(request("bad", "publication-bad", "event-bad"))).rejects.toMatchObject({ code: "PUBLICATION_VERIFICATION_FAILED" });
    expect(await repository.getActivePointer("tenant-1", "space-1")).toBeUndefined();
    expect(await repository.getPublication("tenant-1", "publication-bad")).toBeUndefined();
  });

  it("rolls back by pointer switch without deleting versions and emits a reason-bearing event", async () => {
    const repository = new InMemoryPublicationRepository();
    const inspector = new MutableInspector();
    inspector.inspections.set("v1", inspection("v1"));
    inspector.inspections.set("v2", inspection("v2"));
    const timestamps = [new Date("2026-09-03T12:00:00Z"), new Date("2026-09-03T12:01:00Z"), new Date("2026-09-03T12:02:00Z")];
    const coordinator = new ExploratoryPublicationCoordinator(repository, inspector, () => timestamps.shift()!);
    await coordinator.publish(request("v1", "publication-1", "event-1"));
    const second = await coordinator.publish(request("v2", "publication-2", "event-2"));
    expect(second.predecessorId).toBe("publication-1");
    const pointer = await coordinator.rollback({ eventId: "event-3", receiptId: "rollback-receipt", tenantId: "tenant-1", vectorStoreSpaceId: "space-1", targetPublicationId: "publication-1", reason: "recall regression" });
    expect(pointer).toMatchObject({ publicationId: "publication-1", vectorSpaceVersionId: "v1", revision: 3 });
    expect(await repository.getPublication("tenant-1", "publication-2")).toBe(second);
    expect((await repository.listEvents("tenant-1", "space-1")).at(-1)).toMatchObject({ kind: "publication.rolled_back", reason: "recall regression" });
  });

  it("reconciles counts, manifests, format, index, authorization, evaluation, and sample search", async () => {
    const repository = new InMemoryPublicationRepository();
    const inspector = new MutableInspector();
    inspector.inspections.set("v1", inspection("v1"));
    const coordinator = new ExploratoryPublicationCoordinator(repository, inspector);
    await coordinator.publish(request("v1", "publication-1", "event-1"));
    expect(await coordinator.reconcile("tenant-1", "space-1")).toMatchObject({ healthy: true, findings: [] });
    inspector.inspections.set("v1", inspection("v1", { itemCount: 1, authorizationPassed: false, indexReady: false }));
    const report = await coordinator.reconcile("tenant-1", "space-1");
    expect(report.healthy).toBe(false);
    expect(report.findings.map(({ code }) => code)).toEqual(expect.arrayContaining(["COUNT_MISMATCH", "INDEX_NOT_READY", "AUTHORIZATION_CHECK_FAILED"]));
  });
});
