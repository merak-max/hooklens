import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { FileStore } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const repositoryDataFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/hooklens.json");
const store = new FileStore(process.env.HOOKLENS_DATA_FILE ? resolve(process.env.HOOKLENS_DATA_FILE) : repositoryDataFile);
const allowedReplayHosts = new Set((process.env.REPLAY_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean));
const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : resolve("apps/web/dist");

createApp({ store, allowedReplayHosts, webDist }).listen(port, () => {
  console.log(`HookLens listening on http://localhost:${port}`);
});
