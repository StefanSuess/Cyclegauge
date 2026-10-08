# EasyKiroGauge architecture

Status: design only. [SPEC.md](SPEC.md) defines authority; [data findings](docs/kiro-data-format.md) distinguish evidence from assumptions.

## Data flow and trust boundaries

```mermaid
flowchart LR
  K[Kiro account logs and usage cache] --> R[Read-only source adapters]
  S[Local session metering] --> R
  R --> P[Allowlisted billing projection]
  P --> A[Account snapshots]
  P --> E[Observed local events]
  A --> D[EasyKiroGauge-owned local store]
  E --> D
  D --> V[Account view and local attribution with coverage]
```

Account snapshots determine current observed account usage. Local events explain some consumption by completion date. They are separate records and views; neither is added to the other. All components run locally. No UI/runtime/database library has been selected or implemented.

## Boundaries and proposed interfaces

- **Discovery:** platform-specific candidates plus an explicit root override. Check existence and access without starting Kiro. Do not traverse session source snapshots or follow symlinks outside a selected root.
- **Read-only adapters:** separate version/shape-aware adapters for `GetUsageLimitsCommand` log envelopes, notification cache JSON, IDE `usage_summary`, and CLI turn metadata. Adapter results are accepted projections or fixed diagnostic/status codes; raw records never leave the adapter.
- **AccountSnapshot:** device-local opaque account partition when continuity can be established, source kind, observed-at time with timestamp confidence, ingested-at time, resource type, precise usage/limit and supported overage fields, reset-at UTC, provenance, and quality flags. No raw envelope, identity, request data, or unknown arrays are retained.
- **LocalUsageEvent:** opaque local deduplication key, source/format, completion timestamp, credit amount only when interpretation is supported, and interpretation/coverage flags. Account association may be unknown; do not silently attach historical sessions to the currently logged-in account.
- **CoverageEvidence:** source availability, imported intervals, stale/ambiguous/conflicting data, missing metering, clock confidence, and reset evidence. No imported files does not mean zero usage.
- **Persistence:** an EasyKiroGauge-owned SQLite database in the OS application-data directory, outside Kiro and the repository. Store normalized billing observations, private opaque partition/deduplication keys, safe provenance tokens, and import cursors. Apply restrictive owner access/Windows ACLs; no raw records or private source paths. Keep any keyed pseudonymization secret device-local and outside diagnostics.

These are proposed internal contracts, not public APIs or implemented schemas. Fixtures express expected behavior without choosing an application language.

## Account snapshot collection and reconciliation

Validate the command envelope and success metadata where available; extract only the `CREDIT` breakdown. A cache record is a derivative snapshot with its own stored timestamp. Source freshness takes precedence over a fixed log-versus-cache ranking. Equivalent observations may be coalesced; equal-time conflicting values remain a conflict and do not silently overwrite one another.

Prefer precise fields, with an explicit reduced-precision flag when falling back to integer fields. Preserve omitted fields as unknown. Exclude unsupported non-credit resources. Conflicting nested/outer reset dates must be flagged rather than silently accepted. Empty observed bonus arrays do not establish the schema or balance semantics of populated arrays.

Maintain account isolation. Logs contain identity fields, but the cache and session records cannot be assumed to carry sufficient account identity. Use only a narrowly projected identifier in memory to derive a private device-local partition where permitted; do not persist the identifier. If continuity or cache association cannot be established, isolate the observation and suspend cross-observation deltas rather than merge accounts.

An advancing reset timestamp with comparable observations supports a cycle change; a decrease without such evidence is an adjustment/anomaly. Do not subtract counters across cycles. Even after a detected reset, the old cycle's tail and new cycle's early daily distribution can remain unknown. A same-cycle positive difference is a net interval change, not proof of gross billable work or a complete daily series.

## Session interpretation and ingestion safety

IDE summaries provide local completion-time attribution. Deduplicate by stable opaque event identity; avoid counting a summary and a representation of the same turn twice. Multiple same-unit entries in a previously unseen summary shape require semantic validation before summing.

CLI `metering_usage[]` may contain additive entries or successive cumulative values. **Do not sum them until semantics are verified.** Establish this from authoritative implementation/documentation or a separately authorized controlled observation with stable turn identity and intermediate/final states. A monotonic list or agreement with one delayed account delta is insufficient. Record the verified version/shape and distinguish within-turn from between-turn accumulation. Until then, retain only a safe uninterpreted status. Repeated turn metadata is an upsert, not a new charge. No evidence currently proves cross-format deduplication.

Read text streams incrementally with bounded buffers; do not load arbitrary transcripts into error reporters. Accept only complete JSONL records, defer a partial trailing record, reject malformed records with fixed codes, and tolerate unknown fields without retaining them. Detect truncation, replacement, rotation, and out-of-order ingestion; checkpoints and deduplication must survive restarts. An overwritten session JSON must be parsed from a stable read or retried without logging its contents.

Kiro databases must never be copied, changed, or checkpointed. The investigation used `mode=ro&immutable=1` with no WAL present; immutable reads are not a proven live-database strategy. The first collector can operate from logs alone. Enable a cache database adapter only after tests prove no source/sidecar writes and correct handling of concurrent writers; otherwise report the cache unavailable. Do not use `query_only` as the sole write safeguard or ignore WAL contents as if current.

## Cross-platform design and verification matrix

| Target | Candidate IDE root | Candidate CLI database | Evidence / required validation |
| --- | --- | --- | --- |
| macOS | `~/Library/Application Support/Kiro` | `~/Library/Application Support/kiro-cli/data.sqlite3` | Paths and Kiro 1.2.37 data observed; collector, locking, rotation, and permissions not yet tested |
| Windows | `%APPDATA%\Kiro` | Discover or configure explicitly; no verified default | Unverified; test native/WSL separation, NTFS replacement/sharing, ACLs, drive/UNC paths, case and Unicode |
| Ubuntu | `${XDG_CONFIG_HOME:-~/.config}/Kiro` | `${XDG_DATA_HOME:-~/.local/share}/kiro-cli/data.sqlite3` | Inferred candidates only; test XDG overrides, permissions, atomic rename, watch behavior, packaging |
| RHEL | Same XDG candidates as Ubuntu | Same inferred XDG candidate | Unverified independently of Ubuntu; test supported versions, dependencies, SELinux denials, and filesystem behavior |

`~/.kiro/sessions` is observed on macOS; treat it as a candidate elsewhere, not a guarantee. Support explicit roots and separate source instances for multiple installations, containers, remote homes, and WSL. Do not merge host and guest histories implicitly. Record source timezone assumptions for offset-free logs; travel and DST can make historical timestamps ambiguous. Local days may last 23 or 25 hours; billing reset timestamps remain UTC.

Framework, packaging, live watcher strategy, and supported Windows/Linux release versions are deferred until collector feasibility is demonstrated on those targets.
