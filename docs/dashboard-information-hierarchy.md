# Dashboard information hierarchy (UI-only redesign)

Presentation only: no change to collection, Store, forecasting, billing semantics or the cost engine. The webview stays script-free.

| Level | Content |
| --- | --- |
| Essential (always visible) | Forecast status (On track / At risk / Likely to exceed / Limit reached / Collecting data / Stale data / Unavailable), one explanatory sentence, credits used, remaining reported capacity, next reset, freshness, usage chart with a short key, compact Cost Advisor card (likely plan marked Unconfirmed, verdict, how to confirm or change the plan). |
| One click | "How to read this chart" (full key, caveats), "Why, assumptions and comparison" in the Cost Advisor (conditions, per-horizon summary, full cost tables). |
| Advanced details (collapsed) | Forecast methods and evidence, coverage, exact UTC timestamps, qualifiers, chart summary and data table, billing assumptions. |

Status meanings: **At risk** = the observed pace is within 10% of the daily budget but no exhaustion before reset is projected; **Likely to exceed** = the reported limit would be reached before reset at the observed pace. Provisional estimates keep the "Provisional estimate – limited history" label.

The Cost Advisor verdict only states a saving when the engine classifies it as potential savings (every input confirmed); otherwise it says that no saving can be confirmed.

A numerical difference is shown only as a labelled *modelled* (or, when every input is confirmed, *supported*) estimate; see docs/cost-advisor-spec.md section 9.
