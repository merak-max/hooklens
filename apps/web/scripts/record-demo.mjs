import { chromium } from "@playwright/test";
import { createApp } from "../../api/dist/app.js";
import { FileStore } from "../../api/dist/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "hooklens-recording-"));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const app = createApp({ store: new FileStore(join(directory, "store.json")), webDist: fileURLToPath(new URL("../dist", import.meta.url)) });
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: directory, size: { width: 1280, height: 900 } } });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByLabel("New inbox").fill("Order deliveries");
  await page.getByRole("button", { name: "Create endpoint" }).click();
  await page.locator(".workspace").waitFor();
  await page.locator(".notice").click();
  await page.locator(".workspace").scrollIntoViewIfNeeded();
  const [inbox] = await (await fetch(base + "/api/inboxes")).json();
  for (const body of [{ event: "order.created", total: 4200 }, { event: "order.created", total: "4200", currency: "USD" }]) {
    await page.waitForTimeout(1600);
    const payload = JSON.stringify(body);
    const response = await fetch(base + "/hook/" + inbox.key, { method: "POST", headers: { "content-type": "application/json", "x-hooklens-signature": "sha256=" + createHmac("sha256", inbox.secret).update(payload).digest("hex") }, body: payload });
    if (response.status !== 202) throw new Error("Recording capture failed.");
    await page.getByRole("button", { name: "currency" in body ? /currency/ : /order.created/ }).first().click();
    await page.waitForTimeout(1800);
  }
  await page.getByText("2 structural changes").waitFor();
  await page.screenshot({ path: join(root, "docs/hooklens-dashboard.png"), fullPage: true });
  const video = await page.video().path();
  await context.close();
  execFileSync("ffmpeg", ["-y", "-i", video, "-vf", "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0", join(root, "docs/hooklens-live.gif")], { stdio: "ignore" });
  console.log("Recorded real local HTTP capture and schema drift (synthetic payloads). No sandbox simulation used.");
} finally {
  await browser.close();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
