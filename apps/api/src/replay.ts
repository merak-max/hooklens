import { isIP } from "node:net";

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);

function isPrivateIp(hostname: string) {
  if (!isIP(hostname)) return false;
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    || hostname === "::1"
    || hostname.startsWith("fc")
    || hostname.startsWith("fd")
    || hostname.startsWith("fe80:");
}

export function validateReplayUrl(value: unknown, allowedHosts: Set<string>) {
  if (typeof value !== "string") throw new Error("A replay destination is required.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) replay destinations are supported.");
  if (blockedHostnames.has(url.hostname) || isPrivateIp(url.hostname)) throw new Error("Private network destinations are blocked.");
  if (!allowedHosts.has(url.hostname)) throw new Error("This host is not in REPLAY_ALLOWED_HOSTS.");
  return url;
}
