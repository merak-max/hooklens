import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { FileStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const authToken = process.env.HOOKLENS_TOKEN;
if (!["127.0.0.1", "::1", "localhost"].includes(host) && !authToken) throw new Error("HOOKLENS_TOKEN is required outside loopback.");
const repositoryDataFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/hooklens.json");
const store = new FileStore(process.env.HOOKLENS_DATA_FILE ? resolve(process.env.HOOKLENS_DATA_FILE) : repositoryDataFile);
const allowedReplayHosts = new Set((process.env.REPLAY_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean));
const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : resolve("apps/web/dist");

const pruneTimer = setInterval(() => { void store.prune().catch(() => console.error("Retention cleanup failed.")); }, 60000);
pruneTimer.unref();
const server = createApp({ store, allowedReplayHosts, webDist, authToken, publicBaseUrl: process.env.PUBLIC_BASE_URL, secureCookies: process.env.COOKIE_SECURE === "true" }).listen(port, host, () => {
  console.log(`HookLens listening on http://${host}:${port}`);
});
server.headersTimeout = 10000;
server.requestTimeout = 15000;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  clearInterval(pruneTimer);
  server.close(() => process.exit(0));
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
});
