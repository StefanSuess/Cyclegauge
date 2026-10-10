# Milestone 5 validation — 2026-10-10

EasyKiroGauge **0.5.0** adds the approved usage trajectory chart to the existing script-disabled detail view. Collector, Store, history, Forecast Engine and Cost Optimizer algorithms are unchanged; the work is presentation only. No chart library, runtime dependency, webview script, permission, data source or authenticated call was added. No Git commits were made.

## What was built

| Area | Result |
| --- | --- |
| Model | `src/extension/chart-model.ts` — pure transform of the existing view output: observed points, comparable connectors, unknown periods, events, limit segments, 75%/125% scenario endpoints (exact decimal arithmetic), budget guide, conditional exhaustion, axis range/clipping, bounded decimation |
| Renderer | `src/extension/chart.ts` — inline SVG, theme tokens with a forced-colors fallback, dash patterns **and** marker shapes, HTML legend, text summary, data table |
| Integration | Section inserted before *Forecast* in `present()`; `src/extension/labels.ts` shares labels. CSP is unchanged (`default-src 'none'; style-src 'unsafe-inline'`) |
| Terminology | `Remaining base credits` → `Remaining reported capacity`; `Base credit limit` → `Reported credit limit (CREDIT)`; `Base credits exhausted` → `Reported limit reached` / `Above reported limit` |

## Refinements and billing clarification

1. **Credit-limit accuracy.** The chart, legend, table and notes call the line the *reported credit limit*, state it is "not verified as base-only or total available capacity" and "may include purchased add-on credits", and that a counter alone "does not establish actual overage charges, purchased balance or billing eligibility". The existing billing uncertainty (`Extra credits, purchased balances and total availability remain unknown`) is preserved.
2. **Clipped projections.** The visible range always contains the observed counter and the limit; a trajectory beyond twice that range is clipped with a ▲ marker, an on-page note, a legend entry, and its complete numeric endpoint in the summary and table (`357.5` in the clipped synthetic case).
3. **Accessible data parity.** The summary and *Chart data table* contain every plotted observed point, limit segment, unknown period, event, central/lower/higher endpoint, budget-guide endpoints, reset, evaluation time and the conditional exhaustion day. Tests assert that plotted marker count equals table point rows. At most 96 observed points are plotted; thinning always keeps the first, last and every update beside an unknown period, event, limit change or limit crossing, and the omitted count is stated. A 3,000-snapshot case stays under 60 KB of chart HTML.
4. **Capacity semantics.** Synthetic `2100 / 2000` (usage above the reported limit) renders a diamond marker, a tinted region and "100 credits above the reported limit"; `2100 / 2125` renders "25 credits below the reported limit" and never claims overage. The two cases show the same counter, because the counter alone cannot say which semantics applies. Budget and remaining capacity remain `max(limit − usage, 0)` from the unchanged calculation; only their labels changed.

## Automated validation

| Check | Result |
| --- | --- |
| `pnpm test` | **179/179 pass** (157 pre-existing + 22 new chart cases; two assertions in `presentation.test.ts` were updated for the new wording), no failures or skips |
| `pnpm typecheck` | Exit 0 |
| `python3 tests/fixtures/kiro/validate.py` | 7 synthetic files / 20 contracts pass |
| `git diff --check` | Exit 0 |
| `pnpm package:vsix` | Exit 0 |
| VSIX inspection | Exactly 5 entries (`[Content_Types].xml`, `extension.vsixmanifest`, `extension/package.json`, `extension/readme.md`, `extension/dist/extension.cjs`); no `<script`, no `findBreakEven` in the bundle |

New tests cover: usage above the limit, capacity labels, both synthetic capacity cases, terminology, clipping, scenario exactness, data parity, budget guide and exhaustion rules, stale/unavailable/provisional behavior, gaps and counter adjustments (no bridging connector), limit-change segments, mid-cycle starts, decimation and barrier retention, size bound, script-free/escaped output, and accessibility attributes. All data is invented (`synthetic-*`, 2030 dates).

## Layout and theme evidence

The generated script-disabled HTML (invented 2030 data, VS Code theme variables injected) was inspected in a local browser at **light/dark × 360/960 px**: document scroll width equalled the viewport in every case, the legend wraps, the data table scrolls inside its own container, and every layer is distinguishable by pattern or shape as well as color. Captures (all values invented):

- [light 960 — full layered forecast](validation/m5-light-960-forecast.jpg)
- [dark 960 — Enterprise `2100 / 2000`, clipped trajectories](validation/m5-dark-960-enterprise-2100-2000.jpg)
- [light 360 — individual prepaid `2100 / 2125`](validation/m5-light-360-individual-2100-2125.jpg)
- [dark 360 — clipped higher scenario](validation/m5-dark-360-clipped.jpg)

High-contrast behavior is provided by a `forced-colors: active` rule; it was not exercised in a real Windows high-contrast theme.

## Local Kiro evidence

Platform: **macOS, Apple Silicon, Kiro 1.2.56**. `easykirogauge-0.5.0.vsix` was installed with the IDE's own extension installer, the bundle was byte-compared with the build output, and the window was reloaded.

Verified in the live window: the status bar item activates; the detail view shows the **Usage trajectory** section with the reported-limit note, SVG chart (hatched unknown period before the first retained update, observed points and connectors, reported limit, reset marker), legend, text summary and an expandable **Chart data table** that lists the plotted points; Forecast and **Cost Optimizer** sections follow; the panel title gear opened the native Cost Optimizer quick pick (cancelled without entering data). The live account is in the *collecting data* state, so projection, scenario envelope, budget guide and exhaustion layers were **not** visible live; they are verified only through synthetic tests and the local-browser captures. Pencil/clear title actions and light-theme/narrow-pane rendering were not separately exercised in Kiro. No live account value is recorded in this repository.

## Artifact

`dist/easykirogauge-0.5.0.vsix`, **59,982 bytes**, SHA-256 `7156dc6631201363872d9d8fba1e1af1d1fd8c4fcc2a41fb52b593ce47150738`. Not published; excluded from the repository by `.gitignore`.

## Deviations from the approved design

- **Not implemented (optional in the design):** the separate projected-cost USD panel and local-time display. Costs remain only in the Cost Optimizer.
- **Scenario factors are fixed** at 75%/125% of the selected observed rate and are not wired to the editable Cost Optimizer demand factors.
- **Budget guide** is an even allocation of the remaining reported capacity from the last observed point to the limit at reset (the existing allocation concept), and is omitted when none remains; no separate user-defined budget exists yet.
- **Connectors** are drawn only across comparable intervals of at most 36 hours, so a long zero-net gap is shown as unknown rather than connected.
- **Exhaustion marker** position is plotted from the selected rate; only the engine's UTC day is stated as data.
- **Presentation wording** changed (see Terminology) and three existing tests were updated accordingly; `AGENTS.md`, `README.md`, `ROADMAP.md`, `SPEC.md` and `ARCHITECTURE.md` were edited to record the approval and scope.
- The approved implementation plan did not exist as a separate file in the repository; `docs/superpowers/plans/2026-10-10-milestone-5.md` was written from the proposal and the approval text.

## Remaining limits

Windows, Ubuntu, RHEL, custom/high-contrast themes and live predictive accuracy remain unverified. The chart explains observed history and declared scenarios; it neither validates forecast accuracy nor establishes billing, overage or purchased-balance facts.
