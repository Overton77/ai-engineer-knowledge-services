import { lookup } from "node:dns/promises";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ExactHttpAcquisitionAdapter,
  FirecrawlAcquisitionAdapter,
  type AcquisitionRequest,
  type DnsResolver,
} from "../packages/acquisition/src/index.js";
import {
  ConversionRouter,
  DeterministicTextConversionProvider,
  type DocumentConversionProvider,
} from "../packages/conversion/src/index.js";
import { canonicalJson, sha256Digest } from "../packages/domain/src/index.js";
import { InMemoryArtifactStore } from "../packages/runtime/src/index.js";

const officialUrl = "https://docs.langchain.com/oss/python/langchain/overview";
const tenantId = "00000000-0000-7000-8000-000000000001";
const artifacts = new InMemoryArtifactStore();
const resolver: DnsResolver = {
  async resolve(hostname) {
    return (await lookup(hostname, { all: true, verbatim: true })).map(
      (entry) => entry.address,
    );
  },
};
const targetPolicy = {
  allowedProtocols: ["https:"] as const,
  allowedPorts: [443],
  maximumRedirects: 3,
  timeoutMs: 20_000,
  maximumBytes: 2_000_000,
  maximumDecompressionRatio: 50,
  allowedHosts: ["docs.langchain.com"],
};
const request: AcquisitionRequest = {
  tenantId,
  purpose: "gate-1-bounded-official-capture",
  target: { kind: "http", url: officialUrl },
  expectedSourceClass: "official_docs",
  preferredMediaTypes: ["text/html"],
  egressProfile: "bounded-official-public",
  maximumBytes: 2_000_000,
  maximumDepth: 0,
  renderingPolicy: "none",
  interactionPolicy: "none",
  classification: "public",
  expectedOutputs: ["source_native", "structural_extraction"],
};
function typedFailure(error: unknown): {
  status: "failed";
  failureClass: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const failureClass =
    message.match(/^[A-Z][A-Z0-9_]*(?=:|$)/)?.[0] ??
    (message.includes("fetch failed")
      ? "PROVIDER_UNAVAILABLE"
      : "UNCLASSIFIED_PROVIDER_FAILURE");
  return { status: "failed", failureClass };
}

async function exactEvidence() {
  try {
    const adapter = new ExactHttpAcquisitionAdapter(
      artifacts,
      targetPolicy,
      resolver,
    );
    const plan = await adapter.plan(request);
    const result = await adapter.execute({
      ...plan,
      admissionId: "gate1-direct-http-v1",
    });
    const verification = await adapter.verify(result);
    return {
      status: verification.accepted ? "passed" : "failed",
      adapter: `${adapter.adapterKey}@${adapter.version}`,
      officialUrl,
      artifactDigest: result.artifacts[0]?.digest,
      byteLength: result.artifacts[0]?.byteLength,
      finalUrl: result.observations.find((item) => item.key === "final_url")
        ?.value,
      checks: verification.checks,
      findings: verification.findings,
    };
  } catch (error) {
    return {
      ...typedFailure(error),
      adapter: "direct-http@1.0.0",
      officialUrl,
    };
  }
}
async function firecrawlEvidence() {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey)
    return {
      status: "not_configured",
      failureClass: "AUTHENTICATION_SECRET_UNAVAILABLE",
      adapter: "firecrawl-scrape",
    };
  try {
    const adapter = new FirecrawlAcquisitionAdapter(
      artifacts,
      {
        endpoint:
          process.env.FIRECRAWL_API_URL?.trim() ||
          "https://api.firecrawl.dev/v1/scrape",
        authenticationReference: "env:FIRECRAWL_API_KEY",
        apiVersion: "v1",
        timeoutMs: 30_000,
        maximumResponseBytes: 5_000_000,
        maximumDecompressionRatio: 50,
        allowedApiHosts: ["api.firecrawl.dev"],
        targetPolicy,
      },
      {
        async resolve(reference) {
          if (reference !== "env:FIRECRAWL_API_KEY")
            throw new Error("AUTHENTICATION_REFERENCE_DENIED");
          return apiKey;
        },
      },
      resolver,
    );
    const plan = await adapter.plan({
      ...request,
      authenticationReference: "env:FIRECRAWL_API_KEY",
    });
    const result = await adapter.execute({
      ...plan,
      admissionId: "gate1-firecrawl-v1",
    });
    const verification = await adapter.verify(result);
    return {
      status: verification.accepted ? "passed" : "failed",
      adapter: `${adapter.adapterKey}@${adapter.version}`,
      officialUrl,
      artifactDigests: result.artifacts.map((item) => item.digest),
      byteLengths: result.artifacts.map((item) => item.byteLength),
      checks: verification.checks,
      findings: verification.findings,
      providerStatus: result.observations.find(
        (item) => item.key === "provider_status",
      )?.value,
      representations: result.observations.find(
        (item) => item.key === "representations",
      )?.value,
    };
  } catch (error) {
    return {
      ...typedFailure(error),
      adapter: "firecrawl-scrape@v1",
      officialUrl,
    };
  }
}
async function conversionEvidence() {
  const unstructuredConfigured = Boolean(
    process.env.UNSTRUCTURED_API_URL?.trim() &&
    process.env.UNSTRUCTURED_API_KEY?.trim() &&
    process.env.UNSTRUCTURED_TEMPLATE_ID?.trim(),
  );
  const bytes = new TextEncoder().encode(
    "Bounded bundle-derived conversion fixture: reliable agents combine planning, tool use, and evaluation.",
  );
  const sourceArtifact = await artifacts.put({
    tenantId,
    mediaType: "application/pdf",
    bytes,
  });
  const deterministic = new DeterministicTextConversionProvider(artifacts);
  const managed: DocumentConversionProvider = {
    providerKey: "unstructured-transform",
    version: "configured-route-v1",
    supports: () => true,
    async convert() {
      throw new Error(
        unstructuredConfigured
          ? "PROVIDER_UNAVAILABLE:deliberate-gate1-outage"
          : "MANAGED_PROCESSING_DENIED:not-configured",
      );
    },
  };
  const local: DocumentConversionProvider = {
    providerKey: "admitted-local-fallback",
    version: "1.0.0",
    supports: () => true,
    async convert(input) {
      const output = await deterministic.convert({
        ...input,
        profile: {
          ...input.profile,
          mediaType: "text/plain",
          managedProcessingAllowed: false,
        },
      });
      return {
        ...output,
        providerKey: "admitted-local-fallback",
        providerVersion: "1.0.0",
      };
    },
  };
  const router = new ConversionRouter(
    {
      providerKey: "native-unsupported",
      version: "1.0.0",
      supports: () => false,
      async convert() {
        throw new Error("UNREACHABLE");
      },
    },
    managed,
    local,
  );
  const routed = await router.convertWithReceipt({
    tenantId,
    sourceArtifact,
    profile: {
      profileKey: "bounded-pdf",
      version: "1.0.0",
      mediaType: "application/pdf",
      managedProcessingAllowed: true,
    },
  });
  return {
    unstructured: unstructuredConfigured
      ? {
          status: "deliberate_outage_simulated",
          liveInvocation: false,
          reason: "bounded fallback proof",
        }
      : {
          status: "not_configured",
          liveInvocation: false,
          failureClass: "MANAGED_PROCESSING_DENIED",
        },
    fallback: {
      status: "passed",
      selectedProvider: routed.receipt.selectedProviderKey,
      fallbackUsed: routed.receipt.fallbackUsed,
      attempts: routed.receipt.attempts,
      routingReceiptDigest: routed.receipt.receiptDigest,
      outputDigests: [
        routed.output.providerNativeArtifact.digest,
        routed.output.markdownArtifact.digest,
        routed.output.plainTextArtifact.digest,
      ],
    },
  };
}

const startedAt = new Date().toISOString();
const exact = await exactEvidence();
const firecrawl = await firecrawlEvidence();
const conversion = await conversionEvidence();
const core = {
  schemaVersion: "gate1-live-evidence/1.0.0",
  storeClass: "internal_exploratory",
  canonicalPublication: false,
  source: {
    fixture: "embedding-bundle-seed-2026-09-01",
    videoId: "kTnfJszFxCg",
    officialUrl,
  },
  startedAt,
  completedAt: new Date().toISOString(),
  exact,
  firecrawl,
  conversion,
  supabaseStorage: {
    adapterVerifiedDeterministically: true,
    liveMutationPerformed: false,
  },
};
const receipt = {
  ...core,
  receiptDigest: sha256Digest(JSON.parse(JSON.stringify(core))),
};
const path = resolve("catalog/gate1-live-evidence.json");
await writeFile(
  path,
  `${canonicalJson(JSON.parse(JSON.stringify(receipt)))}\n`,
  "utf8",
);
process.stdout.write(
  `${JSON.stringify({ receipt: path, receiptDigest: receipt.receiptDigest, exact: exact.status, firecrawl: firecrawl.status, unstructured: conversion.unstructured.status, fallback: conversion.fallback.status })}\n`,
);
