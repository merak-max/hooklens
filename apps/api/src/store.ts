import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database, Inbox, WebhookEvent } from "./types.js";

const emptyDatabase = (): Database => ({ inboxes: [], events: [] });

export class FileStore {
  private data: Database = emptyDatabase();
  private loaded = false;
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load() {
    if (this.loaded) return;
    try {
      this.data = JSON.parse(await readFile(this.filePath, "utf8")) as Database;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
    this.loaded = true;
  }

  async listInboxes() {
    await this.load();
    return [...this.data.inboxes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createInbox(inbox: Inbox) {
    await this.load();
    this.data.inboxes.push(inbox);
    await this.persist();
    return inbox;
  }

  async findInboxById(id: string) {
    await this.load();
    return this.data.inboxes.find((inbox) => inbox.id === id);
  }

  async findInboxByKey(key: string) {
    await this.load();
    return this.data.inboxes.find((inbox) => inbox.key === key);
  }

  async addEvent(event: WebhookEvent) {
    await this.load();
    this.data.events.push(event);
    await this.persist();
    return event;
  }

  async findEvent(id: string) {
    await this.load();
    return this.data.events.find((event) => event.id === id);
  }

  async listEvents(inboxId: string) {
    await this.load();
    return this.data.events
      .filter((event) => event.inboxId === inboxId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  private async persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }
}
