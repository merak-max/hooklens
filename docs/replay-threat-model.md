# Replay threat model

Replay turns user input into server-side network access. A hostname allowlist
alone does not stop a permitted DNS name from resolving to loopback, metadata
services, or private addresses. Validating DNS then allowing the HTTP library
to resolve it again also leaves a DNS-rebinding gap.

## Current request path

1. Require management authentication when a token is configured.
2. Parse the URL; allow HTTP(S), reject embedded credentials, require an exact
   configured hostname and reject private/reserved IP literals.
3. Resolve the hostname and reject the destination if **any** returned address
   is non-public, including IPv4-mapped IPv6 forms.
4. Supply the validated address to Node's connection lookup callback. The
   original URL continues to supply Host and TLS server-name verification.
5. Send only content type and the replay identifier, not captured authorization
   headers or cookies. Do not follow redirects. Stop after response headers.
6. Apply a five-second total DNS/connect/request deadline.

Tests cover private literals, mapped IPv6, mixed public/private DNS responses,
credentials, and allowlist rejection. Replay is disabled by default because the
allowlist is empty. The public browser sandbox performs **no outbound replay**.

## Remaining deployment responsibilities

Use an egress firewall denying internal networks and metadata endpoints. DNS/IP
classification is not a replacement for network policy, and an allowed public
service may itself expose sensitive functionality. Choose destinations you own,
use HTTPS, rotate the management token, and keep signing secrets private.

This is a single-owner tool, not a multi-tenant service. The token grants access
to every inbox. Rate limiting is process-local and uses the direct client IP;
forwarded headers are not trusted. A reverse proxy needs its own per-client
limits. Captured payloads may contain secrets; use synthetic data for demos.
