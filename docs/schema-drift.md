# Structural schema-drift detection

The first captured JSON object or array establishes the inbox baseline. Later
JSON captures are compared against it for added paths, removed paths, and type
changes. The baseline is stored alongside the inbox and survives restarts and
event-retention eviction. It stores types and paths, not example values.

Example: `{"total":4200}` followed by `{"total":"4200","currency":"USD"}`
reports a number-to-string change at `$/total` and an added `$/currency`.
Captures are still accepted: this is an inspection signal, not schema enforcement.

Array entries use a wildcard path and union their observed types. Paths escape
`~`, `/` and literal `*` keys as `~0`, `~1`, and `~2`. Analysis stops above depth
12 or 2,048 visited values; the capture is retained with an analysis-limit notice.
Non-JSON and primitive payloads are captured without schema analysis.

Limitations: an optional field disappearing, an empty array becoming populated,
or mixed event families in one inbox can trigger a change. Numeric ranges,
formats, enums, semantic validity, and JSON Schema validation are not implemented.
Use one event family per inbox. Create a new inbox to establish a new baseline;
an approval/reset workflow is intentionally left for a future version.
