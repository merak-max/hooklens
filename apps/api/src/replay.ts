import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import type { WebhookEvent } from "./types.js";

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === "unicast"; } catch { return false; }
}
export function validateReplayUrl(value: unknown, allowedHosts: Set<string>) {
  if (typeof value !== "string") throw new Error("A replay destination is required.");
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) replay destinations are supported.");
  if (url.username || url.password) throw new Error("Destination credentials are not allowed.");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || (isIP(hostname) && !isPublicAddress(hostname))) throw new Error("Private or reserved destinations are blocked.");
  if (!allowedHosts.has(hostname)) throw new Error("This host is not in REPLAY_ALLOWED_HOSTS.");
  return url;
}
export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function resolveReplayAddress(url: URL, resolver: Resolver = (host) => lookup(host, { all: true })) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const results = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolver(hostname);
  if (!results.length || results.some(({ address }) => !isPublicAddress(address))) throw new Error("DNS resolved to a private or reserved address.");
  return results[0]!;
}
export async function deliverReplay(url: URL, event: WebhookEvent): Promise<number> {
  const signal = AbortSignal.timeout(5000);
  const address = await Promise.race([
    resolveReplayAddress(url),
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("Replay timed out.")), { once: true })),
  ]);
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, {
      method: event.method,
      headers: { "content-type": event.contentType, "x-hooklens-replay": event.id },
      signal,
      // Connect to the validated IP, preserving original Host and TLS SNI.
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [address]) : callback(null, address.address, address.family),
    }, (response) => {
      resolve(response.statusCode ?? 502);
      response.destroy();
    });
    req.on("error", reject);
    req.end(["GET", "HEAD"].includes(event.method) ? undefined : Buffer.from(event.rawBody, "base64"));
  });
}
