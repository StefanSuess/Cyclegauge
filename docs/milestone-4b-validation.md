# Milestone 4B validation — 2026-10-10

Milestone 4A was accepted with 113 passing tests. Task 5 and the performance prerequisite are implemented in version 0.4.0. The daily-budget status bar, collector, Store, CLI and forecast algorithms remain preserved. No Milestone 5 charts, purchases, authenticated API calls, source integrations or automatic Git commits were added.

## Performance blocker resolved

The old combined `optimizeCosts` path was reproduced with complete invented pack rules: one cold call took **11,064 ms** and returned exhaustive intervals. The regression then passed after ordinary comparisons were separated from exact break-even: **three cold calculations took 18.26 ms** in the final isolated run, against a conservative 1,000-ms test ceiling. This is measured synthetic runtime on this Mac, not a guaranteed latency for all inputs/platforms.

`optimizeCosts` now returns cheap, explicitly conditional continuous-extra analytical references. `findBreakEven` retains its exact bounded enumeration contract and correctness tests but is an explicit engine-only operation, deferred from the extension. No worker infrastructure was needed. No approximation stands in for an exact result. Complex inventories/promotions/price changes withhold analytical references where needed; references describe a single steady full cycle rather than personalized multi-cycle carryover.

The final extension bundle contains **no `findBreakEven` implementation, breakpoint enumeration or break-even cache**. Thus activation, file/minute refresh, rendering, native configuration and native editing cannot reach that exhaustive path. Controller tests also exercise activation/configure/edit/refresh/clear with an open view within a 1-second bound. Ordinary event simulation still has its existing supported event limit; this release does not promise unlimited input size or a global optimum over arbitrary switching schedules.

## Visible user experience

1. Click the existing daily-budget status bar. A **Cost Optimizer** jump link sits near the top; the optimizer section follows Forecast and precedes the long history details.
2. Use the native panel gear (**Configure Cost Optimizer**), pencil (**Edit Cost Scenario**) or clear action. All three commands also appear in the Command Palette.
3. The simplest flow selects **Independent comparison**, a commercial billing system, expected credits per month and explicit assumptions: no opening purchased credits, excluded promotions, UTC list-price cycles and no current partial-cycle cost. It works with no account history or qualified forecast and returns no personalized savings.
4. Expand 1, 3 or 6 full billing cycles to inspect the lowest supported/calculable strategy, before-reset versus future expenditure, subscription/add-on/overage amounts, signed savings, inventory consumption/expiry/carryover and hypothetical 75/100/125% demand alternatives. Unknown competitor costs prevent a cheapest-overall claim. A missing baseline prevents numeric savings without hiding otherwise valid personalized before-reset expenditure.
5. Select a current plan for a manual personalized profile. Missing balances and eligibility stay unknown. The eligible tier menu initially contains only that selected plan; advanced selection explicitly confirms alternatives meeting feature/admin restrictions. Advanced native prompts cover balance anchor/reset, base balance and rerating usage, before-reset demand, purchased lots and expiration precision, available slots, cohort/first-paid date, promotions/prior add-on consumption, market and Enterprise permissions/headroom. Lots use separate prompts, not JSON entry.

Inputs are session-only. Clear, restart, account-context changes and ambiguity invalidate them; a late or superseded editor cannot reattach old inputs. Independent inputs can be newly created in an unavailable/ambiguous observation context but remain isolated there. Personalized profiles require an unambiguous observed account context. Account isolation depends on retained account-response evidence, not authenticated verification of the current login.

## Automated validation

| Check | Result |
| --- | --- |
| `pnpm test` | **130/130 pass**, no failures/skips; 113 accepted regressions plus 16 extension cases and 1 performance regression |
| `pnpm typecheck` / `tsc --noEmit` | Exit 0 |
| `python3 tests/fixtures/kiro/validate.py` | 7 wholly synthetic files / 20 fixture contracts pass |
| `git diff --check` | Exit 0 |
| `pnpm package:vsix` | Exit 0; bundle builds without new runtime dependencies |
| VSIX ZIP inspection | Exactly 5 entries; exhaustive break-even code absent |
| Fresh code review | One read-only fresh reviewer found no actionable issues in the named M4B changes |

New coverage exercises native cancellation, malformed values and inert injection markers, zero versus unknown inventory, guided lots, no-history manual mode, catalog review age, forecast rejection/stale inventory, fixed calculation-failure diagnostics, restart/clear/editor invalidation, account ambiguity during an open editor, budget preservation, responsive comparison paths, supported native title menus and local section navigation. Existing cost tests retain exact arithmetic, rankings, negative savings, matched-date baselines, conservation, inventory/expiry and separate Enterprise liabilities.

Live validation found an unsupported `webview/title` contribution. It was corrected to `editor/title` guarded by `activeWebviewPanelId`, with a failing-then-passing regression and actual button verification in Kiro. The context is supported by the [official VS Code release documentation](https://code.visualstudio.com/updates/v1_71#_new-activewebviewpanelid-context-key) and Kiro's shipped workbench. A final synthetic regression also caught and fixed baseline absence incorrectly hiding valid personalized bridge expenditure.

## Layout and local Kiro evidence

Platform actually tested: **macOS, Apple Silicon, Kiro 1.2.56**. The 0.4.0 VSIX was installed locally and activated by window reload. The native command flow and panel Configure/Edit/Clear buttons were exercised using invented independent monthly inputs; editing updated the open result, clear returned the setup view, and restart discarded session inputs. Existing budget/forecast sections remained present. No real-account screenshot or account values are included in this report.

An isolated disposable test profile also accepted the VSIX, but the UI tool could only bind the existing Kiro process. Native interaction checks therefore used the existing trusted window with invented independent inputs and filtered boolean observations. Existing Kiro settings were not changed. A disposable synthetic workspace was left untrusted and closed rather than changing trust settings.

The same generated script-disabled HTML was separately checked in a local browser with wholly invented 2030 account/history and demand data. **Light/dark × 360/960 px** checks passed with normal and expanded comparison disclosures: document scroll width equaled the tested viewport width in all four final checks. Native summary keyboard navigation moved focus to the next disclosure. Visual inspection confirmed wrapped text, readable themed contrast and stacked narrow-layout fields. These checks verify HTML/CSS at the tested widths, not every custom Kiro theme or OS.

Synthetic overview captures: [light 360](validation/m4b-light-360.png), [light 960](validation/m4b-light-960.png), [dark 360](validation/m4b-dark-360.png), [dark 960](validation/m4b-dark-960.png). Every displayed number/date in these captures is invented. They are excluded from the VSIX.

## Artifact and packaging

Artifact: version 0.4.0 VSIX, **47,405 bytes**.

SHA-256: `49d264840fd2bc27094b11de2e9bd807f5999980a1c8a07c5ea4e91cdd36773a`.

The five ZIP entries are `[Content_Types].xml`, `extension.vsixmanifest`, `extension/package.json`, `extension/readme.md`, and `extension/dist/extension.cjs`. `.vscodeignore` now uses an allowlist; source, tests, fixtures, data/stores/logs, local caches, execution ledgers, prior VSIX archives and validation images are excluded. Local packaging warns about absent repository/license metadata; this remains a private local artifact, not a Marketplace publication. No license or public repository was invented.

## Remaining limits

- Prices are bundled dated commercial pre-tax USD assumptions, not live quotes or invoices. Catalogs older than 30 days remain conditional. Public [pricing](https://kiro.dev/pricing/), [add-on rules](https://kiro.dev/docs/billing/add-on-credits/) and [Enterprise permission rules](https://kiro.dev/docs/enterprise/subscription-management/) were rechecked on 2026-10-10; unresolved rule gates were retained.
- Consumer purchase increments, depleted-slot release, invoice rounding, consumed-pack restoration and exact first-paid proration/promotion accounting remain unverified. New add-on-dependent competitors may be unpriceable, so an overall cheapest plan can remain unknown even when a higher tier has a calculable price.
- Unknown before-reset demand/base/purchased inventory can propagate into future cycles. Manual inventory older than 24 hours is conditional; later consumption is unknown. Day-only/unknown expiry does not establish exact usability. Reconfirm after a reset. No observed limit establishes base-only inventory or the current commercial plan.
- Eligibility, promotions, Enterprise opt-in/headroom and feature restrictions are manual declarations. Repeated future Enterprise headroom is conditional, not verified shared allocation. Custom/GovCloud prices are unsupported.
- Independent mode deliberately excludes personalized opening balances, promotions and partial-cycle expenditure. Advanced profile details do not silently change those assumptions; reconfigure into personalized mode to use them.
- Exact exhaustive break-even still takes roughly 10–11 seconds uncached in its explicit engine test. It is deferred from the extension rather than moved into a worker. The exact result is never silently approximated.
- Windows, Ubuntu, RHEL, arbitrary custom themes, live predictive accuracy and authenticated billing accuracy remain unverified. No new charts or session/Crew/SQLite integration were implemented.

The accepted uncommitted baseline was preserved in the supplied checkout. No files were staged and no Git commits were made.

The final baseline-only presentation correction was exercised through its synthetic regression, then reinstalled; the installed extension bundle was byte-compared successfully against the final build. Native personalized scenarios with an excluded current tier were not manually exercised. Temporary layout tabs/server and the separately launched disposable Kiro test process were closed.
