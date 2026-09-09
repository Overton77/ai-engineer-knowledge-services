import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { Readable } from "node:stream";
import type { RequestOptions } from "node:http";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import type { ArtifactStore } from "@aiengineer/knowledge-runtime";
import type { AcquisitionAdapter, AcquisitionPlan, AcquisitionRequest, AcquisitionResult, AcquisitionVerification, AdmittedAcquisitionPlan, SupportDecision } from "./types.js";

export interface HttpPolicy { allowedProtocols: readonly ("http:" | "https:")[]; allowedPorts: readonly number[]; maximumRedirects: number; timeoutMs: number; maximumBytes: number; maximumDecompressionRatio: number; allowedHosts?: readonly string[]; deniedHosts?: readonly string[] }
export interface DnsResolver { resolve(hostname: string): Promise<readonly string[]> }
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface PinnedHttpTransport { fetch(url: URL, init: RequestInit, validatedAddresses: readonly string[]): Promise<Response> }
const defaultResolver: DnsResolver = { async resolve(hostname) { return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address); } };
const forbiddenIpv6 = new BlockList();
const forbiddenIpv4 = new BlockList();
forbiddenIpv6.addAddress("::", "ipv6");
forbiddenIpv6.addAddress("::1", "ipv6");
for (const [network, prefix] of [["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) forbiddenIpv6.addSubnet(network, prefix, "ipv6");
// IPv4-mapped IPv6 sockets reach the same IPv4 destinations. Keep a single
// range list so alternate address spellings cannot bypass special-use policy.
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["192.0.0.0", 24], ["192.0.2.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) {
  forbiddenIpv4.addSubnet(network, prefix, "ipv4");
  forbiddenIpv6.addSubnet(`::ffff:${network}`, 96 + prefix, "ipv6");
}

export function isForbiddenAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  if (isIP(normalized) === 6) return forbiddenIpv6.check(normalized, "ipv6");
  return isIP(normalized) !== 4 || forbiddenIpv4.check(normalized, "ipv4");
}
export interface SafeHttpTarget { url: URL; addresses: readonly string[] }
export async function resolveSafeHttpTarget(raw: string, policy: HttpPolicy, resolver: DnsResolver): Promise<SafeHttpTarget> {
  const url = new URL(raw); if (!policy.allowedProtocols.includes(url.protocol as "http:" | "https:")) throw new Error("PROTOCOL_DENIED");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_DENIED"); const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!policy.allowedPorts.includes(port)) throw new Error("PORT_DENIED"); const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (policy.deniedHosts?.includes(host) || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") throw new Error("HOST_DENIED");
  if (policy.allowedHosts && !policy.allowedHosts.includes(host)) throw new Error("HOST_NOT_ALLOWLISTED"); const addresses = isIP(host) ? [host] : await resolver.resolve(host);
  if (addresses.length === 0 || addresses.some(isForbiddenAddress)) throw new Error("ADDRESS_DENIED"); return { url, addresses: [...new Set(addresses)] };
}
export async function assertSafeHttpUrl(raw: string, policy: HttpPolicy, resolver: DnsResolver): Promise<URL> { return (await resolveSafeHttpTarget(raw, policy, resolver)).url; }

/** Connects to a policy-validated address while retaining the original Host and TLS server name. */
export type PinnedRequestOptions = RequestOptions & { servername?: string; rejectUnauthorized?: boolean };
export function buildPinnedRequestOptions(url: URL, init: RequestInit, address: string): PinnedRequestOptions {
  const family = isIP(address); if ((family !== 4 && family !== 6) || isForbiddenAddress(address)) throw new Error("PINNED_ADDRESS_INVALID");
  const headers = Object.fromEntries(new Headers(init.headers).entries()); headers.host = url.host;
  const certificateName = url.hostname.replace(/^\[|\]$/g, "");
  return {
    protocol: url.protocol, hostname: address, family, port: url.port || (url.protocol === "https:" ? 443 : 80),
    method: init.method ?? "GET", path: `${url.pathname}${url.search}`, headers, signal: init.signal ?? undefined,
    ...(url.protocol === "https:" ? { ...(isIP(certificateName) === 0 ? { servername: certificateName } : {}), rejectUnauthorized: true } : {}),
  };
}
export const nodePinnedHttpTransport: PinnedHttpTransport = {
  async fetch(url, init, validatedAddresses) {
    const address = validatedAddresses[0]; if (!address) throw new Error("PINNED_ADDRESS_INVALID");
    if (init.body !== undefined && init.body !== null) throw new Error("PINNED_TRANSPORT_BODY_UNSUPPORTED");
    const request = url.protocol === "https:" ? requestHttps : requestHttp;
    return await new Promise<Response>((resolve, reject) => {
      const req = request(buildPinnedRequestOptions(url, init, address), (incoming) => {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) responseHeaders.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
        const status = incoming.statusCode ?? 500; const bodyForbidden = status === 204 || status === 205 || status === 304;
        if (bodyForbidden) incoming.resume();
        resolve(new Response(bodyForbidden ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, statusText: incoming.statusMessage ?? "", headers: responseHeaders }));
      });
      req.once("error", reject); req.end();
    });
  },
};
async function boundedBody(response: Response, maximumBytes: number, maximumDecompressionRatio: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    const encoded = Boolean(contentEncoding && contentEncoding !== "identity");
    const declaredHeader = response.headers.get("content-length");
    const declared = declaredHeader === null ? Number.NaN : Number(declaredHeader);
    if (encoded && (!Number.isFinite(declared) || declared <= 0)) throw new Error("ENCODED_LENGTH_REQUIRED");
    if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("BYTE_LIMIT_EXCEEDED");
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      signal.throwIfAborted();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximumBytes) throw new Error("BYTE_LIMIT_EXCEEDED");
      if (encoded && size / declared > maximumDecompressionRatio) throw new Error("DECOMPRESSION_RATIO_EXCEEDED");
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    void reader?.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}

export class ExactHttpAcquisitionAdapter implements AcquisitionAdapter {
  readonly adapterKey = "direct-http"; readonly version = "1.0.0";
  constructor(private readonly artifacts: ArtifactStore, private readonly policy: HttpPolicy, private readonly resolver: DnsResolver = defaultResolver, private readonly fetcher?: HttpFetch, private readonly pinnedTransport: PinnedHttpTransport = nodePinnedHttpTransport) {}
  supports(request: AcquisitionRequest): SupportDecision { return request.target.kind === "http" ? { supported: true, reason: "exact HTTP capture" } : { supported: false, reason: "HTTP target required" }; }
  async plan(request: AcquisitionRequest): Promise<AcquisitionPlan> { if (request.target.kind !== "http") throw new Error("UNSUPPORTED_TARGET"); const url = await assertSafeHttpUrl(request.target.url, this.policy, this.resolver); const digestablePolicy = JSON.parse(JSON.stringify({ ...this.policy, allowedProtocols: [...this.policy.allowedProtocols], allowedPorts: [...this.policy.allowedPorts] })); return { adapterKey: this.adapterKey, adapterVersion: this.version, request, normalizedTarget: url.href, policyDigest: sha256Digest(digestablePolicy) }; }
  async execute(plan: AdmittedAcquisitionPlan): Promise<AcquisitionResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error("ACQUISITION_TIMEOUT");
        controller.abort(error);
        reject(error);
      }, this.policy.timeoutMs);
    });
    try {
      return await Promise.race([this.executeWithinDeadline(plan, controller.signal), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async executeWithinDeadline(plan: AdmittedAcquisitionPlan, signal: AbortSignal): Promise<AcquisitionResult> { let url = plan.normalizedTarget; const redirects: string[] = []; let response: Response | undefined;
    for (let count = 0; count <= this.policy.maximumRedirects; count++) { const target = await resolveSafeHttpTarget(url, this.policy, this.resolver); signal.throwIfAborted(); const init: RequestInit = { redirect: "manual", signal, headers: { accept: plan.request.preferredMediaTypes.join(", ") || "*/*", "accept-encoding": "identity", "user-agent": "ai-engineer-knowledge-services/1" } }; response = this.fetcher ? await this.fetcher(target.url.href, init) : await this.pinnedTransport.fetch(target.url, init, target.addresses); if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); } if (![301, 302, 303, 307, 308].includes(response.status)) break; const location = response.headers.get("location"); await response.body?.cancel(); if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION"); if (count === this.policy.maximumRedirects) throw new Error("REDIRECT_LIMIT_EXCEEDED"); url = new URL(location, url).href; redirects.push(url); }
    if (!response) throw new Error("HTTP_NO_RESPONSE"); const bytes = await boundedBody(response, Math.min(plan.request.maximumBytes, this.policy.maximumBytes), this.policy.maximumDecompressionRatio, signal); signal.throwIfAborted(); const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream"; const artifact = await this.artifacts.put({ tenantId: plan.request.tenantId, mediaType, bytes }); const redactedHeaders = [...response.headers.entries()].filter(([key]) => !/authorization|cookie|api[-_]?key|secret|token/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
    return { plan, artifacts: [artifact], contentDigests: [artifact.digest], observations: [{ key: "status", value: String(response.status) }, { key: "final_url", value: url }, { key: "redirects", value: JSON.stringify(redirects) }, { key: "headers", value: JSON.stringify(redactedHeaders) }, { key: "declared_content_type", value: response.headers.get("content-type") ?? "" }, { key: "observed_media_type", value: mediaType }], discoveredCanonicalIdentifiers: [url], captureMethod: `${this.adapterKey}@${this.version}`, retryAdvice: response.status >= 500 ? "retry" : "none", costMicros: 0, errors: response.ok ? [] : [{ code: "HTTP_STATUS", message: String(response.status) }] };
  }
  async verify(result: AcquisitionResult): Promise<AcquisitionVerification> { const checks = ["artifact_sealed", "response_body_hashed", "redirects_revalidated", "headers_redacted"]; const findings = result.artifacts.length === 1 && result.contentDigests[0] === result.artifacts[0]?.digest ? [] : ["artifact_digest_mismatch"]; return { accepted: findings.length === 0 && result.errors.length === 0, checks, findings }; }
}
