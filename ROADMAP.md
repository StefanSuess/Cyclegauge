# EasyKiroGauge roadmap

No application implementation is included in the discovery baseline.

## Milestone 0 — Discovery and data contracts (this change)

- Document locally observed Kiro 1.2.37 formats and their limitations.
- Establish account snapshots as authoritative for current observed account usage and sessions as local attribution only.
- Add invented fixtures, expected outcomes, and a fixture-only validator.
- Establish privacy rules and mark Windows, Ubuntu, and RHEL unverified.

## Milestone 1 — Read-only account snapshot collector and local persistence

Implement only after a new implementation request. Start with the observed `q-client.log` account-response format; support the cached snapshot only after its database read safety is proven. Do not require session parsing to obtain current account usage.

Deliverables:

- Platform-aware source discovery and explicit root override; no Kiro commands, credentials, authenticated requests, or changes to Kiro settings.
- Allowlisted `CREDIT` snapshot extraction with decimal preservation, reset timestamp, source as-of time, reduced-precision/unsupported status, and safe account partitioning.
- An EasyKiroGauge-owned SQLite store for normalized snapshots, import cursors, deduplication, and quality evidence. No raw logs, sessions, identifiers, or private paths persisted.
- Restart-safe ingestion with rotation/truncation detection, partial-record handling, freshness, conflicts, and out-of-order observations. Persist gaps as unknown.
- A local query/export contract containing billing fields and quality only; no application UI or forecast required for this milestone.

Acceptance:

- Synthetic tests cover repeated imports/restarts, two account partitions, stale cache rereads, conflicting snapshots, unknown fields/resources, parse failures, precision fallback, same-cycle adjustments, and cycle changes across gaps.
- Filesystem tests demonstrate zero writes to source files and directories, including SQLite sidecars; use generated test data, never production sessions in CI. If safe database access is unavailable, logs still work and cache status explains the limitation.
- Persistence writes only to the app-owned location and emits no private diagnostics, including on failures.
- Snapshot interval differences are never presented as known daily consumption. Cross-cycle counters are not subtracted.
- Validate on macOS first. Windows, Ubuntu, and RHEL remain explicitly unsupported/unverified until their platform acceptance checks in ARCHITECTURE.md pass on actual hosts or appropriate environments. Do not mark one Linux distribution verified from another's results.

## Milestone 2 — Observed local attribution and semantic verification

Validate IDE summary interpretation, account association, stable identities, migration duplicates, and turn updates. **Resolve additive versus cumulative CLI metering semantics before enabling any CLI total.** Add local-calendar completion-time grouping with DST tests and explicit incomplete coverage. Keep local totals separate from account balances and snapshot interval changes.

## Milestone 3 — Forecasting and presentation

Choose a UI/packaging stack and forecast method only after data collection quality is measured. Define minimum coverage, staleness, and forecast uncertainty criteria. Show unavailable estimates when evidence is insufficient; expose unexplained reconciliation differences without fabricating consumption on missing days.

## Remaining gates

Unknown populated bonus/add-on schemas, live SQLite/WAL safety, service update latency, format stability/retention, historical timezone ambiguity, account association, and cross-format duplicates require further evidence. Public billing documentation is not a versioned local-storage API contract.
