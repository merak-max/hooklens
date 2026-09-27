import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { FileStore } from "../src/store.js";
import { inferShape, compareShapes } from "../src/schema.js";
import { isPublicAddress, resolveReplayAddress, validateReplayUrl } from "../src/replay.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hooklens-hardening-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const token = "test-only-management-token-123456";

test("unauthenticated local mode rejects non-loopback Host headers", async () => {
  const app = createApp({ store: new FileStore(join(directory, "local.json")) });
  await request(app).get("/api/inboxes").set("Host", "attacker.example:8787").expect(421);
  await request(app).get("/api/inboxes").set("Host", "localhost:8787").expect(200);
});

test("management API requires auth; login cookies authorize SSE and API; cross-origin writes fail", async () => {
  const app = createApp({ store: new FileStore(join(directory, "store.json")), authToken: token, publicBaseUrl: "https://hooks.test", secureCookies: true });
  await request(app).get("/api/inboxes").expect(401);
  await request(app).get("/api/inboxes/missing/stream").expect(401);
  await request(app).get("/api/inboxes").set("Authorization", "Bearer wrong").expect(401);
  const login = await request(app).post("/api/session").send({ token }).expect(200);
  const cookie = login.headers["set-cookie"]![0]!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Secure/);
  await request(app).get("/api/inboxes").set("Cookie", cookie).expect(200);
  const inbox = (await request(app).post("/api/inboxes").set("Authorization", "Bearer " + token).send({ name: "Private" }).expect(201)).body;
  await request(app).post("/api/inboxes").set("Cookie", cookie).set("Origin", "https://evil.test").send({ name: "CSRF" }).expect(403);
  await request(app).post("/hook/" + inbox.key).send({ captured: true }).expect(202);
});

test("rate limits return Retry-After; oversized payloads and malformed JSON are JSON errors", async () => {
  const app = createApp({ store: new FileStore(join(directory, "a.json")), requestsPerMinute: 1 });
  await request(app).get("/api/inboxes").expect(200);
  assert.ok((await request(app).get("/api/inboxes").expect(429)).headers["retry-after"]);
  const second = createApp({ store: new FileStore(join(directory, "b.json")) });
  await request(second).post("/hook/unknown").set("content-type", "text/plain").send("a".repeat(65537)).expect(413).expect("Content-Type", /json/);
  await request(second).post("/api/inboxes").set("content-type", "application/json").send("{bad").expect(400).expect("Content-Type", /json/);
});

test("schema baseline persists and distinguishes added, removed, and changed fields", async () => {
  const path = join(directory, "schema.json");
  const app = createApp({ store: new FileStore(path) });
  const inbox = (await request(app).post("/api/inboxes").send({ name: "Orders" })).body;
  await request(app).post("/hook/" + inbox.key).send({ total: 42, old: true }).expect(202);
  await request(app).post("/hook/" + inbox.key).send({ total: "42", currency: "USD" }).expect(202);
  const restarted = createApp({ store: new FileStore(path) });
  const events = (await request(restarted).get("/api/inboxes/" + inbox.id + "/events")).body;
  assert.deepEqual(events[0].schema.changes.map((change: { kind: string }) => change.kind).sort(), ["added", "removed", "type_changed"]);
  assert.equal(events[1].schema.changes.length, 0);
  assert.equal(events[0].schema.baselineEventId, events[1].id);
});

test("fingerprints escape keys, union array types, and bound deep payloads", () => {
  assert.deepEqual(inferShape({ items: [1, "a"] })["$/items/*"], ["number", "string"]);
  assert.ok(inferShape({ "a/b": 1, "*": true })["$/a~1b"]);
  assert.ok(inferShape({ "*": true })["$/~2"]);
  assert.deepEqual(compareShapes(inferShape({ n: 1 }), inferShape({ n: 2 })), []);
  assert.throws(() => inferShape(Array.from({ length: 2049 }, () => 0)));
});

test("concurrent first writes retain every inbox; caps and TTL are enforced", async () => {
  let now = Date.now();
  const store = new FileStore(join(directory, "bounded.json"), { maxInboxes: 2, maxEvents: 2, retentionMs: 1000, now: () => now });
  const app = createApp({ store });
  await Promise.all(["A", "B"].map((name) => request(app).post("/api/inboxes").send({ name }).expect(201)));
  const inboxes = await store.listInboxes();
  assert.equal(inboxes.length, 2);
  await request(app).post("/api/inboxes").send({ name: "C" }).expect(507);
  for (let i = 0; i < 3; i++) await request(app).post("/hook/" + inboxes[0]!.key).send({ n: i }).expect(202);
  assert.equal((await store.listEvents(inboxes[0]!.id)).length, 2);
  now += 2000;
  await store.prune();
  assert.equal((await store.listEvents(inboxes[0]!.id)).length, 0);
  assert.equal(JSON.parse(await readFile(join(directory, "bounded.json"), "utf8")).events.length, 0);
});

test("failed disk writes do not publish uncommitted memory or poison the queue", async () => {
  const path = join(directory, "blocked.json");
  const store = new FileStore(path);
  await store.load();
  await mkdir(path + ".tmp");
  const inbox = { id: "a", key: "a", name: "A", secret: "test", createdAt: new Date().toISOString() };
  await assert.rejects(store.createInbox(inbox));
  assert.equal((await store.listInboxes()).length, 0);
  await rm(path + ".tmp", { recursive: true });
  await store.createInbox(inbox);
  assert.equal((await store.listInboxes()).length, 1);
});

test("replay blocks private, mapped, reserved, credentialed and mixed-DNS destinations", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "0.0.0.0"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.throws(() => validateReplayUrl("http://[::1]/", new Set(["::1"])));
  assert.throws(() => validateReplayUrl("https://u:p@example.com/", new Set(["example.com"])));
  const url = validateReplayUrl("https://example.com/", new Set(["example.com"]));
  await assert.rejects(resolveReplayAddress(url, async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]));
  assert.deepEqual(await resolveReplayAddress(url, async () => [{ address: "8.8.8.8", family: 4 }]), { address: "8.8.8.8", family: 4 });
});
