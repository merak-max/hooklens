# Security policy

Please report vulnerabilities through GitHub private vulnerability reporting rather than opening a public issue.

HookLens accepts untrusted HTTP requests by design. Deploy it behind TLS, keep
inbox URLs and signing secrets private, configure a strong `HOOKLENS_TOKEN`,
and set `PUBLIC_BASE_URL` and `COOKIE_SECURE=true` for HTTPS. The token grants
single-owner access to every inbox; it is not per-user authorization. Rotate it
to revoke access. Open SSE connections reauthenticate within five minutes.

Replay has an empty allowlist by default. It rejects credentials and non-public
IP addresses, checks all DNS results, pins connections to a validated address,
does not follow redirects, and has a five-second deadline. Keep the allowlist
narrow and add network-level egress restrictions: address classification is not
a substitute for a firewall. See [the threat model](docs/replay-threat-model.md).

Rate limits and storage/SSE bounds are process-local. Unauthenticated local mode rejects non-loopback
Host headers to reduce DNS-rebinding exposure. Authenticated deployments must
still configure the canonical public origin.

Behind a proxy, apply per-client limits at the edge; the API does not trust forwarded IP headers.
Do not expose this as a public multi-tenant service without separate per-user
authorization and quotas. The hosted sandbox uses synthetic browser-local data
and cannot send or receive real webhooks.

The file store provides atomic snapshots, not fsync/crash-durability guarantees.
Only one process may own a file. Capture data and headers can contain secrets;
limit access, review retention, and never publish real payloads in bug reports.
