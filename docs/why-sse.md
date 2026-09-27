# Why SSE instead of WebSockets?

HookLens needs one-way delivery notifications: the server announces a capture;
the browser fetches the current retained event list. Creation, search and replay
are ordinary HTTP requests. A bidirectional socket protocol would add connection
and message handling without a current bidirectional requirement.

`EventSource` provides reconnect behavior and works with the same-origin,
HttpOnly management cookie. Management tokens are never put in stream URLs.
The stream sends a ready event, webhook events and a heartbeat every 20 seconds.
On both ready and webhook events the UI reloads retained history. This matters:
SSE notifications are not a durable queue, and a reconnect may miss messages.
There is no Last-Event-ID replay implementation or exactly-once delivery claim.

Each inbox allows ten streams; the process allows 100. A connection ends after
five minutes so the next reconnect rechecks authentication. Slow connections
are closed when writes encounter backpressure rather than accumulating an
unbounded response buffer. Clients recover by reconnecting and fetching history.

Tradeoffs: reconnects and notifications trigger list fetches; filtering and
history retention can hide older events. An ingress must disable response
buffering and allow streaming. Multiple API replicas would need shared storage
and fan-out; the current file store is deliberately single-process.

WebSockets would become useful for high-frequency bidirectional interaction.
For now, explicit HTTP commands plus server notifications keep the protocol small.
