import { randomBytes, randomUUID } from "node:crypto";
import express, { type Response, type ErrorRequestHandler } from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { FileStore, StoreLimitError } from "./store.js";
import { deliverReplay, validateReplayUrl } from "./replay.js";
import { rateLimit, requestToken, tokenMatches } from "./security.js";
import { verifySignature } from "./signature.js";
import type { WebhookEvent } from "./types.js";

type AppOptions = {
  store: FileStore;
  publicBaseUrl?: string;
  allowedReplayHosts?: Set<string>;
  replayImpl?: typeof deliverReplay;
  authToken?: string;
  secureCookies?: boolean;
  requestsPerMinute?: number;
  webDist?: string;
};

function headersToRecord(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""]));
}

function parseBody(raw: Buffer, contentType: string) {
  const text = raw.toString("utf8");
  if (contentType.includes("application/json")) {
    try { return JSON.parse(text) as unknown; } catch { return text; }
  }
  return text;
}

export function createApp(options: AppOptions) {
  const app = express();
  const streams = new Map<string, Set<Response>>();
  const allowedReplayHosts = options.allowedReplayHosts ?? new Set<string>();
  const replayImpl = options.replayImpl ?? deliverReplay;
  if (options.authToken && options.authToken.length < 24) throw new Error("HOOKLENS_TOKEN must contain at least 24 characters.");

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    if (!options.authToken) {
      let hostname: string;
      try { hostname = new URL(`http://${request.get("host")}`).hostname; }
      catch { return void response.status(400).json({ error: "Invalid Host header." }); }
      if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return void response.status(421).json({ error: "Unauthenticated mode accepts only loopback Host headers." });
    }
    next();
  });
  app.use((_request, response, next) => {
    response.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    next();
  });

  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

  app.use(rateLimit(options.requestsPerMinute ?? 600));
  app.all("/hook/:key", express.raw({ type: () => true, limit: "64kb" }), async (request, response) => {
    const inbox = await options.store.findInboxByKey(request.params.key);
    if (!inbox) return response.status(404).json({ error: "Inbox not found." });
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");
    const contentType = request.get("content-type") ?? "application/octet-stream";
    const event: WebhookEvent = {
      id: randomUUID(),
      inboxId: inbox.id,
      method: request.method,
      path: request.path,
      query: request.query as Record<string, string | string[]>,
      headers: headersToRecord(request.headers),
      body: parseBody(raw, contentType),
      rawBody: raw.toString("base64"),
      contentType,
      receivedAt: new Date().toISOString(),
      signature: verifySignature(inbox.secret, raw, request.get("x-hooklens-signature") ?? undefined),
    };
    const stored = await options.store.addEvent(event);
    for (const stream of streams.get(inbox.id) ?? []) {
      if (!stream.write(`event: webhook\ndata: ${JSON.stringify(stored)}\n\n`)) stream.end();
    }
    return response.status(202).json({ accepted: true, eventId: event.id });
  });

  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (request, response, next) => {
    response.set("Cache-Control", "no-store");
    const origin = request.get("origin");
    const expectedOrigin = options.publicBaseUrl ? new URL(options.publicBaseUrl).origin : `${request.protocol}://${request.get("host")}`;
    if (request.get("sec-fetch-site") === "cross-site" || (origin && origin !== expectedOrigin)) return void response.status(403).json({ error: "Cross-origin management requests are blocked." });
    next();
  });
  app.post("/api/session", rateLimit(10), (request, response) => {
    if (!options.authToken || !tokenMatches(String(request.body?.token ?? ""), options.authToken)) return response.status(401).json({ error: "Invalid management token." });
    response.cookie("hooklens_session", options.authToken, { httpOnly: true, sameSite: "strict", secure: options.secureCookies ?? false, maxAge: 8 * 3600000, path: "/api" });
    return response.json({ authenticated: true });
  });
  app.use("/api", (request, response, next) => {
    if (options.authToken && !tokenMatches(requestToken(request), options.authToken)) return void response.status(401).json({ error: "Management authentication required." });
    next();
  });
  app.delete("/api/session", (_request, response) => {
    response.clearCookie("hooklens_session", { path: "/api" });
    response.json({ authenticated: false });
  });

  app.get("/api/inboxes", async (_request, response) => response.json(await options.store.listInboxes()));

  app.post("/api/inboxes", async (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim().slice(0, 80) : "";
    if (!name) return response.status(400).json({ error: "Inbox name is required." });
    const inbox = await options.store.createInbox({
      id: randomUUID(),
      name,
      key: randomBytes(12).toString("hex"),
      secret: randomBytes(24).toString("hex"),
      createdAt: new Date().toISOString(),
    });
    const baseUrl = options.publicBaseUrl ?? `${request.protocol}://${request.get("host")}`;
    return response.status(201).json({ ...inbox, endpoint: `${baseUrl}/hook/${inbox.key}` });
  });

  app.get("/api/inboxes/:id/events", async (request, response) => {
    if (!await options.store.findInboxById(request.params.id)) return response.status(404).json({ error: "Inbox not found." });
    const query = typeof request.query.q === "string" ? request.query.q.toLowerCase() : "";
    const method = typeof request.query.method === "string" ? request.query.method.toUpperCase() : "";
    const signature = typeof request.query.signature === "string" ? request.query.signature : "";
    let events = await options.store.listEvents(request.params.id);
    if (method) events = events.filter((event) => event.method === method);
    if (signature === "valid") events = events.filter((event) => event.signature.valid);
    if (signature === "invalid") events = events.filter((event) => event.signature.provided && !event.signature.valid);
    if (signature === "unsigned") events = events.filter((event) => !event.signature.provided);
    if (query) events = events.filter((event) => JSON.stringify(event).toLowerCase().includes(query));
    return response.json(events);
  });

  app.get("/api/inboxes/:id/stream", async (request, response) => {
    if (!await options.store.findInboxById(request.params.id)) return response.status(404).end();
    const clients = streams.get(request.params.id) ?? new Set<Response>();
    if (clients.size >= 10 || [...streams.values()].reduce((sum, set) => sum + set.size, 0) >= 100) return response.status(429).end();
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    response.flushHeaders();
    clients.add(response);
    streams.set(request.params.id, clients);
    response.write("event: ready\ndata: {}\n\n");
    const heartbeat = setInterval(() => { if (!response.write(": heartbeat\n\n")) response.end(); }, 20_000);
    const lifetime = setTimeout(() => response.end(), 5 * 60_000);
    response.on("close", () => { clearInterval(heartbeat); clearTimeout(lifetime); clients.delete(response); if (!clients.size) streams.delete(request.params.id); });
  });

  app.post("/api/events/:id/replay", async (request, response) => {
    const event = await options.store.findEvent(request.params.id);
    if (!event) return response.status(404).json({ error: "Event not found." });
    let destination: URL;
    try { destination = validateReplayUrl(request.body?.destination, allowedReplayHosts); }
    catch (error) { return response.status(403).json({ error: (error as Error).message }); }
    try {
      const status = await replayImpl(destination, event);
      return response.json({ status, destination: destination.toString() });
    } catch { return response.status(502).json({ error: "Replay failed DNS validation, timed out, or could not connect." }); }
  });

  if (options.webDist && existsSync(options.webDist)) {
    app.use(express.static(options.webDist));
    app.get("/{*path}", (_request, response) => response.sendFile(resolve(options.webDist!, "index.html")));
  }

  const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
    if (response.headersSent) return response.end();
    if (error instanceof StoreLimitError) return void response.status(507).json({ error: error.message });
    const status = error?.status === 413 ? 413 : error?.status === 400 ? 400 : 500;
    response.status(status).json({ error: status === 413 ? "Payload exceeds 64 KiB." : status === 400 ? "Malformed request." : "Internal server error." });
  };
  app.use(handleError);
  return app;
}
