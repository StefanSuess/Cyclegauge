# Milestone 5 — Visual analytics dashboard proposal

**Approved 2026-10-10 and implemented in 0.5.0** with refinements for reported-limit wording, clipped projections and accessible data parity. See [implementation validation](milestone-5-validation.md). The optional projected-cost panel and local-time display were not implemented.

## Purpose and inputs

Show how observed account consumption relates to a stated budget and possible usage until reset, without making incomplete history look complete. Reuse billing-only `AccountHistory`, qualified `ForecastResult`, and optional Milestone 4 scenarios. No new collectors, content analysis or authenticated requests.

Use the current billing cycle on the horizontal axis and credits on the primary vertical axis. Label UTC billing dates explicitly; any optional local-time display must retain UTC reset semantics. Credits, money, tokens and context percentages remain separate units.

## Visual contract

| Layer | Representation and meaning |
| --- | --- |
| Observed cumulative counter | Solid point markers at actual snapshot timestamps. Label as observed cumulative account counter / net usage, not independently verified gross charges |
| Comparable observed intervals | Optional thin solid connectors between comparable endpoints, with tooltip explaining that within-interval timing was not observed; do not produce synthetic daily points |
| Unknown periods | Gaps/shaded regions with explicit unknown labels. No zero-filled line or continuous stroke bridging missing/incompatible history |
| Adjustments or changed plan/account | Break the series and mark the event; never turn a counter decrease into negative spending or infer a reset from it alone |
| Expected future trajectory | Dashed central constant-rate projection beginning at the last eligible observation; label method, tier, window and as-of |
| Lower/higher usage scenarios | Separate dashed boundaries and translucent envelope based on declared assumptions, e.g. M4's editable 75%/125% future-demand factors |
| Budget | User-defined cumulative budget reference or explicit allocation line, separately labeled from included capacity; if absent, omit it rather than infer one |
| Reset | Vertical marker at the explicit reset timestamp; future UTC-calendar assumptions disclosed separately |
| Credit exhaustion | Conditional marker for base-credit exhaustion; total-capacity exhaustion only with usable purchased inventory/expiry evidence; omit for zero rate, unknown capacity or exhaustion at/after reset |
| Optional projected cost | Separate USD pre-tax panel or toggle with matching dates and explicit new-expenditure semantics. Do not overlay dollars on a credit axis |

The envelope is a **scenario range**, not a statistically calibrated confidence interval. “Optimistic” means lower consumption / lower spending, and “conservative” means higher consumption / higher spending; legend text makes that direction explicit. Show which inputs change and never scale observed consumption.

## Required behavior

- If observation began mid-cycle, start the visible series at the first retained point and mark the earlier period unknown. An endpoint cumulative counter can be known without its daily path being known.
- A comparable endpoint delta across a long gap does not reveal the missing trajectory. Preserve endpoints but leave the intervening period unobserved.
- Visually distinguish the observed as-of point from query time. If a conditional line covers the time since the last snapshot, label that segment estimated/unobserved; do not show it as measurement.
- If forecasts are stale, conflicting or unavailable, keep the observed history and explanation; remove projected reassurance, exhaustion timing and scenario envelope.
- Preserve provisional versus regular forecast labels. Manual future scenarios have their own legend and never repair historical gaps.
- A changed allowance starts a new segment. Do not compare old and new capacity as if a single constant budget applied throughout the cycle.
- Expose the underlying billing-only table, observed points, unknown periods and textual summary for screen readers. Use line patterns/markers in addition to color, support narrow layouts and high-contrast themes.
- Keep transforms and rendering separate. Choose a small renderer only during M5 planning; M4 adds no chart dependency or webview script permission.

## Future acceptance scenarios

Synthetic checks cover mid-cycle starts, long gaps, conflicting equal-time snapshots, counter adjustments, plan changes, UTC month boundaries and local DST, zero usage, stale data, insufficient history, provisional/regular/manual scenarios, exhausted base capacity, and missing purchased-credit evidence. Visual tests must verify that no line bridges an unknown period as observed data and no uncertainty label implies probability.

Cost visualization additionally separates already paid inventory, modeled new purchases and Enterprise accrued liabilities. Never label a hypothetical cost as an actual bill. Charts and exports must contain only public billing projections, no identifiers, paths, session contents or raw data.

This dashboard improves explanation; it does not validate the forecast's predictive accuracy or authorize collecting more data.
