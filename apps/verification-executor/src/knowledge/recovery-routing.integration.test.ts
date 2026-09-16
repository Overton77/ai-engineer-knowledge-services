import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PostgresCanonicalRepository, PostgresDurableVerificationRecoveryStore } from "@aiengineer/knowledge-persistence";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { FilesystemStore } from "../store.js";
import { createExecutorCustody } from "../store-custody-postgres.js";
import { createDurableRecoveryCustody } from "./recovery-durable-custody.js";
import { RecoverySelectorProbes } from "./recovery-probes.js";
import { recoveryFixture } from "./recovery-test-fixtures.js";

const databaseUrl = disposableDatabaseUrl(), storageConfig = disposableStorageConfig();

describe.skipIf(!databaseUrl || !storageConfig)("automatic recovery against disposable Postgres and Storage", () => {
  it("retains complete originals, deduplicates notifications, and executes durably bounded real selector probes", async () => {
    const tenantId = randomUUID();
    const root = await mkdtemp(join(tmpdir(), "ks-recovery-routing-db-"));
    const database = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const remote = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: storageConfig!.projectUrl, secretKey: storageConfig!.secretKey });
    try {
      const store = new FilesystemStore(root, tenantId); await store.init(); store.attachCustody(remote);
      const custody = createDurableRecoveryCustody(store, remote);
      const fixture = await recoveryFixture({ tenantId, store, custody, persistence: new PostgresDurableVerificationRecoveryStore(database) });
      for (const item of fixture.batch.items) await database.createOperation({ tenantId, id: item.observation.operationId,
        operationKind: "verification.fixture_original", idempotencyKey: `original:${item.originalId}`,
        actorIdentity: "authenticated-recovery-fixture", correlationId: randomUUID(), request: item.binding, steps: [] });
      const first = await fixture.notify();
      const replay = await fixture.notify();
      expect(replay.revision).toBe(first.revision);
      expect(replay).toMatchObject({ questionDenominator: 4, submitted: 4, counts: { failed: 3, passed: 1 }, cohortTriage: true });
      const stored = await fixture.recovery.read(tenantId, first.caseId);
      expect(stored.initialBatch.questionIds).toEqual(fixture.batch.questionIds);
      expect(stored.initialBatch.requirements).toEqual(fixture.batch.requirements);
      expect(stored.batch.items.every(item => item.usedRounds === 0)).toBe(true);
      const probes = new RecoverySelectorProbes({ tenantId, custody, recovery: fixture.recovery, now: () => fixture.authority.now(), representation: fixture.representation });
      const binding = structuredClone(fixture.batch.items[0]!.binding);
      binding.evidence[0]!.selector = { kind: "json_pointer", pointer: "/metric" };
      const request = { caseId: first.caseId, dependencyId: "shared-selector", representatives: [{ originalId: "claim-1", binding }], controlId: "claim-4" };
      const probed = await probes.run(request);
      for (const artifact of probed.receiptArtifacts) expect(await probes.read({ tenantId, artifact })).toMatchObject({ passed: true, calls: 0, costMicros: 0 });
      expect((await probes.run(request)).receiptArtifacts).toEqual(probed.receiptArtifacts);
      const reservationCount = await database.transaction(tenantId, async client => (await client.query<{ count: string }>(
        "select count(*)::text count from knowledge_service.recovery_revision where tenant_id=$1 and case_id=$2 and kind='notification' and idempotency_key like 'selector-probe:%'", [tenantId, first.caseId])).rows[0]!.count);
      expect(reservationCount).toBe("1");
      binding.evidence[0]!.selector = { kind: "json_pointer", pointer: "/replacement" };
      await expect(probes.run(request)).rejects.toThrow("RECOVERY_PROBE_ROUND_ALREADY_RESERVED");
      expect((await fixture.recovery.read(tenantId, first.caseId)).spent).toEqual({ calls: 0, costMicros: 0 });
    } finally {
      await remote.close(); await database.close();
      const absolute = resolve(root);
      if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("TEST_CLEANUP_PATH_DENIED");
      await rm(absolute, { recursive: true, force: true });
    }
  }, 60_000);
});
