import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvidencePacketSchema,
  type RetrievalPlan,
} from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { apiOwnedOperationKinds } from "@aiengineer/knowledge-application";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import {
  PostgresKnowledgeOperationService,
  createRemoteRetrievalArtifactReader,
} from "@aiengineer/knowledge-persistence";
import {
  disposableDatabaseUrl,
  disposableStorageConfig,
} from "../../../../packages/persistence/test/disposable.mjs";
import {
  createSelectedCandidateFixture,
  type SelectedCandidateFixture,
} from "../../../verification-executor/src/knowledge/selected-candidate-fixture.js";
import {
  PUBLICATION_SPACE,
  evaluateCandidate,
  publishCandidate,
} from "../../../verification-executor/src/knowledge/selected-candidate-publication.js";
import { CanonicalRetrievalExecutor } from "../retrieval-executor.js";
import { buildServer } from "../server.js";

const databaseUrl = disposableDatabaseUrl(),
  storage = disposableStorageConfig(),
  token = "consumer-transport-proof-token";
const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
type ScopedOperation = {
  execute(scope: unknown, payload: unknown): Promise<any>;
};
type AdapterFactory = (
  environment: Record<string, string>,
) =>
  | { name: string; execute?: never; input: unknown }[]
  | {
      name: string;
      input: unknown;
      execute(scope: unknown, payload: unknown): Promise<any>;
    }[];
const workspace = resolve(import.meta.dirname, "../../..");
const cli = resolve(workspace, "apps/cli/dist/index.js"),
  mcp = resolve(workspace, "apps/mcp/dist/index.js");
const plan = (policyVersion: string): RetrievalPlan => ({
  policyVersion,
  query: "Synthetic Child and Parent organizations operate together in preview",
  intents: ["knowledge_evidence"],
  subqueries: [{ id: "q", text: "preview", coverageRole: "required" }],
  spaces: [PUBLICATION_SPACE],
  anchors: { entities: [], concepts: [], useCases: [] },
  hardFilters: [{ field: "visibility", op: "eq", value: "internal" }],
  softBoosts: [],
  temporalScope: {},
  candidateK: 20,
  finalK: 5,
  graph: { maxDepth: 0, allowedEdges: [] },
  abstention: { minimumCoverage: 0 },
});
async function policy(fixture: SelectedCandidateFixture) {
  const policyId = randomUUID(),
    version = randomUUID(),
    value = {
      admittedSpaces: [PUBLICATION_SPACE],
      allowedFilterFields: ["visibility"],
      allowedVisibilities: ["internal"],
      maxCandidateK: 100,
      maxFinalK: 20,
      rrfK: 60,
      minimumCoverage: 0,
      providerRoute: ["deterministic-fake"],
      maximumRerankCandidates: 20,
      maxPerSource: 3,
      contextRadius: 0,
    };
  await fixture.db.transaction(
    { tenantId: fixture.tenantId },
    async (client) => {
      await client.query(
        "insert into retrieval.retrieval_policy(id,tenant_id,slug,purpose,lifecycle) values($1,$2,$3,$4,'active')",
        [
          policyId,
          fixture.tenantId,
          `consumer-${fixture.tenantId.slice(0, 8)}`,
          "consumer transport proof",
        ],
      );
      await client.query(
        "insert into retrieval.retrieval_policy_version(id,tenant_id,retrieval_policy_id,version,policy,policy_schema,policy_sha256,status) values($1,$2,$3,1,$4::jsonb,$5::jsonb,$6,'active')",
        [
          version,
          fixture.tenantId,
          policyId,
          JSON.stringify(value),
          JSON.stringify({ schemaVersion: "retrieval-runtime-policy/v1" }),
          sha256Digest(value).slice(7),
        ],
      );
    },
  );
  return version;
}

describe.skipIf(!databaseUrl || !storage)(
  "consumer CLI and MCP transports over a real canonical KS host",
  () => {
    let fixture: SelectedCandidateFixture,
      api: ReturnType<typeof buildServer>,
      mcpApp: any,
      apiOrigin: string,
      mcpOrigin: string,
      policyVersion: string;
    const actor = {
      kind: "service" as const,
      id: randomUUID(),
      serviceIdentity: "mission_control_client" as const,
    };
    beforeAll(async () => {
      const { buildKnowledgeMcpApp } = await import(pathToFileURL(mcp).href);
      fixture = await createSelectedCandidateFixture({
        databaseUrl: databaseUrl!,
        storage: storage!,
        spaces: [PUBLICATION_SPACE],
      });
      const evaluation = await evaluateCandidate(fixture, {
        candidateInput: fixture.candidateInput,
        candidate: fixture.candidate,
      });
      await publishCandidate(fixture, {
        ...evaluation,
        candidateInput: fixture.candidateInput,
        candidate: fixture.candidate,
        steps: 2,
        reason: "consumer transport proof activation",
      });
      policyVersion = await policy(fixture);
      const identity = {
        actor,
        grants: [
          {
            tenantId: fixture.tenantId,
            roles: ["knowledge_operator" as const],
            scopes: [],
          },
        ],
      };
      const reader = createRemoteRetrievalArtifactReader(fixture.database, {
        projectUrl: storage!.projectUrl,
        serviceRoleKey: storage!.secretKey,
        buckets: ["ai-engineer-cloud-bucket"],
      });
      api = buildServer({
        operationService: new PostgresKnowledgeOperationService(
          fixture.database,
          { admittedOperationKinds: [...apiOwnedOperationKinds] },
        ),
        resourceReader: fixture.database,
        getEvidencePacket: async (tenant, id) => {
          const value = await fixture.database.getEvidencePacket(tenant, id);
          return value === undefined
            ? undefined
            : EvidencePacketSchema.parse(value);
        },
        replayEvidencePacketCitations: (tenant, id) =>
          fixture.database.replayEvidencePacketCitations(tenant, id, reader),
        canonicalRetrievalExecutor: new CanonicalRetrievalExecutor(
          fixture.database,
          fixture.embeddingAdapter,
        ),
        publicOrigin: "http://127.0.0.1",
        resolveIdentity: (value) => (value === token ? identity : undefined),
      });
      await api.listen({ host: "127.0.0.1", port: 0 });
      apiOrigin = String(
        api.server.address() &&
          `http://127.0.0.1:${(api.server.address() as { port: number }).port}`,
      );
      mcpApp = buildKnowledgeMcpApp({
        operationService: new PostgresKnowledgeOperationService(
          fixture.database,
        ),
        apiOrigin,
        resolveIdentity: (value: string) =>
          value === token ? identity : undefined,
        createApiClient: (access: string) =>
          new KnowledgeClient({
            baseUrl: apiOrigin,
            getAccessToken: () => access,
          }),
      });
      await mcpApp.listen({ host: "127.0.0.1", port: 0 });
      mcpOrigin = `http://127.0.0.1:${(mcpApp.server.address() as { port: number }).port}/mcp`;
    }, 240000);
    afterAll(async () => {
      await mcpApp?.close();
      await api?.close();
      await fixture?.close();
    });
    it("runs built CLI and SDK MCP search/read/packet/replay and retains the same remote citation", async () => {
      const adapters = await import(
        pathToFileURL(
          resolve(
            workspace,
            "../research_ingestion_systems_agent/tools/team/cli-adapter.mjs",
          ),
        ).href
      );
      const mcpAdapters = await import(
        pathToFileURL(
          resolve(
            workspace,
            "../research_ingestion_systems_agent/tools/team/mcp-adapter.mjs",
          ),
        ).href
      );
      const scope = () => ({
        assignment: {
          tenantId: fixture.tenantId,
          producerAttemptId: randomUUID(),
          readScope: [PUBLICATION_SPACE],
        },
        retained: new Set<string>(),
        retain(id: string) {
          this.retained.add(id);
        },
        requireRead(id: string) {
          if (!this.retained.has(id)) throw new Error("SCOPE_DENIED");
        },
      });
      const actorJson = JSON.stringify(actor),
        common = {
          KNOWLEDGE_API_TOKEN: token,
          KNOWLEDGE_API_ACTOR_JSON: actorJson,
        };
      const observed: {
        members: string[];
        citations: { text: string; digest: string; capture: string }[];
      }[] = [];
      for (const [factory, env] of [
        [
          adapters.cliRetrievalOperations,
          {
            ...common,
            KNOWLEDGE_CLI_BINARY: cli,
            KNOWLEDGE_CLI_SHA256: await hash(cli),
            KNOWLEDGE_API_URL: apiOrigin,
          },
        ],
        [
          mcpAdapters.mcpRetrievalOperations,
          {
            ...common,
            KNOWLEDGE_MCP_BINARY: mcp,
            KNOWLEDGE_MCP_SHA256: await hash(mcp),
            KNOWLEDGE_MCP_URL: mcpOrigin,
          },
        ],
      ] as const) {
        const operations = new Map(
          (factory as AdapterFactory)(env).map((item) => [item.name, item]),
        );
        const assigned = scope();
        const run = await (
          operations.get("retrieval_search") as ScopedOperation
        ).execute(assigned, { plan: plan(policyVersion) });
        expect(run.evidencePacketIds).toHaveLength(1);
        const packetId = run.evidencePacketIds[0]!;
        expect(assigned.retained.has(packetId)).toBe(true);
        const stored = EvidencePacketSchema.parse(
          await fixture.database.getEvidencePacket(fixture.tenantId, packetId),
        );
        if (existsSync(fixture.producerDirectory)) {
          const target = resolve(fixture.producerDirectory),
            parent = resolve(tmpdir()),
            child = relative(parent, target);
          expect(
            child && !child.startsWith("..") && !child.includes("..\\"),
          ).toBe(true);
          expect(basename(target).startsWith("ks-p5-publication-")).toBe(true);
          await rm(target, { recursive: true, force: true });
          expect(existsSync(target)).toBe(false);
        }
        const replay = await (
          operations.get("retrieval_citation_replay") as ScopedOperation
        ).execute(assigned, { evidencePacketId: packetId });
        expect(replay.evidencePacketId).toBe(packetId);
        expect(replay.failures).toEqual([]);
        expect(replay.citations.length).toBeGreaterThan(0);
        for (const citation of replay.citations)
          expect(citation.selectedText).toMatch(/preview/i);
        observed.push({
          members: stored.members
            .map(
              (member) => member.support?.target.canonicalId ?? member.memberId,
            )
            .sort(),
          citations: replay.citations
            .map((citation: any) => ({
              text: citation.selectedText,
              digest: citation.selectedContentDigest,
              capture: citation.captureDigest,
            }))
            .sort((a: { digest: string }, b: { digest: string }) =>
              a.digest.localeCompare(b.digest),
            ),
        });
      }
      expect(observed[0]).toEqual(observed[1]);
    }, 240000);
    it("T14 transport invokes all four built platform retrieval surfaces", async () => {
      const { createPlatformRetrievalTransport } = await import(
        pathToFileURL(
          resolve(
            workspace,
            "../research_ingestion_systems_agent/tools/team/t14-platform-transport.mjs",
          ),
        ).href
      );
      const directory = await mkdtemp(resolve(tmpdir(), "t14-platform-proof-"));
      const observed = [];
      for (const surface of ["cli", "mcp"]) {
        const transport = await createPlatformRetrievalTransport({
          surface,
          apiOrigin,
          mcpOrigin,
          token,
          actor,
          cliPackageDirectory: resolve(workspace, "apps/cli"),
          mcpPackageDirectory: resolve(workspace, "apps/mcp"),
          outputDirectory: resolve(directory, surface),
          signal: AbortSignal.timeout(60000),
        });
        const operationId = randomUUID();
        const context = {
          tenantId: fixture.tenantId,
          operationId,
          attemptId: randomUUID(),
          correlationId: operationId,
          actor,
          capabilityVersion: "t14-platform-proof.v1",
          idempotencyKey: operationId,
          reason: "Actual synthetic service transport proof",
          contractVersion: "v1",
        };
        const invoke = async (name: string, input: unknown) => {
          const result = await transport.execute(name, {
            context,
            input,
            expectedVersions: { api: "v1", retrieval: "v1" },
          });
          if (surface === "cli") {
            expect(result.exitCode).toBe(0);
            return result.payload;
          }
          expect(result.isError).not.toBe(true);
          return (
            result.structuredContent ??
            JSON.parse(
              result.content.find(
                (item: { type: string }) => item.type === "text",
              ).text,
            )
          );
        };
        try {
          expect(
            (await transport.catalog()).tools.some(
              (tool: { name: string }) =>
                tool.name === "retrieval.replay_citations",
            ),
          ).toBe(true);
          const accepted = await invoke("retrieval_query", {
            plan: plan(policyVersion),
          });
          expect(accepted.operationId).toBe(operationId);
          const run = await invoke("retrieval_run", { runId: operationId });
          expect(run.tenantId).toBe(fixture.tenantId);
          expect(run.evidencePacketIds).toHaveLength(1);
          const packetId = run.evidencePacketIds[0];
          const packet = EvidencePacketSchema.parse(
            await invoke("retrieval_packet", { packetId }),
          );
          expect(packet.id).toBe(packetId);
          const replay = await invoke("retrieval_citations", { packetId });
          expect(replay.failures).toEqual([]);
          expect(replay.citations.length).toBeGreaterThan(0);
          const { collectRetrievalEvidence } = await import(
            pathToFileURL(
              resolve(
                workspace,
                "../research_ingestion_systems_agent/tools/team/t14-collection.mjs",
              ),
            ).href
          );
          const collectionScope = {
            runId: operationId,
            tenantId: fixture.tenantId,
            question: plan(policyVersion).query,
            policyVersion,
            publicationVersionIds: packet.queryClock!.publications!.map(
              (item) => item.vectorSpaceVersionId,
            ),
            request: invoke,
          };
          const collected = await collectRetrievalEvidence(collectionScope);
          expect(collected.packets[0].replay.citations).toEqual(
            replay.citations,
          );
          await expect(
            collectRetrievalEvidence({
              ...collectionScope,
              question: "Changed original question",
            }),
          ).rejects.toThrow("QUESTION_BINDING");
          await expect(
            collectRetrievalEvidence({
              ...collectionScope,
              publicationVersionIds: [],
            }),
          ).rejects.toThrow("PUBLICATION_BINDING");
          await expect(
            collectRetrievalEvidence({
              ...collectionScope,
              request: async (name: string, input: unknown) => {
                const result = await invoke(name, input);
                return name === "retrieval_citations"
                  ? { ...result, citations: [] }
                  : result;
              },
            }),
          ).rejects.toThrow("CITATION_CLOSURE");
          await expect(
            collectRetrievalEvidence({
              ...collectionScope,
              request: async (name: string, input: unknown) => {
                const result = await invoke(name, input);
                if (name === "retrieval_citations")
                  result.citations[0].selectedText += " changed";
                return result;
              },
            }),
          ).rejects.toThrow("CITATION_BYTES");
          observed.push({
            members: packet.members
              .map(
                (member) =>
                  member.support?.target.canonicalId ?? member.memberId,
              )
              .sort(),
            citations: replay.citations
              .map(
                (citation: {
                  selectedText: string;
                  selectedContentDigest: string;
                }) => ({
                  text: citation.selectedText,
                  digest: citation.selectedContentDigest,
                }),
              )
              .sort((a: { digest: string }, b: { digest: string }) =>
                a.digest.localeCompare(b.digest),
              ),
          });
        } finally {
          await transport.close();
        }
      }
      expect(observed[0]).toEqual(observed[1]);
    }, 150000);
  },
);
