# Milestone 5.1 validation — UI simplification (0.5.1)

Presentation-only release. No collector, Store, projection, billing, forecast or cost-engine change; CSP, disabled scripts and command URIs are unchanged.

## Changes
- Default view: three summary cards (credits used, remaining reported capacity, daily budget), one status block (badge, one short sentence, next reset, last update with freshness), the chart with a compact legend, and a Cost Optimizer call to action or recommendation summary.
- One initially collapsed native `<details class="advanced">` "Advanced details" section holds forecast methods/evidence, coverage, exact UTC timestamps, qualifiers, the full chart legend, text alternative and data table, data-quality notes and billing assumptions.
- Freshness, stale/paused, provisional-uncertainty, above-limit and "not verified as total capacity" warnings stay in the default view. The SVG `<desc>` keeps the full text alternative.
- The forecast-unavailable/collecting message appears once; the long policy sentence moved to Advanced details.
- Chart frame is 240 high with fewer than 4 observed points, otherwise 340; the scale and layers are unchanged.
- Cost Optimizer: short call to action when unconfigured; per-horizon one-line summaries when configured; setup instructions and horizon details collapsed. Commands unchanged.

## Evidence
- `pnpm test` and `tsc --noEmit`: all pass, including new default-versus-expanded regression tests (`tests/unit/presentation.test.ts`, `tests/unit/cost-extension.test.ts`).
- Rendered synthetic output manually inspected at 900 px light and 375 px dark: no horizontal overflow, no `<details>` open by default. Theme variables were stubbed with VS Code-like light/dark values; not verified inside Kiro itself.
