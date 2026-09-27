export const isDemo = import.meta.env.VITE_DEMO === "true";
type DemoInbox = { id: string; name: string; key: string; secret: string; createdAt: string; endpoint: string };
type DemoEvent = { id: string; inboxId: string; method: string; path: string; headers: Record<string, string>; body: unknown; contentType: string; receivedAt: string; signature: { provided: boolean; valid: boolean }; schema: { baselineEventId: string; changes: { path: string; kind: string; before?: string[]; after?: string[] }[] } };
const inboxes: DemoInbox[] = [];
const events: DemoEvent[] = [];
const updates = new EventTarget();
let lastSample = 0;

export function generateSample(inboxId: string) {
  if (Date.now() - lastSample < 500) return;
  const inbox = inboxes.find((item) => item.id === inboxId);
  if (!inbox) return;
  lastSample = Date.now();
  const first = [...events].reverse().find((event) => event.inboxId === inboxId);
  const drifted = Boolean(first);
  const id = crypto.randomUUID();
  events.unshift({
    id, inboxId, method: "POST", path: "/sample/order", contentType: "application/json",
    headers: { "content-type": "application/json", "x-hooklens-demo": "synthetic — no HTTP delivery or signature verification" },
    body: { event: "order.created", id: "ord_demo", total: drifted ? "4200" : 4200, ...(drifted ? { currency: "USD" } : {}) },
    receivedAt: new Date().toISOString(), signature: { provided: false, valid: false },
    schema: { baselineEventId: first?.id ?? id, changes: drifted ? [{ path: "$/total", kind: "type_changed", before: ["number"], after: ["string"] }, { path: "$/currency", kind: "added", after: ["string"] }] : [] },
  });
  events.splice(50);
  updates.dispatchEvent(new Event("sample"));
}
export function subscribeDemo(callback: () => void) {
  updates.addEventListener("sample", callback);
  return () => updates.removeEventListener("sample", callback);
}
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!isDemo) return fetch(path, init);
  const url = new URL(path, "https://sandbox.invalid");
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/api/inboxes") {
    if (!init?.method || init.method === "GET") return json(inboxes);
    if (inboxes.length >= 5) return json({ error: "Sandbox limit: five inboxes. Reload to reset." }, 429);
    const name = String(JSON.parse(String(init.body)).name ?? "").trim().slice(0, 80);
    if (!name) return json({ error: "Inbox name is required." }, 400);
    const inbox = { id: crypto.randomUUID(), name, key: "synthetic", secret: "No real signing secret in the sandbox", createdAt: new Date().toISOString(), endpoint: "Sandbox only — not an HTTP capture endpoint" };
    inboxes.unshift(inbox);
    return json(inbox, 201);
  }
  const match = url.pathname.match(/^\/api\/inboxes\/([^/]+)\/events$/);
  if (match) return json(events.filter((event) => event.inboxId === match[1]
    && (!url.searchParams.get("q") || JSON.stringify(event).toLowerCase().includes(url.searchParams.get("q")!.toLowerCase()))
    && (!url.searchParams.get("method") || event.method === url.searchParams.get("method"))
    && (!url.searchParams.get("signature") || url.searchParams.get("signature") === "unsigned")));
  return json({ error: "The sandbox never sends outbound replay requests. Run HookLens locally for real HTTP capture and replay." }, 403);
}
