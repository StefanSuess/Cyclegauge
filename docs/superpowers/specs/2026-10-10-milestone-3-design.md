# Milestone 3: account history and conservative forecasts

User-approved direction: implement credit history and the smallest reliable forecast engine, extend the existing billing-only detail view, validate a local VSIX. Future product: Kiro Usage & Cost Optimizer; no cost recommendations or metadata analysis in this milestone.

## Boundaries

Reuse log-only collection, exact decimal strings, app-owned schema-1 persistence and account isolation. No migrations, new collectors, authenticated requests, telemetry, Kiro database access or external runtime dependencies. Private account/source keys never enter public history/forecast output. Existing checkout contains uncommitted Milestones 1/2; preserve that work and implement in place on its feature branch without automatic commits.

## History

Select a single associated account, reject latest conflicts, normalize ordering by instant, coalesce equivalent billing observations. Retain the latest contiguous reset-metadata cycle. Advancing reset metadata may establish its start from the previous reset only if chronology supports it; do not infer a month from next reset. Expose billing-only points and classified intervals. Negative changes, missing values, limit changes, conflicting historical snapshots, unsupported extras and regressed/missing resets are barriers. Gaps over 36 hours are observation gaps; their net interval change can be known while daily distribution remains unknown.

A daily observed net counter change can include only intervals wholly contained in one UTC day (an endpoint at the following midnight is allowed). A complete day requires all 24 hours bracketed by comparable intervals. No interpolation, zero-filled missing days or invented daily allocation. Net counter changes are not a ledger of gross charges or proof of no hidden adjustments. Include calendar-day coverage, partial days, gaps, initial period unknown and observation bounds. UTC days are distinct from original source timezone and local calendar days.

## Forecast

Pure functions, no VS Code APIs. Version the policy: seven-day minimum comparable span, eight distinct points, maximum 36-hour interval, 24-hour freshness by default. All estimates are qualified scenario projections, never statistical probability/confidence intervals. Expose method, policy version, as-of time, window, horizon, rate, reasons and coverage. Rates and derived amounts use decimal/BigInt rational arithmetic; presentation is truncated to six decimals, never used as the input for later arithmetic.

Provide observation-window rate when adequate; rolling seven-day rate requires exact observed endpoints, no interpolation. Cycle-to-date requires an evidence-backed start, an initial observation within 24 hours of it and the same coverage gates; use cumulative observed usage over elapsed cycle time. Project from the latest observation to the explicit reset, not from a falsely live balance. Remaining base credits stay an as-of calculation, projected remaining may be negative and denotes shortfall. Exhaustion is a conditional UTC day only when it precedes reset, with zero rate unavailable. Already exhausted is explicit. Daily budget uses as-of remaining credits and time from query to reset; compare rate and budget as a qualified planning comparison. Freshness/conflict/reset/account errors withhold estimates. Historical quality barriers suspend rates until a subsequent clean seven-day window is established; no window may cross a barrier.

## Integration and acceptance

Attach history and forecast to `view()` so CLI JSON and extension share billing-only results. Compact textual webview rows show history, coverage, method, projected credits and conditional exhaustion; unchanged simple status bar. Synthetic tests cover steady/increasing/decreasing rates, missing days, sparse/mid-cycle observations, resets/regression, staleness, adjustments, limit changes, extras/conflicts, decimal arithmetic, offsets/UTC/DST boundaries and privacy. Run suite, typecheck, fixture validator, diff check, bundle and VSIX allowlist inspection. Install and open details in local Kiro without invoking authenticated usage commands; never attach screenshots containing private workspace content or account billing values to review artifacts.

## Future optimizer architecture

Forecast contract supplies credit units, observed as-of usage/limit/reset, methods/windows/horizons and qualified coverage. A separate future cost engine consumes it plus a versioned pricing/rules catalog and allowlisted purchased-credit lots. Catalog contains currency, effective/verified dates, provenance, tier allowances/fees, purchase increments/min/max, rollover/expiration, consumption priority, transition timing/proration and distinct enterprise overage/caps. Unknown prices, rules or balance prevent confident recommendations. Scenario outputs separate observed costs, hypothetical allocations and estimated future spending/savings at 1/3/6 months. Pricing is documentation/configuration data, never hardcoded into forecasts. No purchase or plan change automation.

Future efficiency insights require separately validated non-content metadata contracts and coverage; turn/session/model/workflow metrics do not themselves prove efficiency. Longer sessions/non-spec work are not inherently inefficient. Content analysis needs a separate explicit privacy/security review and opt-in; AGENTS safeguards remain intact.
