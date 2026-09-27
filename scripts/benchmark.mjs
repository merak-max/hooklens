import { fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, platform, arch, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createApp } from "../apps/api/dist/app.js";
import { FileStore } from "../apps/api/dist/store.js";

const token = "benchmark-only-token-not-for-deployment";
if (process.argv.includes("--server")) {
  const app = createApp({ store: new FileStore(join(process.env.HOOKLENS_BENCH_DIR, "store.json")), authToken: token, requestsPerMinute: 1000000 });
  const server = app.listen(0, "127.0.0.1", () => process.send({ url: "http://127.0.0.1:" + server.address().port }));
  process.on("message", () => process.send({ maxRssKiB: process.resourceUsage().maxRSS }));
} else {
  const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [process.argv[2 + i * 2], process.argv[3 + i * 2]]));
  const requests = Number(args["--requests"] ?? 3000), warmup = Number(args["--warmup"] ?? 1000), concurrency = Number(args["--concurrency"] ?? 4);
  if (![requests, warmup, concurrency].every(Number.isSafeInteger) || requests < 1 || warmup < 0 || concurrency < 1 || concurrency > 64) throw new Error("Invalid workload.");
  const directory = await mkdtemp(join(tmpdir(), "hooklens-benchmark-"));
  const child = fork(fileURLToPath(import.meta.url), ["--server"], { env: { ...process.env, HOOKLENS_BENCH_DIR: directory }, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  try {
    const [{ url }] = await once(child, "message");
    const created = await fetch(url + "/api/inboxes", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ name: "Synthetic benchmark" }) });
    if (!created.ok) throw new Error("Could not initialize benchmark inbox.");
    const inbox = await created.json();
    const body = JSON.stringify({ event: "order.created", id: "ord_benchmark", amount: 4200, currency: "USD", customer: { id: "cus_synthetic" } });
    const signature = "sha256=" + createHmac("sha256", inbox.secret).update(body).digest("hex");
    const run = async (count) => {
      let next = 0, failures = 0;
      const latencies = [], ids = new Set();
      const started = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next++ < count) {
          const start = performance.now();
          try {
            const response = await fetch(url + "/hook/" + inbox.key, { method: "POST", headers: { "content-type": "application/json", "x-hooklens-signature": signature }, body, signal: AbortSignal.timeout(10000) });
            const text = await response.text();
            const result = JSON.parse(text);
            if (response.status !== 202 || !result.accepted || !result.eventId || ids.has(result.eventId)) failures++;
            ids.add(result.eventId);
          } catch { failures++; } finally { latencies.push(performance.now() - start); }
        }
      }));
      return { latencies: latencies.sort((a, b) => a - b), failures, elapsedMs: performance.now() - started };
    };
    if ((await run(warmup)).failures) throw new Error("Warmup failed.");
    const measured = await run(requests);
    const statsPromise = once(child, "message"); child.send("stats");
    const [stats] = await statsPromise;
    const persisted = JSON.parse(await readFile(join(directory, "store.json"), "utf8"));
    const percentile = (p) => measured.latencies[Math.ceil(requests * p) - 1];
    const report = { dateUtc: new Date().toISOString(), node: process.version, platform: platform() + "/" + arch(), logicalCpus: cpus().length, serverProcess: "separate child on same host", persistence: "bounded JSON snapshots; atomic rename, no fsync", signedPayloadBytes: Buffer.byteLength(body), schemaAnalysis: true, retentionCap: 1000, requests, warmup, concurrency, failures: measured.failures, elapsedSeconds: measured.elapsedMs / 1000, requestsPerSecond: requests / (measured.elapsedMs / 1000), p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: measured.latencies.at(-1), retainedEvents: persisted.events.length, allRetainedSignaturesValid: persisted.events.every((event) => event.signature.valid), serverMaxRssKiB: stats.maxRssKiB };
    if (!report.allRetainedSignaturesValid || report.retainedEvents !== Math.min(1000, requests + warmup)) throw new Error("Stored outcomes failed validation.");
    console.log(JSON.stringify(report, null, 2));
    if (args["--output"]) { await mkdir(dirname(args["--output"]), { recursive: true }); await writeFile(args["--output"], JSON.stringify(report, null, 2) + "\n"); }
    if (measured.failures) process.exitCode = 1;
  } finally {
    const exited = once(child, "exit"); child.kill(); await exited;
    await rm(directory, { recursive: true, force: true });
  }
}
