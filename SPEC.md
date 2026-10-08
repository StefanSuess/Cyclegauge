# EasyKiroGauge specification

Status: approved discovery baseline; no application implemented. Evidence: macOS, Kiro 1.2.37, investigation dated 2026-10-08. See [data findings](docs/kiro-data-format.md).

## Purpose

Provide local credit tracking and, eventually, forecasts that distinguish account-wide consumption from the portion attributable to retained local sessions. Support a future cross-platform application for macOS, Windows, Ubuntu, and RHEL without requiring Kiro credentials or changing Kiro state.

## Data authority

1. **Account snapshots are the source of truth for current observed account usage.** Use the freshest valid, comparable account snapshot from the service-response logs or Kiro's cached usage. Display its as-of time, source, and freshness; a stale snapshot is not a live balance or final invoice.
2. **Session metering provides observed local daily attribution.** It may omit other devices, cloud work, deleted sessions, active turns, and unsupported formats. Never substitute this sum for account usage, remaining credits, or plan capacity.
3. Compare sources for reconciliation; never add an account snapshot or snapshot delta to session totals. Report differences as unexplained coverage, timing, account-association, or adjustment differences, not automatically missing billable work.
4. CLI `metering_usage[]` semantics are unresolved. Verify additive versus cumulative behavior for the applicable format/version before enabling its aggregation. Until then, report metering as present but uninterpreted, with no credit total derived from those entries.

## Required behavior for subsequent implementation

- Select the `CREDIT` resource and prefer `*WithPrecision` fields. Preserve decimal values without rounding until presentation. Do not confuse `INVOCATIONS`, token counts, or context percentages with billing units.
- Attribute accepted local turn summaries to their completion day in the configured IANA timezone; default to the device timezone, initially Europe/Berlin. Label this as completion-time attribution, not exact within-turn consumption timing.
- Keep billing boundaries in UTC. Prefer explicit reset timestamps over a computed calendar assumption.
- Persist observations in EasyKiroGauge-owned storage so future coverage can improve. Track observation time separately from ingestion time; re-reading an old cache must not make it fresh.
- Treat positive same-cycle snapshot differences as observed **net counter changes** over an interval. Daily consumption within an interval spanning days remains unknown. Do not interpolate by default or fill uncovered days with zero.
- Treat advancing reset dates as cycle-change evidence. A counter decrease alone is an anomaly, not proof of reset. Preserve adjustments, plan/account changes, and reset ambiguity.
- Keep plans, base credits, overages, bonuses, and add-on credits distinct. Unknown bonus schemas must not be folded into a fabricated remaining-credit balance.
- Preserve provenance, partial coverage, unsupported-format status, stale/conflicting observations, and unresolved account association. A missing value is not zero.
- Forecasting is a later milestone. It must disclose its observation window and coverage; insufficient coverage yields an unavailable forecast. Do not calculate a burn rate from sparse snapshot intervals as if they were complete daily measurements.

## Privacy and platform requirements

Follow [AGENTS.md](AGENTS.md). No credentials, raw transcript persistence, raw identifiers in diagnostics, telemetry of private data, or authenticated Kiro API calls. Billing-only normalized observations remain local and outside this repository.

macOS source locations and sample shapes were inspected. Windows, Ubuntu, and RHEL are **design targets, not verified platforms**. Support native path APIs, configurable data roots, Unicode/spaces, explicit timezone handling, and safe unavailable states. Do not disable Windows protections or RHEL SELinux to gain access.

## Current acceptance boundary

Deliver discovery documentation, architecture and roadmap, wholly synthetic input/expected-output fixtures, and fixture validation only. No UI, daemon, collector, persistence implementation, authenticated integration, or forecast algorithm is part of this phase.
