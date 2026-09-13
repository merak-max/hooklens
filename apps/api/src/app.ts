import { randomBytes, randomUUID } from "node:crypto";
import express, { type Response } from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { FileStore } from "./store.js";
import { validateReplayUrl } from "./replay.js";
import { verifySignature } from "./signature.js";
import type { WebhookEvent } from "./types.js";

type AppOptions = {
  store: FileStore;
  publicBaseUrl?: string;
  allowedReplayHosts?: Set<string>;
  fetchImpl?: typeof fetch;
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
  const fetchImpl = options.fetchImpl ?? fetch;

  app.disable("x-powered-by");

  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

  app.all("/hook/:key", express.raw({ type: "*/*", limit: "1mb" }), async (request, response) => {
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
    await options.store.addEvent(event);
    for (const stream of streams.get(inbox.id) ?? []) stream.write(`event: webhook\ndata: ${JSON.stringify(event)}\n\n`);
    return response.status(202).json({ accepted: true, eventId: event.id });
  });

  app.use(express.json({ limit: "64kb" }));

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
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    response.flushHeaders();
    const clients = streams.get(request.params.id) ?? new Set<Response>();
    clients.add(response);
    streams.set(request.params.id, clients);
    response.write("event: ready\ndata: {}\n\n");
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
    request.on("close", () => { clearInterval(heartbeat); clients.delete(response); });
  });

  app.post("/api/events/:id/replay", async (request, response) => {
    const event = await options.store.findEvent(request.params.id);
    if (!event) return response.status(404).json({ error: "Event not found." });
    let destination: URL;
    try { destination = validateReplayUrl(request.body?.destination, allowedReplayHosts); }
    catch (error) { return response.status(403).json({ error: (error as Error).message }); }
    const replayResponse = await fetchImpl(destination, {
      method: event.method,
      headers: { "content-type": event.contentType, "x-hooklens-replay": event.id },
      body: ["GET", "HEAD"].includes(event.method) ? undefined : Buffer.from(event.rawBody, "base64"),
      redirect: "manual",
    });
    return response.json({ status: replayResponse.status, destination: destination.toString() });
  });

  if (options.webDist && existsSync(options.webDist)) {
    app.use(express.static(options.webDist));
    app.get("/{*path}", (_request, response) => response.sendFile(resolve(options.webDist!, "index.html")));
  }

  return app;
}
