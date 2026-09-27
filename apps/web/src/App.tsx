import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, isDemo, generateSample, subscribeDemo } from "./demo";

type Inbox = { id: string; name: string; key: string; secret: string; createdAt: string; endpoint?: string };
type Signature = { provided: boolean; valid: boolean };
type HookEvent = {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  contentType: string;
  receivedAt: string;
  signature: Signature;
  schema?: { baselineEventId: string; changes: { path: string; kind: string; before?: string[]; after?: string[] }[] };
  schemaError?: string;
};

function signatureLabel(signature: Signature) {
  if (!signature.provided) return "Unsigned";
  return signature.valid ? "Verified" : "Invalid";
}

function prettyBody(body: unknown) {
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
}

export default function App() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [events, setEvents] = useState<HookEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("");
  const [signature, setSignature] = useState("");
  const [destination, setDestination] = useState("");
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [token, setToken] = useState("");

  const selectedInbox = inboxes.find((inbox) => inbox.id === selectedId);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];
  const endpoint = selectedInbox?.endpoint ?? (selectedInbox ? `${window.location.origin}/hook/${selectedInbox.key}` : "");

  const loadInboxes = useCallback(async () => {
    const response = await apiFetch("/api/inboxes");
    if (response.status === 401) { setNeedsAuth(true); return; }
    if (!response.ok) throw new Error("Could not load inboxes.");
    const items = await response.json() as Inbox[];
    setInboxes(items);
    setSelectedId((current) => current || items[0]?.id || "");
  }, []);

  const loadEvents = useCallback(async () => {
    if (!selectedId) return setEvents([]);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (method) params.set("method", method);
    if (signature) params.set("signature", signature);
    const response = await apiFetch(`/api/inboxes/${selectedId}/events?${params}`);
    if (response.status === 401) { setNeedsAuth(true); return; }
    if (!response.ok) throw new Error("Could not load events.");
    const items = await response.json() as HookEvent[];
    setEvents(items);
    setSelectedEventId((current) => items.some((event) => event.id === current) ? current : items[0]?.id || "");
  }, [selectedId, query, method, signature]);

  useEffect(() => { void loadInboxes().catch((error) => setNotice(String(error))); }, [loadInboxes]);
  useEffect(() => { void loadEvents().catch((error) => setNotice(String(error))); }, [loadEvents]);
  useEffect(() => {
    if (!selectedId) return;
    if (isDemo) return subscribeDemo(() => { void loadEvents(); });
    const source = new EventSource(`/api/inboxes/${selectedId}/stream`);
    source.addEventListener("ready", () => { setConnected(true); void loadEvents().catch((error) => setNotice(String(error))); });
    source.addEventListener("webhook", () => { void loadEvents().catch((error) => setNotice(String(error))); });
    source.onerror = () => setConnected(false);
    return () => { source.close(); setConnected(false); };
  }, [selectedId, loadEvents]);

  const curlCommand = useMemo(() => endpoint ? `curl -X POST '${endpoint}' \\\n  -H 'content-type: application/json' \\\n  -d '{"event":"order.created","id":"ord_42"}'` : "", [endpoint]);

  async function createInbox(event: React.FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/api/inboxes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const inbox = await response.json() as Inbox;
    if (!response.ok) return setNotice("Could not create the inbox.");
    setInboxes((current) => [inbox, ...current]);
    setSelectedId(inbox.id);
    setName("");
    setNotice(isDemo ? "Sandbox inbox created. Generate a synthetic event below." : "Inbox created. Send a webhook to the generated endpoint.");
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setNotice(`${label} copied.`);
  }

  async function replay() {
    if (!selectedEvent) return;
    const response = await apiFetch(`/api/events/${selectedEvent.id}/replay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    });
    const result = await response.json() as { error?: string; status?: number };
    setNotice(response.ok ? `Replay delivered with HTTP ${result.status}.` : result.error ?? "Replay failed.");
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    try {
      const response = await apiFetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      await response.json();
      if (!response.ok) return setNotice("Login failed. Check your token or try again later.");
      setToken(""); setNeedsAuth(false); setNotice(""); await loadInboxes();
    } catch { setNotice("Cannot reach the server."); }
  }

  if (needsAuth) return <main className="hero"><div><h1>Unlock HookLens.</h1><p>Enter the management token configured on your server. Webhook capture uses separate inbox URLs.</p><form className="create" onSubmit={login}><label htmlFor="token">Management token</label><input id="token" type="password" value={token} onChange={(event) => setToken(event.target.value)} required autoComplete="current-password" /><button>Sign in</button></form><p role="status">{notice}</p></div></main>;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="HookLens home"><span>H</span> HookLens</a>
        <div className="status"><i className={connected ? "online" : ""} /> {connected ? "Live stream connected" : "Waiting for inbox"}</div>
        <a className="github" href="https://github.com/merak-max/hooklens" target="_blank" rel="noreferrer">GitHub ↗</a>
      </header>
      {isDemo && <aside className="demoBanner"><strong>Interactive sandbox · simulated events</strong><span>No real webhooks, outbound replay, or shared storage. Data stays in this tab and resets on reload. Five inboxes and 50 events maximum.</span></aside>}

      <section id="top" className="hero">
        <div>
          <p className="eyebrow">Webhook inspection workspace</p>
          <h1>See exactly what your integrations send.</h1>
          <p>Capture requests, inspect payload drift, validate HMAC signatures, search deliveries, and replay to approved destinations.</p>
        </div>
        <form className="create" onSubmit={(event) => { void createInbox(event).catch(() => setNotice("Cannot reach the server.")); }}>
          <label htmlFor="inbox-name">New inbox</label>
          <div><input id="inbox-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Billing events" maxLength={80} required /><button>Create endpoint</button></div>
        </form>
      </section>

      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}

      {inboxes.length === 0 ? (
        <section className="empty">
          <span>01</span><h2>Create your first webhook inbox.</h2>
          <p>HookLens generates an endpoint and signing secret, then streams every request into this workspace.</p>
        </section>
      ) : (
        <section className="workspace">
          <aside className="sidebar">
            <p className="sectionLabel">Inboxes</p>
            {inboxes.map((inbox) => <button key={inbox.id} className={inbox.id === selectedId ? "inbox active" : "inbox"} onClick={() => setSelectedId(inbox.id)}><span>{inbox.name}</span><small>{inbox.key.slice(0, 8)}</small></button>)}
          </aside>

          <div className="content">
            <section className="endpointPanel">
              <div><p className="sectionLabel">Active endpoint</p><h2>{selectedInbox?.name}</h2></div>
              <div className="endpoint"><code>{endpoint}</code><button onClick={() => void copy(endpoint, "Endpoint")}>Copy</button></div>
              {isDemo ? <button onClick={() => generateSample(selectedId)}>Generate sample webhook</button> : <details><summary>Quick request and signing secret</summary><pre>{curlCommand}</pre><div className="secret"><code>{selectedInbox?.secret}</code><button onClick={() => void copy(selectedInbox?.secret ?? "", "Secret").catch(() => setNotice("Clipboard unavailable."))}>Copy secret</button></div></details>}
            </section>

            <section className="filters" aria-label="Event filters">
              <input aria-label="Search events" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search payloads or headers" />
              <select aria-label="Filter by method" value={method} onChange={(event) => setMethod(event.target.value)}><option value="">All methods</option><option>POST</option><option>PUT</option><option>PATCH</option><option>GET</option></select>
              <select aria-label="Filter by signature" value={signature} onChange={(event) => setSignature(event.target.value)}><option value="">All signatures</option><option value="valid">Verified</option><option value="invalid">Invalid</option><option value="unsigned">Unsigned</option></select>
              <span>{events.length} event{events.length === 1 ? "" : "s"}</span>
            </section>

            <div className="eventGrid">
              <section className="eventList" aria-label="Webhook events">
                {events.length === 0 && <div className="noEvents"><b>No matching events</b><span>Send a request or adjust the filters.</span></div>}
                {events.map((event) => <button key={event.id} className={event.id === selectedEvent?.id ? "eventRow selected" : "eventRow"} onClick={() => setSelectedEventId(event.id)}><span className={`method ${event.method.toLowerCase()}`}>{event.method}</span><span><b>{typeof event.body === "object" ? JSON.stringify(event.body) : String(event.body).slice(0, 50) || "Empty payload"}</b><small>{new Date(event.receivedAt).toLocaleString()}</small></span><em className={event.signature.valid ? "verified" : event.signature.provided ? "invalid" : "unsigned"}>{signatureLabel(event.signature)}</em></button>)}
              </section>

              <section className="inspector">
                {selectedEvent ? <>
                  <div className="inspectorHead"><div><p className="sectionLabel">Request inspector</p><h3>{selectedEvent.method} <span>{selectedEvent.path}</span></h3></div><span className={selectedEvent.signature.valid ? "badge verified" : selectedEvent.signature.provided ? "badge invalid" : "badge unsigned"}>{signatureLabel(selectedEvent.signature)}</span></div>
                  <h4>Payload</h4><pre>{prettyBody(selectedEvent.body)}</pre>
                  <h4>Schema drift</h4>
                  {selectedEvent.schema ? <div className="drift" role="status">{selectedEvent.schema.changes.length ? <><b>{selectedEvent.schema.changes.length} structural changes</b><ul>{selectedEvent.schema.changes.map((change) => <li key={change.path}><code>{change.path}</code>: {change.kind.replaceAll("_", " ")} {change.before?.join(" | ")}{change.before && " → "}{change.after?.join(" | ")}</li>)}</ul></> : <span>Matches the inbox baseline.</span>}</div> : <p className="hint">{selectedEvent.schemaError ?? "Schema analysis applies to JSON objects and arrays."}</p>}
                  <h4>Headers</h4><div className="headers">{Object.entries(selectedEvent.headers).map(([key, value]) => <div key={key}><code>{key}</code><span>{value}</span></div>)}</div>
                  <h4>Guarded replay</h4><div className="replay"><input aria-label="Replay destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="https://allowed-host.example/webhook" /><button onClick={() => void replay().catch(() => setNotice("Cannot reach the server."))}>Replay</button></div><small className="hint">{isDemo ? "Outbound replay is disabled in this sandbox." : "Only allowlisted public destinations; DNS addresses are validated and pinned."}</small>
                </> : <div className="noSelection">Select an event to inspect its details.</div>}
              </section>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
