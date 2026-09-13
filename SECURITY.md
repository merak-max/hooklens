# Security policy

Please report vulnerabilities through GitHub private vulnerability reporting rather than opening a public issue.

HookLens accepts untrusted HTTP requests by design. Deploy it behind TLS, keep inbox URLs and signing secrets private, set request-rate limits at the edge, and configure `REPLAY_ALLOWED_HOSTS` narrowly. Replay blocks loopback and private IP literals, but the allowlist remains the primary control.

Do not use the included development configuration as a public multi-tenant service without adding authentication, authorization, quotas, retention controls, and network-level egress restrictions.
