import { generateKeyPairSync, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVerificationOwnershipResolver,
  isVerifiedEveRuntimeRetry,
} from "../verification-ownership.js";
import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import {
  createEveRuntimeAttestation,
  deterministicUuid,
} from "@aiengineer/knowledge-runtime";
import { sha256Digest } from "@aiengineer/knowledge-domain";

const resolveEveBinding = vi.hoisted(() => vi.fn());
vi.mock("@aiengineer/knowledge-persistence", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@aiengineer/knowledge-persistence")
  >()),
  resolveEveVerificationBinding: resolveEveBinding,
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = {
  kind: "service" as const,
  id: id(1),
  serviceIdentity: "mission_control_client" as const,
};
const grant = {
  tenantId: id(2),
  actor,
  missionId: id(3),
  agentDeploymentId: "worker.v1",
  capabilityVersion: "verification-service.v1",
};
const body = {
  verificationContractVersion: "verification.v1" as const,
  captureIds: ["capture-1"],
  assertions: {
    artifactId: id(9),
    digest: `sha256:${"a".repeat(64)}` as const,
  },
};
const idempotencyKey = "eve-host-key-001",
  operationId = deterministicUuid(
    "verification-http-operation",
    `${grant.tenantId}:verifyClaims:${idempotencyKey}`,
  );
const externalA = {
  runtime: "eve" as const,
  runId: "session-a:turn-a",
  rootRunId: "root",
  sessionId: "session-a",
  turnId: "turn-a",
  toolCallId: "call-a",
};
const externalB = {
  runtime: "eve" as const,
  runId: "session-b:turn-b",
  rootRunId: "root",
  sessionId: "session-b",
  turnId: "turn-b",
  toolCallId: "call-b",
};
const authority = { grantId: "eve-grant", issuer: "eve.host", keyIds: ["k1"] };
const keyA = generateKeyPairSync("ed25519"),
  keyB = generateKeyPairSync("ed25519");
const privateA = keyA.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  publicA = keyA.publicKey.export({ type: "spki", format: "pem" }).toString(),
  privateB = keyB.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  publicB = keyB.publicKey.export({ type: "spki", format: "pem" }).toString();
const eveGrant = { ...grant, eveRuntimeAuthority: authority };
const database = () => {
  const transaction = vi.fn(
    async (
      _tenant: string,
      callback: (client: { query: ReturnType<typeof vi.fn> }) => unknown,
    ) => callback({ query: vi.fn(async () => ({ rows: [{ id: id(5) }] })) }),
  );
  return { transaction } as unknown as PostgresCanonicalRepository;
};
const keyCatalog = (publicKeyPem: string) => ({
  eveRuntimeAttestationKeysJson: JSON.stringify([
    { issuer: "eve.host", keyId: "k1", publicKeyPem },
  ]),
});
async function signedRequest(
  options: Partial<{
    payload: Record<string, unknown>;
    external: typeof externalA;
    privateKey: string;
    correlationId: string;
    causationId: string;
    idempotency: string;
  }> = {},
) {
  const external = options.external ?? externalA,
    idempotency = options.idempotency ?? idempotencyKey;
  const unsigned = {
    schemaVersion: "eve-runtime-attestation.v1",
    issuer: "eve.host",
    keyId: "k1",
    jti: randomUUID(),
    issuedAt: Math.floor(Date.now() / 1000) - 1,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    audience: "knowledge-services:verification",
    grantId: authority.grantId,
    tenantId: grant.tenantId,
    principal: actor,
    missionId: grant.missionId,
    workItemId: id(4),
    attemptId: id(5),
    operationId,
    agentDeploymentId: grant.agentDeploymentId,
    capabilityVersion: grant.capabilityVersion,
    useCase: "verifyClaims",
    requestDigest: sha256Digest(body),
    idempotencyKey: idempotency,
    externalExecution: external,
    ...options.payload,
  };
  const header = await createEveRuntimeAttestation(
    unsigned as never,
    options.privateKey ?? privateA,
  );
  const headers = {
    "x-eve-runtime-attestation": header,
    "x-external-runtime": external.runtime,
    "x-external-run-id": external.runId,
    "x-external-root-run-id": external.rootRunId,
    "x-external-session-id": external.sessionId,
    "x-external-turn-id": external.turnId,
    "x-external-tool-call-id": external.toolCallId,
  };
  return {
    request: { headers, body },
    tenantId: grant.tenantId,
    identity: { actor },
    correlationId: options.correlationId ?? `eve-verification:${operationId}`,
    idempotencyKey: idempotency,
    useCase: "verifyClaims",
    hints: {
      attemptId: id(5),
      workItemId: id(4),
      missionId: grant.missionId,
      ...(options.causationId ? { causationId: options.causationId } : {}),
      externalExecution: external,
    },
  };
}

describe("verification ownership grant admission", () => {
  beforeEach(() => resolveEveBinding.mockReset());
  it("rejects ambiguous or caller-extended server configuration", () => {
    const database = {} as PostgresCanonicalRepository;
    expect(() =>
      createVerificationOwnershipResolver(
        database,
        JSON.stringify([grant, grant]),
      ),
    ).toThrow("DUPLICATE_VERIFICATION_OWNERSHIP_GRANT");
    expect(() =>
      createVerificationOwnershipResolver(
        database,
        JSON.stringify([{ ...grant, allowAnyAttempt: true }]),
      ),
    ).toThrow();
    expect(() => createVerificationOwnershipResolver(database, "[]")).toThrow();
  });
  it("denies missing routing IDs and ungranted identities before database access", async () => {
    const transaction = vi.fn(),
      resolver = createVerificationOwnershipResolver(
        { transaction } as unknown as PostgresCanonicalRepository,
        JSON.stringify([grant]),
      );
    const input = {
      tenantId: grant.tenantId,
      identity: { actor },
      correlationId: "correlation",
      idempotencyKey: "ownership-001",
      useCase: "verifyExtraction",
      hints: {},
    };
    expect(await resolver(input)).toBeUndefined();
    expect(
      await resolver({
        ...input,
        identity: { actor: { ...actor, id: id(9) } },
        hints: {
          attemptId: id(4),
          workItemId: id(5),
          missionId: grant.missionId,
        },
      }),
    ).toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires a trusted key catalog for an Eve authority grant", () => {
    const database = {} as PostgresCanonicalRepository;
    expect(() =>
      createVerificationOwnershipResolver(
        database,
        JSON.stringify([
          {
            ...grant,
            eveRuntimeAuthority: {
              grantId: "eve-grant",
              issuer: "eve.host",
              keyIds: ["k1"],
            },
          },
        ]),
      ),
    ).toThrow("VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_REQUIRED");
    expect(() =>
      createVerificationOwnershipResolver(
        database,
        JSON.stringify([
          {
            ...grant,
            externalExecution: { runtime: "eve", runId: "fixed" },
            eveRuntimeAuthority: {
              grantId: "eve-grant",
              issuer: "eve.host",
              keyIds: ["k1"],
            },
          },
        ]),
        { eveRuntimeAttestationKeysJson: "[]" },
      ),
    ).toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }),
      rsaPublic = rsa.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
    expect(() =>
      createVerificationOwnershipResolver(
        database,
        JSON.stringify([
          {
            ...grant,
            eveRuntimeAuthority: {
              grantId: "eve-grant",
              issuer: "eve.host",
              keyIds: ["k1"],
            },
          },
        ]),
        {
          eveRuntimeAttestationKeysJson: JSON.stringify([
            { issuer: "eve.host", keyId: "k1", publicKeyPem: rsaPublic },
          ]),
        },
      ),
    ).toThrow("KEY_ALGORITHM");
  });
  it("rejects an attestation signed by a different resolver key catalog before database access", async () => {
    const keyA = generateKeyPairSync("ed25519"),
      keyB = generateKeyPairSync("ed25519");
    const privateA = keyA.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      publicA = keyA.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      publicB = keyB.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
    const authority = {
      grantId: "eve-grant",
      issuer: "eve.host",
      keyIds: ["k1"],
    };
    const eveGrant = { ...grant, eveRuntimeAuthority: authority };
    const body = {
      verificationContractVersion: "verification.v1" as const,
      captureIds: ["capture-1"],
      assertions: {
        artifactId: id(9),
        digest: `sha256:${"a".repeat(64)}` as const,
      },
    };
    const idempotencyKey = "eve-host-key-001",
      operationId = deterministicUuid(
        "verification-http-operation",
        `${grant.tenantId}:verifyClaims:${idempotencyKey}`,
      ),
      external = {
        runtime: "eve" as const,
        runId: "session:turn",
        rootRunId: "root",
        sessionId: "session",
        turnId: "turn",
        toolCallId: "call",
      };
    const header = await createEveRuntimeAttestation(
      {
        schemaVersion: "eve-runtime-attestation.v1",
        issuer: "eve.host",
        keyId: "k1",
        jti: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000) - 1,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        audience: "knowledge-services:verification",
        grantId: authority.grantId,
        tenantId: grant.tenantId,
        principal: actor,
        missionId: grant.missionId,
        workItemId: id(4),
        attemptId: id(5),
        operationId,
        agentDeploymentId: grant.agentDeploymentId,
        capabilityVersion: grant.capabilityVersion,
        useCase: "verifyClaims",
        requestDigest: sha256Digest(body),
        idempotencyKey,
        externalExecution: external,
      },
      privateA,
    );
    const transaction = vi.fn();
    const resolver = createVerificationOwnershipResolver(
      { transaction } as unknown as PostgresCanonicalRepository,
      JSON.stringify([eveGrant]),
      {
        eveRuntimeAttestationKeysJson: JSON.stringify([
          { issuer: "eve.host", keyId: "k1", publicKeyPem: publicB },
        ]),
      },
    );
    const result = await resolver({
      request: { headers: { "x-eve-runtime-attestation": header }, body },
      tenantId: grant.tenantId,
      identity: { actor },
      correlationId: `eve-verification:${operationId}`,
      idempotencyKey,
      useCase: "verifyClaims",
      hints: {
        attemptId: id(5),
        workItemId: id(4),
        missionId: grant.missionId,
        externalExecution: external,
      },
    });
    expect(result).toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
    expect(publicA).not.toBe(publicB);
  });
  it("keeps independent resolver key catalogs isolated and admits only the matching key", async () => {
    const firstDatabase = database(),
      secondDatabase = database();
    const resolverA = createVerificationOwnershipResolver(
      firstDatabase,
      JSON.stringify([eveGrant]),
      keyCatalog(publicA),
    );
    const resolverB = createVerificationOwnershipResolver(
      secondDatabase,
      JSON.stringify([eveGrant]),
      keyCatalog(publicB),
    );
    resolveEveBinding.mockResolvedValue(externalA);
    await expect(
      resolverA(await signedRequest({ privateKey: privateB })),
    ).resolves.toBeUndefined();
    expect(firstDatabase.transaction).not.toHaveBeenCalled();
    await expect(resolverA(await signedRequest())).resolves.toMatchObject({
      operationId,
      externalExecution: externalA,
    });
    expect(firstDatabase.transaction).toHaveBeenCalledTimes(1);
    expect(resolverB).toBeTypeOf("function");
  });
  it("rejects every mutated signed ownership binding before persistence", async () => {
    const resolver = createVerificationOwnershipResolver(
      database(),
      JSON.stringify([eveGrant]),
      keyCatalog(publicA),
    );
    const cases: readonly [
      string,
      Partial<Parameters<typeof signedRequest>[0]>,
    ][] = [
      ["actor", { payload: { principal: { ...actor, id: id(99) } } }],
      [
        "service",
        {
          payload: {
            principal: { ...actor, serviceIdentity: "control_plane" },
          },
        },
      ],
      ["tenant", { payload: { tenantId: id(99) } }],
      ["mission", { payload: { missionId: id(99) } }],
      ["work", { payload: { workItemId: id(99) } }],
      ["attempt", { payload: { attemptId: id(99) } }],
      ["grant", { payload: { grantId: "other" } }],
      ["deployment", { payload: { agentDeploymentId: "other" } }],
      ["capability", { payload: { capabilityVersion: "other" } }],
      ["useCase", { payload: { useCase: "verifyReport" } }],
      ["idempotency", { payload: { idempotencyKey: "eve-host-key-002" } }],
      ["operation", { payload: { operationId: id(99) } }],
      ["digest", { payload: { requestDigest: `sha256:${"b".repeat(64)}` } }],
      [
        "expired",
        {
          payload: {
            issuedAt: Math.floor(Date.now() / 1000) - 120,
            expiresAt: Math.floor(Date.now() / 1000) - 1,
          },
        },
      ],
      ["unknown key", { payload: { keyId: "unknown" } }],
      ["correlation", { correlationId: "eve:dynamic" }],
      ["causation", { causationId: "not-permitted" }],
    ];
    for (const [, mutation] of cases)
      expect(await resolver(await signedRequest(mutation))).toBeUndefined();
    expect(resolveEveBinding).not.toHaveBeenCalled();
  });
  it("binds signed lineage retries to the frozen context only", async () => {
    const store = database(),
      resolver = createVerificationOwnershipResolver(
        store,
        JSON.stringify([eveGrant]),
        keyCatalog(publicA),
      );
    resolveEveBinding.mockResolvedValue(externalA);
    const input = await signedRequest({ external: externalB });
    const context = await resolver(input);
    expect(context).toMatchObject({
      operationId,
      externalExecution: externalA,
    });
    expect(isVerifiedEveRuntimeRetry(input.request, context!)).toBe(true);
    expect(
      isVerifiedEveRuntimeRetry(input.request, {
        ...context!,
        correlationId: "changed",
      }),
    ).toBe(false);
    input.request.headers["x-external-turn-id"] = "replayed";
    expect(isVerifiedEveRuntimeRetry(input.request, context!)).toBe(false);
  });
});
