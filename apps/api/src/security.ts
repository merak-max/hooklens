import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";

export function tokenMatches(value: string, expected: string) {
  return timingSafeEqual(createHash("sha256").update(value).digest(), createHash("sha256").update(expected).digest());
}
export function requestToken(request: Request) {
  const authorization = request.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const value = (request.get("cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith("hooklens_session="))?.slice(17) ?? "";
  try { return decodeURIComponent(value); } catch { return ""; }
}
export function rateLimit(limit: number, windowMs = 60000): RequestHandler {
  const buckets = new Map<string, { count: number; until: number }>();
  return (request, response, next) => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    const key = request.ip ?? "unknown";
    if (!buckets.has(key) && buckets.size >= 10000) return void response.status(503).json({ error: "Rate limiter capacity reached." });
    const bucket = buckets.get(key) ?? { count: 0, until: now + windowMs };
    buckets.set(key, bucket);
    if (++bucket.count > limit) {
      response.set("Retry-After", String(Math.ceil((bucket.until - now) / 1000)));
      return void response.status(429).json({ error: "Rate limit reached. Try again later." });
    }
    next();
  };
}
