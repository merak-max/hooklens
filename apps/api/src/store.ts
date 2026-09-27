import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compareShapes, inferShape } from "./schema.js";
import type { Database, Inbox, WebhookEvent } from "./types.js";

type Limits = { maxEvents?: number; maxInboxes?: number; maxBytes?: number; retentionMs?: number; now?: () => number };
export class StoreLimitError extends Error {}

export class FileStore {
  private data: Database = { inboxes: [], events: [] };
  private loading?: Promise<void>;
  private writeQueue = Promise.resolve();
  private pending = 0;
  private limits: Required<Limits>;

  constructor(private readonly filePath: string, limits: Limits = {}) {
    this.limits = { maxEvents: 1000, maxInboxes: 20, maxBytes: 8 * 1024 * 1024, retentionMs: 7 * 86400000, now: Date.now, ...limits };
  }
  async load() {
    this.loading ??= (async () => {
      try { this.data = JSON.parse(await readFile(this.filePath, "utf8")) as Database; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    })();
    await this.loading;
  }
  private async mutate<T>(change: (data: Database) => T): Promise<T> {
    if (this.pending >= 64) throw new StoreLimitError("Write queue is full.");
    this.pending++;
    const work = this.writeQueue.then(async () => {
      await this.load();
      const next = structuredClone(this.data);
      next.events = next.events.filter((event) => Date.parse(event.receivedAt) >= this.limits.now() - this.limits.retentionMs);
      const result = change(next);
      next.events = next.events.slice(-this.limits.maxEvents);
      let encoded = JSON.stringify(next);
      while (Buffer.byteLength(encoded) > this.limits.maxBytes && next.events.length > 1) {
        next.events.shift();
        encoded = JSON.stringify(next);
      }
      if (Buffer.byteLength(encoded) > this.limits.maxBytes) throw new StoreLimitError("Store capacity exceeded.");
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath + ".tmp", encoded, { mode: 0o600 });
      await rename(this.filePath + ".tmp", this.filePath);
      this.data = next;
      return structuredClone(result);
    });
    this.writeQueue = work.then(() => undefined, () => undefined);
    try { return await work; } finally { this.pending--; }
  }
  async listInboxes() { await this.load(); return structuredClone(this.data.inboxes).reverse(); }
  async findInboxById(id: string) { await this.load(); return structuredClone(this.data.inboxes.find((i) => i.id === id)); }
  async findInboxByKey(key: string) { await this.load(); return structuredClone(this.data.inboxes.find((i) => i.key === key)); }
  async createInbox(inbox: Inbox) {
    return this.mutate((data) => {
      if (data.inboxes.length >= this.limits.maxInboxes) throw new StoreLimitError("Inbox limit reached.");
      data.inboxes.push(inbox);
      return inbox;
    });
  }
  async addEvent(event: WebhookEvent) {
    return this.mutate((data) => {
      const inbox = data.inboxes.find((i) => i.id === event.inboxId);
      if (!inbox) throw new Error("Unknown inbox.");
      if (event.contentType.includes("application/json") && event.body !== null && typeof event.body === "object") {
        try {
          const shape = inferShape(event.body);
          inbox.baseline ??= { eventId: event.id, shape };
          event.schema = { baselineEventId: inbox.baseline.eventId, changes: compareShapes(inbox.baseline.shape, shape) };
        } catch { event.schemaError = "JSON shape exceeds analysis limits; capture retained without analysis."; }
      }
      data.events.push(event);
      return event;
    });
  }
  async prune() { await this.mutate(() => undefined); }
  async findEvent(id: string) {
    await this.load();
    return structuredClone(this.data.events.find((e) => e.id === id && Date.parse(e.receivedAt) >= this.limits.now() - this.limits.retentionMs));
  }
  async listEvents(inboxId: string) {
    await this.load();
    return structuredClone(this.data.events.filter((e) => e.inboxId === inboxId && Date.parse(e.receivedAt) >= this.limits.now() - this.limits.retentionMs).reverse());
  }
}
