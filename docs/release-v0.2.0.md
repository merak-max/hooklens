# HookLens v0.2.0

- Interactive, browser-only sandbox with explicit synthetic-data labeling and no outbound replay.
- Real local HTTP capture recording and repeatable recording script.
- Persisted structural schema baselines with added/removed/type-change inspection.
- Management bearer-token authentication and same-origin HttpOnly browser sessions.
- Direct-client rate limits, capture/storage caps, retention sweep, bounded write queue and SSE streams.
- Replay DNS validation, connection-address pinning, credential rejection and deadlines.
- Atomic store updates with failure rollback and a non-poisoning write queue.
- Reproducible signed-capture benchmarks, raw reports, architecture decisions and a volunteer trial guide.

Migration: network listeners and Docker now require a management token of at
least 24 characters. The capture limit is now 64 KiB. The file store retains up
to 1,000 events / 8 MiB and removes events older than seven days; preserve any
existing local history you need before upgrading. Existing inboxes get a schema
baseline on their next JSON object/array capture. This is still a single-owner,
single-process tool; atomic snapshots are not fsync durability.

The browser sandbox does not receive real webhook deliveries. No external-user
adoption, merged upstream contribution, or production latency SLO is claimed.
