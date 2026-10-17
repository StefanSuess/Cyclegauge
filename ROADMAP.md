# Cyclegauge roadmap

Current release: **0.7.0** beta (macOS, Windows, Ubuntu). Next: the 0.9.0 beta with the workspace audit, then 1.0.0; see [path to 1.0](docs/path-to-1.0.md). Milestones 0–3, 4A, 4B, 4C (0.4.1), 5 (0.5.0 usage chart) and 6 (0.7.0) are implemented; synthetic and local UI evidence is recorded in the per-milestone validation documents. Remaining work (session aggregation, Crew integration, Kiro SQLite access, usage-efficiency insights) is deferred and unauthorized. Sections labeled “approval” or “boundary” below are dated historical records and are superseded by later approvals where stated.

## Path to 1.0 — scope decision (approved 2026-10-17)

The maintainer approved the value-first plan in [path to 1.0](docs/path-to-1.0.md) (WP0). 1.0.0 is the first stable release and the first public announcement. Its scope is the current features plus the user-triggered workspace/ignore audit from #71 Capability A, on macOS, Windows and Ubuntu; RHEL and macOS Intel stay unsupported for 1.0. The audit has a time limit of about four weeks to a 0.9.0 beta tested by invited users; if it is not solid by the end of the beta, 1.0 ships without it. #71 Capabilities B–D are post-1.0.

Audit boundary: the audit runs only when the user invokes its command. It may enumerate bounded file metadata (relative path, type, size) under one chosen trusted local root, and may read only workspace ignore files (`.kiroignore` and the files named by the `kiroAgent.agentIgnoreFiles` setting) plus that setting's value. It reads no other file contents, follows no symlinks or junctions, writes nothing, persists nothing and sends nothing. Each work package still lands as its own reviewed PR; this decision does not approve merges, releases or outreach.

## Milestone 0 — Discovery and data contracts (complete)

- Document locally observed Kiro 1.2.37 formats and their limitations.
- Establish account snapshots as authoritative for current observed account usage and sessions as local attribution only.
- Add invented fixtures, expected outcomes, and a fixture-only validator.
- Establish privacy rules and mark Windows, Ubuntu, and RHEL unverified.

## Milestone 1 — Read-only account snapshot collector and local persistence

Implementation authorized and delivered as a TypeScript/Node.js CLI. Starts with the observed `q-client.log` account-response format; support the cached snapshot only after its database read safety is proven. Do not require session parsing to obtain current account usage.

Deliverables:

- Platform-aware source discovery and explicit root override; no Kiro commands, credentials, authenticated requests, or changes to Kiro settings.
- Allowlisted `CREDIT` snapshot extraction with decimal preservation, reset timestamp, source as-of time, reduced-precision/unsupported status, and safe account partitioning.
- A Cyclegauge-owned SQLite store for normalized snapshots, import cursors, deduplication, and quality evidence. No raw logs, sessions, identifiers, or private paths persisted.
- Restart-safe ingestion with rotation/truncation detection, partial-record handling, freshness, conflicts, and out-of-order observations. Persist gaps as unknown.
- A local query/export contract containing billing fields and quality only; no application UI or forecast required for this milestone.

Acceptance:

- Synthetic tests cover repeated imports/restarts, two account partitions, stale cache rereads, conflicting snapshots, unknown fields/resources, parse failures, precision fallback, same-cycle adjustments, and cycle changes across gaps.
- Filesystem tests demonstrate zero writes to source files and directories, including SQLite sidecars; use generated test data, never production sessions in CI. If safe database access is unavailable, logs still work and cache status explains the limitation.
- Persistence writes only to the app-owned location and emits no private diagnostics, including on failures.
- Snapshot interval differences are never presented as known daily consumption. Cross-cycle counters are not subtracted.
- Validate on macOS first. Windows, Ubuntu, and RHEL remain explicitly unsupported/unverified until their platform acceptance checks in ARCHITECTURE.md pass on actual hosts or appropriate environments. Do not mark one Linux distribution verified from another's results.

## Milestone 2 — Kiro IDE extension

- Reuse the log-only account collector and app-owned store inside a VS Code-compatible Kiro extension.
- Show remaining base credits in the status bar and open a local detail view on click.
- Import at activation; observe log changes and poll as a fallback without making old observations fresh.
- Test activation, refresh, stale status and detail rendering with invented fixtures; package and validate a VSIX in the locally installed Kiro IDE.
- Verify actual extension-host Node and `node:sqlite` behavior. Do not claim Windows, Ubuntu or RHEL support from macOS validation.

Local acceptance: VSIX 0.2.0 was installed through Kiro 1.2.56 on macOS. In a clean IDE window the status bar showed remaining base credits and its click opened the account details, including reset, allocation, original snapshot time, freshness and timezone-assumption warning. This confirms functional extension-host SQLite on this installation. Watcher-triggered updates were tested with synthetic files; live notification reliability remains covered by the polling fallback.

## Later milestone — Observed local attribution and semantic verification

Validate IDE summary interpretation, account association, stable identities, migration duplicates, and turn updates. **Resolve additive versus cumulative CLI metering semantics before enabling any CLI total.** Add local-calendar completion-time grouping with DST tests and explicit incomplete coverage. Keep local totals separate from account balances and snapshot interval changes.

## Milestone 3 — Account credit history and forecast engine (implemented)

Implement current-cycle billing-only snapshot history, supported daily observed net changes, interval average and coverage/unknown periods. Add independent cycle-to-date, exact rolling-seven-day and observation-window forecasts, conservative eligibility gates, conditional exhaustion day and budget comparison. Extend only the existing textual detail view; reuse persistence/account isolation. No CLI/Crew/session collectors, authenticated calls, cost recommendations or behavioral analysis.

Acceptance on 2026-10-10: 54 synthetic tests, typecheck, fixture validator and diff check passed. Version 0.3.0 VSIX allowlist inspection and installation passed. A clean local Kiro window rendered history, coverage and forecast labels and the expected insufficient-coverage explanation. Qualified forecast scenarios are tested synthetically; live forecast accuracy is not established. Full evidence and remaining limits: [Milestone 3 validation](docs/milestone-3-validation.md).

Progressive forecasting adjustment (2026-10-10): provisional estimates require three comparable snapshots over at least 48 hours and are labeled “Provisional estimate – limited history”. Regular forecasts preserve eight snapshots/seven days and take precedence. Both retain 36-hour maximum gaps, freshness, account/cycle/limit continuity and anomaly protections. Missing daily consumption stays unknown. All 59 synthetic tests, typecheck, fixture validator, diff and VSIX allowlist checks passed; VSIX 0.3.1 was installed and its policy v2/unavailable detail view verified locally in Kiro. Eligible provisional/regular views are tested synthetically; predictive accuracy remains unverified.

## Milestone 4 — Intelligent subscription & cost optimizer (4A accepted; 4B implemented)

The v0.3.2 baseline has 64 synthetic tests and a locally verified UI, as recorded in [Milestone 3 validation](docs/milestone-3-validation.md). Tasks 1–4 were approved and the independent M4A engine is implemented. The [checkpoint evidence](docs/milestone-4a-validation.md) records 113/113 synthetic tests, exact numerical results, remaining billing gates and synchronous break-even performance that must be addressed before UI integration. M4A was accepted with 113 passing tests; M4B is approved and implemented. Ordinary comparisons are separated from exhaustive exact break-even and the latter is excluded from the extension bundle. See [M4B validation](docs/milestone-4b-validation.md). Milestone 5 (0.5.0) is approved and implemented; see [M5 validation](docs/milestone-5-validation.md). The approved [design](docs/cost-optimizer-roadmap.md) and [plan](docs/superpowers/plans/2026-10-10-milestone-4.md) define the engine scope.

### Milestone 4A — Independent cost engine

- Pure TypeScript catalog validation, exact arithmetic, forecast/manual demand adapter, deterministic credit/expense simulation and finite strategy comparison.
- All standard consumer tiers; distinct Enterprise postpaid rules. Unknown custom/GovCloud prices and eligibility stay unavailable.
- Compare keep, immediate/next-reset upgrade, next-reset downgrade, temporary current-cycle upgrade and eligible additional capacity. Existing purchased inventory is separate from new expenditure.
- Model minimums, supported purchase steps/pack limits, rollover, expiration, consumption order and effective dates. Exact new-pack quantities remain gated while purchase increments are unverified; first-paid promotions/proration and consumed-pack restoration need separate evidence.
- Show before-reset needs separately from 1/3/6 full future billing cycles. Include sensitivity, conditional break-even references and savings against a feasible, matched keep-current baseline. No claim of a global optimum across arbitrary plan schedules.
- Acceptance: design cases A1–A15, synthetic arithmetic/conservation/ranking tests, original regression suite, typecheck, fixture validator, privacy/import checks and diff check.

### Milestone 4B — Recommendations in the existing extension

- Manual explicit plan, billing profile and purchased lots; no tier/balance inference from local limits. Session-only native input commands, with clear/reset and account-isolation handling.
- Extend the script-disabled details with current versus optimized estimated expenditure, before-reset shortfall, potential savings, conditional thresholds, add-on needs and transparent assumptions.
- Keep the daily-budget status bar. No purchases, automatic changes, authenticated requests or telemetry.
- Acceptance: A16 plus input/privacy tests, synthetic desktop/narrow/theme checks and VSIX allowlist verification. Preserve existing collector/Store/forecast behavior.

## Milestone 5 — Usage trajectory chart (implemented, 0.5.0)

Approved 2026-10-10 and implemented as a script-free inline-SVG view; see [M5 validation](docs/milestone-5-validation.md). The original proposal follows. It documented observed cumulative account counters, expected trajectory, lower/higher consumption scenarios, an uncalibrated scenario range, budget line, reset and conditional exhaustion markers, plus optional separate cost visualization. Unknown periods remain visibly distinct from observed endpoints and projected paths. No chart library was used. See [dashboard proposal and acceptance cases](docs/milestone-5-visual-dashboard.md).

## Milestone 6 — Cross-platform readiness (implemented, 0.7.0)

Delivered Windows storage (profile permissions for default locations, a verified owner-only NTFS DACL for a chosen location), the editor's per-extension storage folder as the extension default, CI on Windows, Ubuntu and macOS with one universal VSIX run in a real VS Code extension host on each, and a portable synthetic demo. Evidence: macOS is beta with maintainer synthetic-data testing in Kiro 1.2.56; Windows 11 Pro and Ubuntu 26 are beta, smoke-tested by the maintainer in native Kiro without itemised acceptance; RHEL and macOS Intel are unverified. Version numbers no longer track milestone numbers (see [versioning](docs/release-process.md#versioning)). The remaining gates are tracked in GitHub issues #58–#65.

## Future milestone — Usage efficiency insights

Separately validate non-content metadata for credit/session, turns, duration, selected models, trends and reliably marked spec/non-spec workflows. Resolve session semantics, account association, duplicates and coverage before aggregation. Require outcome evidence and defensible comparators; longer sessions and non-spec work are not inherently inefficient. Do not collect/analyze prompts, source code, conversations or tool outputs. Any content analysis requires a separate explicit privacy/security design review and opt-in authorization; current AGENTS privacy safeguards remain intact. This milestone adds no metadata analysis.

## Remaining gates

Unknown populated bonus/add-on schemas, live SQLite/WAL safety, service update latency, format stability/retention, historical timezone ambiguity, account association, and cross-format duplicates require further evidence. Public billing documentation is not a versioned local-storage API contract.

## Milestone 1 delivery and remaining gates

Implemented log collector, exact billing projection, device-local account partitioning, owned SQLite store, restart deduplication/full rescans, rotation/truncation/source-change evidence, partial/malformed handling, timezone ambiguity, freshness/conflicts and CLI base-credit allocation. Tests are wholly synthetic, including real filesystem and SQLite operations in app-owned temporary directories. See README.md for invocation and exact bounds.

Acceptance limits: Milestone 1 synthetic verification alone did not establish live compatibility; the user later reported a successful live collector test and Milestone 2 confirmed the extension UI in Kiro. Optimized import cursors are replaced by full bounded rescans plus stored source fingerprints/lengths. Kiro cache reads and stale-cache reread tests remain deferred with the adapter disabled. Windows ACL implementation and Windows/Ubuntu/RHEL host validation remain open. Multiple retained accounts deliberately withhold the account view; no active-account inference or selector is provided. Migrations, retention management, session aggregation and optimization remain deferred; Milestone 3 delivers progressive qualified account forecasts.

## Milestone 4A approval — 2026-10-10 (historical)

The user approved Tasks 1–4 of the existing Milestone 4 plan. Implement the independent billing-only cost engine with exact arithmetic and explicit hypothetical manual comparisons, without requiring forecast history or a fully known account profile. Unknown billing rules remain gates; any standalone zero-inventory/promotion-excluded scenario must be explicitly declared. Collector, Store, CLI, forecast policy and UI remain unchanged. Milestone 4B/5 and automatic commits were excluded at that time. Stop after engine validation for review.

## Milestone 4B approval — 2026-10-10 (historical)

The user approved Task 5 after accepting M4A, subject to resolving the synchronous break-even blocker first. Native inputs, advanced profile details, conditional costs/savings and 1/3/6 full-cycle comparisons are integrated into the existing detail view. The status bar, collector and forecast algorithms remain preserved. Exhaustive exact break-even is optional engine-only work and is never called by extension interactions. No automatic commits; Milestone 5 was excluded at that time and approved separately later (see above). This supersedes the previous M4A-only boundary.

## Milestone 4C — Long-term history and robust forecasting (implemented, 0.4.1)

Approved 2026-10-10 with refinements: observed zero net change is distinguished from proven inactivity and missing snapshots are never zero; pooled windows require independent comparable observations; heuristics are enabled only on walk-forward backtest evidence; availability, comparable-date error, underprediction risk and stability are reported separately with held-out scenarios; the release is 0.4.1 and 0.5.0 stays reserved for the dashboard.

Delivered: 85-day billing-only cross-cycle evidence in `history()`, the zero-net gap rule, pooled `history_7/14/28/84_day` methods (forecast schema/policy 3, existing three methods unchanged), the completed-break exclusion (enabled), sustained-change selection (implemented, off by evidence), exact Cost Optimizer rate reuse with long-window future cycles, presentation text only. No charts, Store/collector/projection changes, session or CLI sources. See the [plan](docs/superpowers/plans/2026-10-10-milestone-4c.md) and [validation](docs/milestone-4c-validation.md); live forecast accuracy remains unestablished.

## 0.5.2 macOS beta integration

Completed Cost Advisor Phase A and numerical modelled estimates are integrated without PR #1 storage/platform changes. Native acceptance of the exact final candidate remains required before publication. SC1 and SC5 remain open; persistence, owner-run limit verification, platform PoCs and future-record handling are outside this integration.
