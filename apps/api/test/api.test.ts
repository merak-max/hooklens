import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { signPayload } from "../src/signature.js";
import { FileStore } from "../src/store.js";

let directory: string;

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "hooklens-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function setup(options: { allowedHosts?: Set<string>; fetchImpl?: typeof fetch } = {}) {
  return createApp({ store: new FileStore(join(directory, "store.json")), allowedReplayHosts: options.allowedHosts, fetchImpl: options.fetchImpl, publicBaseUrl: "https://hooks.test" });
}

test("creates an inbox and captures a signed JSON webhook", async () => {
  const app = setup();
  const created = await request(app).post("/api/inboxes").send({ name: "Payments" }).expect(201);
  assert.match(created.body.endpoint, /^https:\/\/hooks\.test\/hook\//);
  const payload = Buffer.from(JSON.stringify({ invoice: "inv_42", paid: true }));
  await request(app)
    .post(new URL(created.body.endpoint).pathname)
    .set("content-type", "application/json")
    .set("x-hooklens-signature", signPayload(created.body.secret, payload))
    .send(payload.toString("utf8"))
    .expect(202);
  const events = await request(app).get(`/api/inboxes/${created.body.id}/events`).expect(200);
  assert.equal(events.body.length, 1);
  assert.deepEqual(events.body[0].body, { invoice: "inv_42", paid: true });
  assert.deepEqual(events.body[0].signature, { provided: true, valid: true });
});

test("filters captured events by text, method, and signature state", async () => {
  const app = setup();
  const inbox = (await request(app).post("/api/inboxes").send({ name: "Deployments" })).body;
  await request(app).post(`/hook/${inbox.key}`).send("production ready").expect(202);
  await request(app).put(`/hook/${inbox.key}`).set("x-hooklens-signature", "sha256=bad").send("staging").expect(202);
  assert.equal((await request(app).get(`/api/inboxes/${inbox.id}/events?q=production`)).body.length, 1);
  assert.equal((await request(app).get(`/api/inboxes/${inbox.id}/events?method=PUT`)).body.length, 1);
  assert.equal((await request(app).get(`/api/inboxes/${inbox.id}/events?signature=invalid`)).body.length, 1);
});

test("persists inboxes and events across store instances", async () => {
  const path = join(directory, "store.json");
  const first = createApp({ store: new FileStore(path), publicBaseUrl: "https://hooks.test" });
  const inbox = (await request(first).post("/api/inboxes").send({ name: "Persistent" })).body;
  await request(first).post(`/hook/${inbox.key}`).send({ retained: true }).expect(202);
  const second = createApp({ store: new FileStore(path) });
  assert.equal((await request(second).get("/api/inboxes")).body.length, 1);
  assert.equal((await request(second).get(`/api/inboxes/${inbox.id}/events`)).body.length, 1);
});

test("blocks unapproved replay hosts and forwards to an allowlisted host", async () => {
  let replayedBody = "";
  const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    replayedBody = String(init?.body);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const app = setup({ allowedHosts: new Set(["example.com"]), fetchImpl });
  const inbox = (await request(app).post("/api/inboxes").send({ name: "Replay" })).body;
  const event = (await request(app).post(`/hook/${inbox.key}`).send("deliver me")).body;
  await request(app).post(`/api/events/${event.eventId}/replay`).send({ destination: "http://127.0.0.1/receive" }).expect(403);
  const replay = await request(app).post(`/api/events/${event.eventId}/replay`).send({ destination: "https://example.com/receive" }).expect(200);
  assert.equal(replay.body.status, 204);
  assert.equal(replayedBody, "deliver me");
});
