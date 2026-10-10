# Milestone 4C validation — long-term history and robust forecasting (0.4.1)

Status: implemented and verified with synthetic data only. **Live forecast accuracy is not established**; every number below comes from an invented, seeded simulator (`tests/unit/sim.ts`) and a frozen copy of the v0.4.0 history/forecast code (`tests/unit/baseline/`). No real Kiro data, identifiers or paths were used.

## What changed

- `history()` retains billing-only **evidence** for the trailing 85 UTC days across billing cycles: per-cycle intervals, per-day rows (`netChange`, `observedMilliseconds`, `zeroNetMilliseconds`, `snapshots`) and unattributed spans. Nothing is subtracted across a reset; time after a cycle's last snapshot is excluded, never zero. Base-limit changes, reset regressions/unknown resets and unsupported extra credits are regime stops; conflicts, missing billing and counter decreases are local exclusions.
- **Gap rule (policy v3).** An interval longer than 36 h is a quality barrier only if its net change is positive. An unchanged counter between two real snapshots is observed zero net change (`zero_net_change_not_proof_of_inactivity`).
- **New methods** `history_7_day`, `history_14_day`, `history_28_day`, `history_84_day`: exposure-weighted means of complete UTC days before the latest observation's day, with independent-observation gates (exposure, snapshots, distinct snapshot days, and no single interval above half of the exposure). Forecast schema/policy version 3; the three v2 methods and their numbers are unchanged.
- **Selection:** v2 blocks first, then `history_28_day` → `history_14_day` → `rolling_7_day` → `history_7_day` → `cycle_to_date` → `observed_window`. (`rolling_7_day` was kept ahead of `history_7_day` so existing selections do not change when only seven days exist.)
- **Cost Optimizer:** the selected pooled estimate's exact `evidenceCredits / evidenceMilliseconds` is re-verified against a fresh `forecast()` run; future full cycles use the longest qualified of `history_84_day`/`history_28_day`, otherwise the selected rate with `short_window_long_horizon`.
- Collector, Store schema, projection, privacy safeguards, account isolation and cost simulation/optimization semantics are untouched. No charts.

## Heuristic decisions (decided by the backtest)

| Heuristic | Decision | Evidence |
|---|---|---|
| Completed-break exclusion (single completed run of ≥ 5 fully observed zero-net UTC days, later followed by positive usage; weekends never excluded; several runs are treated as a pattern of use) | **Enabled** | Break-return error 26.1 % → 15.6 % (design) and 27.4 % → 18.8 % (held-out) versus v2; versus v3 without exclusion 21.2 % → 15.6 % and 23.7 % → 21.3 %. No change on `sustained_decrease`, `sparse_decrease` or `break_then_decrease`, so it did not hide a genuine long-term decrease. |
| Sustained-change selection (both most recent 7-day blocks 3:2 above/below the older half → `history_14_day`) | **Off** (qualifiers `recent_usage_higher` / `recent_usage_lower` are still reported) | Improved `sustained_decrease` (15.3 % → 13.7 %) but regressed `bursty` (16.2 % → 17.4 %, material underprediction 28.2 % → 28.7 % design; 17.4 % → 18.5 %, 29.3 % → 33.6 % held-out) and brought no gain on increases. A stricter 2:1 trigger gave the same pattern (bursty 16.2 % → 17.2 % / 17.4 % → 19.2 %). |
| Selection-order experiments | **Rejected** | `rolling_7_day` first: change segment 23.1 % → 10.8 % but held-out overall 7.4 % → 8.9 % and Monday stability 6.3 % → 16.1 %. `history_14_day` first: no overall gain, worse reset segment. |
| Weekday-aware profile (`weekday_28`) | **Evaluated, deferred** | Better weekday/weekend error (design 7.9 % vs 9.2 % overall) but unavailable on 8 % of dates and 100 % underprediction share with 25 % shortfall in break returns; it does not beat `history_28_day` without regressing the break and change segments. |
| Median of weeks (`median_weeks`) | **Rejected** | Available on only 38 % of dates and underpredicts a cumulative total in held-out data (47 % share). |

## How to read the tables

- **Candidates**: `v2` is the frozen v0.4.0 behavior. `v3_break` is **the shipped default** (pooled methods + completed-break exclusion). `v3` has no heuristic, `v3_sustained` enables sustained-change selection, `v3_both` both. The rest are experiments listed above.
- Truth is the realized cycle total at the reset. Every forecast sees only snapshots up to its own evaluation time (walk-forward). Evaluation happens at the first snapshot of each active day, UTC.
- **Availability**: share of evaluation dates with any qualified forecast (v2 vs candidate).
- **Old err / New err**: mean absolute error of projected usage at reset relative to truth, on *comparable dates* where both qualify. **Bias** is the signed version (positive = over-forecast).
- **New-only**: dates where only the candidate qualifies, with its error.
- **Under %**: share of comparable dates predicted below truth. **Material under %**: more than 10 % below truth. **Shortfall**: mean fractional shortfall.
- **Stability**: mean absolute day-to-day change of the projection, as a share of truth, between consecutive evaluation days of the same cycle where both qualify.
- Segments: `monday` (Monday morning), `reset` (first three days of a cycle), `weekend` (Saturday/Sunday sessions), `break` (21 days after a completed break), `change` (28 days after a sustained change of consumption).
- Design scenarios were used to choose thresholds and heuristics: steady weekdays, light/heavy weekends, extended break, sustained increase, sustained decrease, sparse (1 day/week) decrease, bursty usage, seeds 1–3. Held-out shapes were not used to choose anything: four-day week, alternating heavy/light weeks, gradual ramp, biweekly bursts, usage crossing UTC midnight, break followed by a decrease (seeds 101–103) plus the design shapes with unseen seeds 201–202.

## Results

### Plain-language summary (shipped default `v3_break` versus v0.4.0)

| Situation | Availability v2 → new | Mean error on shared dates v2 → new | Notes |
|---|---|---|---|
| Monday mornings | 10.8 % → 99.3 % (held-out 3.7 % → 98.7 %) | 34.8 % → 5.2 % (29.8 % → 5.3 %) | The Friday-evening → Monday zero-net gap was a barrier in v2; day-to-day stability 27.8 % → 7.2 %. |
| Billing resets (first 3 days) | 23.4 % → 95.7 % (21.8 % → 95.9 %) | 34.0 % → 10.7 % (36.4 % → 10.2 %) | v2 had to re-accumulate 48 h/3 snapshots after every reset. |
| Weekends | 68.7 % → 100 % (69.6 % → 100 %) | 12.8 % → 4.3 % (11.7 % → 4.9 %) | |
| Extended breaks (21 d after return) | 56.3 % → 87.5 % (58.4 % → 79.2 %) | 26.1 % → 15.6 % (27.4 % → 21.3 %) | Remaining overforecast is bias, not underprediction. |
| Sustained changes (28 d after) | 52.2 % → 97.8 % (53.8 % → 93.4 %) | 21.0 % → 23.1 % (20.7 % → 19.0 %) | **Mixed.** Increases improve (24 % → 9 %); sustained decreases lag (v2 18 % → 37 %, over-forecast). See limitations. |

### Design and held-out aggregate tables

### Design scenarios (seeds 1-3)

| Segment | n | Candidate | Availability | Old err | New err | Bias old→new | New-only n | New-only err | Under% old→new | Material under% old→new | Shortfall old→new | Stability old→new |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| all | 2354 | v2 | 57.1% | | | | | | 16.2% | | 2.7% | 5.2% |
| | | v3 | 99.5% | 22.9% | 9.3% | 17.5%→3.5% | 999 | 11.2% | 16.2%→50.5% | 7.8%→6.6% | 2.7%→2.9% | 5.2%→3.5% |
| | | v3_break | 99.5% | 22.9% | 9.2% | 17.5%→3.6% | 999 | 11.2% | 16.2%→49.9% | 7.8%→5.9% | 2.7%→2.8% | 5.2%→3.5% |
| | | v3_sustained | 99.5% | 22.9% | 9.2% | 17.5%→3.4% | 999 | 11.4% | 16.2%→50.5% | 7.8%→6.6% | 2.7%→2.9% | 5.2%→3.8% |
| | | v3_rolling_first | 99.5% | 22.9% | 9.0% | 17.5%→2.3% | 999 | 11.5% | 16.2%→55.2% | 7.8%→6.9% | 2.7%→3.4% | 5.2%→4.4% |
| | | v3_14_first | 99.5% | 22.9% | 9.2% | 17.5%→3.4% | 999 | 11.6% | 16.2%→52.6% | 7.8%→5.9% | 2.7%→2.9% | 5.2%→3.8% |
| | | v3_both | 99.5% | 22.9% | 9.1% | 17.5%→3.5% | 999 | 11.3% | 16.2%→49.9% | 7.8%→6.0% | 2.7%→2.8% | 5.2%→3.7% |
| | | weekday_28 | 92.4% | 23.0% | 7.9% | 17.5%→1.2% | 956 | 9.8% | 17.4%→71.7% | 8.1%→8.5% | 2.8%→3.4% | 5.2%→2.3% |
| | | median_weeks | 37.9% | 17.2% | 6.3% | 12.7%→3.8% | 299 | 8.2% | 22.0%→31.1% | 7.3%→2.2% | 2.3%→1.3% | 5.2%→2.6% |
| monday | 427 | v2 | 10.8% | | | | | | 0.0% | | 0.0% | 27.8% |
| | | v3 | 99.3% | 34.8% | 5.2% | 34.8%→2.9% | 378 | 12.2% | 0.0%→30.4% | 0.0%→2.2% | 0.0%→1.2% | 27.8%→7.4% |
| | | v3_break | 99.3% | 34.8% | 5.2% | 34.8%→2.9% | 378 | 12.1% | 0.0%→30.4% | 0.0%→2.2% | 0.0%→1.2% | 27.8%→7.2% |
| | | v3_sustained | 99.3% | 34.8% | 5.2% | 34.8%→2.9% | 378 | 12.0% | 0.0%→30.4% | 0.0%→2.2% | 0.0%→1.2% | 27.8%→7.8% |
| | | v3_rolling_first | 99.3% | 34.8% | 5.7% | 34.8%→2.1% | 378 | 12.7% | 0.0%→34.8% | 0.0%→6.5% | 0.0%→1.8% | 27.8%→11.6% |
| | | v3_14_first | 99.3% | 34.8% | 5.7% | 34.8%→3.2% | 378 | 12.2% | 0.0%→37.0% | 0.0%→2.2% | 0.0%→1.2% | 27.8%→8.5% |
| | | v3_both | 99.3% | 34.8% | 5.2% | 34.8%→2.9% | 378 | 12.0% | 0.0%→30.4% | 0.0%→2.2% | 0.0%→1.2% | 27.8%→7.8% |
| | | weekday_28 | 94.1% | 35.2% | 3.5% | 35.2%→-0.3% | 360 | 10.4% | 0.0%→57.1% | 0.0%→2.4% | 0.0%→1.9% | 27.8%→7.3% |
| | | median_weeks | 5.4% | 29.9% | 9.5% | 29.9%→9.5% | 1 | 7.7% | 0.0%→0.0% | 0.0%→0.0% | 0.0%→0.0% | 27.8%→4.6% |
| reset | 209 | v2 | 23.4% | | | | | | 22.4% | | 7.3% | n/a |
| | | v3 | 95.7% | 34.0% | 10.7% | 19.5%→7.0% | 151 | 18.1% | 22.4%→55.1% | 22.4%→2.0% | 7.3%→1.8% | n/a→2.0% |
| | | v3_break | 95.7% | 34.0% | 10.7% | 19.5%→7.0% | 151 | 18.1% | 22.4%→55.1% | 22.4%→2.0% | 7.3%→1.8% | n/a→2.0% |
| | | v3_sustained | 95.7% | 34.0% | 12.4% | 19.5%→8.8% | 151 | 19.7% | 22.4%→55.1% | 22.4%→2.0% | 7.3%→1.8% | n/a→2.5% |
| | | v3_rolling_first | 95.7% | 34.0% | 10.7% | 19.5%→7.0% | 151 | 18.1% | 22.4%→55.1% | 22.4%→2.0% | 7.3%→1.8% | n/a→2.0% |
| | | v3_14_first | 95.7% | 34.0% | 12.8% | 19.5%→9.7% | 151 | 19.8% | 22.4%→36.7% | 22.4%→2.0% | 7.3%→1.6% | n/a→2.6% |
| | | v3_both | 95.7% | 34.0% | 12.4% | 19.5%→8.8% | 151 | 19.7% | 22.4%→55.1% | 22.4%→2.0% | 7.3%→1.8% | n/a→2.5% |
| | | weekday_28 | 100.0% | 34.0% | 10.6% | 19.5%→1.1% | 160 | 18.4% | 22.4%→69.4% | 22.4%→10.2% | 7.3%→4.7% | n/a→1.8% |
| | | median_weeks | 51.7% | 27.8% | 17.4% | 17.6%→17.4% | 85 | 15.5% | 17.4%→0.0% | 17.4%→0.0% | 5.1%→0.0% | n/a→2.3% |
| weekend | 163 | v2 | 68.7% | | | | | | 31.3% | | 2.9% | 14.0% |
| | | v3 | 100.0% | 12.8% | 4.3% | 7.1%→0.4% | 51 | 6.1% | 31.3%→47.3% | 11.6%→1.8% | 2.9%→1.9% | 14.0%→3.5% |
| | | v3_break | 100.0% | 12.8% | 4.3% | 7.1%→0.4% | 51 | 6.1% | 31.3%→47.3% | 11.6%→1.8% | 2.9%→1.9% | 14.0%→3.5% |
| | | v3_sustained | 100.0% | 12.8% | 4.3% | 7.1%→0.4% | 51 | 6.1% | 31.3%→47.3% | 11.6%→1.8% | 2.9%→1.9% | 14.0%→3.5% |
| | | v3_rolling_first | 100.0% | 12.8% | 4.2% | 7.1%→0.3% | 51 | 8.3% | 31.3%→47.3% | 11.6%→4.5% | 2.9%→2.0% | 14.0%→5.0% |
| | | v3_14_first | 100.0% | 12.8% | 4.6% | 7.1%→0.8% | 51 | 6.7% | 31.3%→42.0% | 11.6%→1.8% | 2.9%→1.9% | 14.0%→4.2% |
| | | v3_both | 100.0% | 12.8% | 4.3% | 7.1%→0.4% | 51 | 6.1% | 31.3%→47.3% | 11.6%→1.8% | 2.9%→1.9% | 14.0%→3.5% |
| | | weekday_28 | 90.8% | 12.7% | 2.6% | 6.9%→-0.5% | 44 | 4.5% | 32.7%→64.4% | 11.5%→1.9% | 2.9%→1.5% | 14.0%→1.8% |
| | | median_weeks | 41.7% | 10.0% | 7.0% | 2.9%→4.4% | 17 | 7.5% | 37.3%→29.4% | 15.7%→0.0% | 3.6%→1.3% | 14.0%→4.8% |
| break | 48 | v2 | 56.3% | | | | | | 0.0% | | 0.0% | 2.0% |
| | | v3 | 87.5% | 26.1% | 21.2% | 26.1%→3.5% | 15 | 15.6% | 0.0%→55.6% | 0.0%→44.4% | 0.0%→8.9% | 2.0%→9.9% |
| | | v3_break | 87.5% | 26.1% | 15.6% | 26.1%→10.0% | 15 | 13.7% | 0.0%→25.9% | 0.0%→11.1% | 0.0%→2.8% | 2.0%→7.9% |
| | | v3_sustained | 87.5% | 26.1% | 21.2% | 26.1%→3.5% | 15 | 13.7% | 0.0%→55.6% | 0.0%→44.4% | 0.0%→8.9% | 2.0%→10.6% |
| | | v3_rolling_first | 87.5% | 26.1% | 15.6% | 26.1%→10.0% | 15 | 13.8% | 0.0%→25.9% | 0.0%→11.1% | 0.0%→2.8% | 2.0%→7.9% |
| | | v3_14_first | 87.5% | 26.1% | 15.6% | 26.1%→10.0% | 15 | 13.7% | 0.0%→25.9% | 0.0%→11.1% | 0.0%→2.8% | 2.0%→7.9% |
| | | v3_both | 87.5% | 26.1% | 15.6% | 26.1%→10.0% | 15 | 13.7% | 0.0%→25.9% | 0.0%→11.1% | 0.0%→2.8% | 2.0%→7.9% |
| | | weekday_28 | 100.0% | 26.1% | 25.6% | 26.1%→-25.6% | 21 | 33.0% | 0.0%→100.0% | 0.0%→88.9% | 0.0%→25.6% | 2.0%→4.0% |
| | | median_weeks | 0.0% | n/a | n/a | n/a→n/a | 0 | n/a | n/a→n/a | n/a→n/a | n/a→n/a | 2.0%→n/a |
| change | 138 | v2 | 52.2% | | | | | | 0.0% | | 0.0% | 1.4% |
| | | v3 | 97.8% | 21.0% | 23.1% | 21.0%→15.4% | 63 | 36.8% | 0.0%→29.2% | 0.0%→16.7% | 0.0%→3.9% | 1.4%→8.7% |
| | | v3_break | 97.8% | 21.0% | 23.1% | 21.0%→15.4% | 63 | 36.8% | 0.0%→29.2% | 0.0%→16.7% | 0.0%→3.9% | 1.4%→8.7% |
| | | v3_sustained | 97.8% | 21.0% | 19.3% | 21.0%→11.7% | 63 | 35.1% | 0.0%→27.8% | 0.0%→16.7% | 0.0%→3.8% | 1.4%→9.0% |
| | | v3_rolling_first | 97.8% | 21.0% | 10.8% | 21.0%→8.0% | 63 | 25.5% | 0.0%→15.3% | 0.0%→6.9% | 0.0%→1.4% | 1.4%→8.5% |
| | | v3_14_first | 97.8% | 21.0% | 19.0% | 21.0%→12.5% | 63 | 32.5% | 0.0%→23.6% | 0.0%→12.5% | 0.0%→3.3% | 1.4%→9.0% |
| | | v3_both | 97.8% | 21.0% | 19.3% | 21.0%→11.7% | 63 | 35.1% | 0.0%→27.8% | 0.0%→16.7% | 0.0%→3.8% | 1.4%→9.0% |
| | | weekday_28 | 100.0% | 21.0% | 20.3% | 21.0%→7.6% | 66 | 36.8% | 0.0%→48.6% | 0.0%→23.6% | 0.0%→6.4% | 1.4%→7.6% |
| | | median_weeks | 0.0% | n/a | n/a | n/a→n/a | 0 | n/a | n/a→n/a | n/a→n/a | n/a→n/a | 1.4%→n/a |

### Held-out scenarios (new shapes, seeds 101-103, plus design shapes with seeds 201-202)

| Segment | n | Candidate | Availability | Old err | New err | Bias old→new | New-only n | New-only err | Under% old→new | Material under% old→new | Shortfall old→new | Stability old→new |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| all | 3301 | v2 | 56.0% | | | | | | 24.6% | | 4.0% | 3.1% |
| | | v3 | 99.4% | 22.2% | 7.5% | 14.3%→1.6% | 1434 | 8.4% | 24.6%→53.2% | 15.9%→7.5% | 4.0%→3.0% | 3.1%→3.2% |
| | | v3_break | 99.4% | 22.2% | 7.4% | 14.3%→1.7% | 1434 | 8.4% | 24.6%→53.1% | 15.9%→7.1% | 4.0%→2.9% | 3.1%→3.2% |
| | | v3_sustained | 99.4% | 22.2% | 7.5% | 14.3%→1.4% | 1434 | 8.5% | 24.6%→53.3% | 15.9%→7.7% | 4.0%→3.0% | 3.1%→3.3% |
| | | v3_rolling_first | 99.4% | 22.2% | 8.9% | 14.3%→0.6% | 1434 | 10.9% | 24.6%→57.9% | 15.9%→11.3% | 4.0%→4.2% | 3.1%→4.9% |
| | | v3_14_first | 99.4% | 22.2% | 7.5% | 14.3%→1.4% | 1434 | 8.7% | 24.6%→57.3% | 15.9%→7.1% | 4.0%→3.0% | 3.1%→3.3% |
| | | v3_both | 99.4% | 22.2% | 7.4% | 14.3%→1.5% | 1434 | 8.5% | 24.6%→53.2% | 15.9%→7.4% | 4.0%→3.0% | 3.1%→3.3% |
| | | weekday_28 | 91.0% | 22.1% | 6.5% | 13.8%→-0.9% | 1360 | 7.2% | 25.7%→75.0% | 16.3%→9.8% | 4.1%→3.7% | 3.1%→1.8% |
| | | median_weeks | 39.7% | 18.6% | 5.5% | 11.5%→0.5% | 460 | 6.3% | 27.4%→47.2% | 13.5%→6.8% | 3.6%→2.5% | 3.1%→2.0% |
| monday | 630 | v2 | 3.7% | | | | | | 0.0% | | 0.0% | 33.0% |
| | | v3 | 98.7% | 29.8% | 5.3% | 29.8%→2.1% | 599 | 8.9% | 0.0%→30.4% | 0.0%→4.3% | 0.0%→1.6% | 33.0%→6.4% |
| | | v3_break | 98.7% | 29.8% | 5.3% | 29.8%→2.1% | 599 | 8.9% | 0.0%→30.4% | 0.0%→4.3% | 0.0%→1.6% | 33.0%→6.3% |
| | | v3_sustained | 98.7% | 29.8% | 5.3% | 29.8%→2.1% | 599 | 9.0% | 0.0%→30.4% | 0.0%→4.3% | 0.0%→1.6% | 33.0%→6.8% |
| | | v3_rolling_first | 98.7% | 29.8% | 4.8% | 29.8%→2.4% | 599 | 12.5% | 0.0%→26.1% | 0.0%→4.3% | 0.0%→1.2% | 33.0%→16.1% |
| | | v3_14_first | 98.7% | 29.8% | 5.9% | 29.8%→3.1% | 599 | 9.1% | 0.0%→34.8% | 0.0%→4.3% | 0.0%→1.4% | 33.0%→7.0% |
| | | v3_both | 98.7% | 29.8% | 5.3% | 29.8%→2.1% | 599 | 9.0% | 0.0%→30.4% | 0.0%→4.3% | 0.0%→1.6% | 33.0%→6.8% |
| | | weekday_28 | 92.7% | 30.0% | 4.3% | 30.0%→-1.3% | 563 | 7.3% | 0.0%→61.9% | 0.0%→4.8% | 0.0%→2.8% | 33.0%→6.4% |
| | | median_weeks | 0.2% | 4.5% | 3.3% | 4.5%→3.3% | 0 | n/a | 0.0%→0.0% | 0.0%→0.0% | 0.0%→0.0% | 33.0%→n/a |
| reset | 293 | v2 | 21.8% | | | | | | 23.4% | | 7.8% | n/a |
| | | v3 | 95.9% | 36.4% | 10.2% | 20.9%→2.7% | 217 | 12.5% | 23.4%→48.4% | 21.9%→17.2% | 7.8%→3.8% | n/a→2.0% |
| | | v3_break | 95.9% | 36.4% | 10.2% | 20.9%→2.7% | 217 | 12.5% | 23.4%→48.4% | 21.9%→17.2% | 7.8%→3.8% | n/a→2.0% |
| | | v3_sustained | 95.9% | 36.4% | 10.2% | 20.9%→2.7% | 217 | 12.5% | 23.4%→48.4% | 21.9%→17.2% | 7.8%→3.8% | n/a→2.0% |
| | | v3_rolling_first | 95.9% | 36.4% | 10.2% | 20.9%→2.7% | 217 | 12.5% | 23.4%→48.4% | 21.9%→17.2% | 7.8%→3.8% | n/a→2.0% |
| | | v3_14_first | 95.9% | 36.4% | 10.9% | 20.9%→3.5% | 217 | 13.1% | 23.4%→48.4% | 21.9%→18.8% | 7.8%→3.7% | n/a→2.2% |
| | | v3_both | 95.9% | 36.4% | 10.2% | 20.9%→2.7% | 217 | 12.5% | 23.4%→48.4% | 21.9%→17.2% | 7.8%→3.8% | n/a→2.0% |
| | | weekday_28 | 96.9% | 36.4% | 7.5% | 20.1%→-3.5% | 223 | 12.1% | 24.6%→60.7% | 23.0%→19.7% | 8.1%→5.5% | n/a→1.9% |
| | | median_weeks | 51.9% | 37.3% | 8.9% | 23.0%→2.8% | 123 | 9.7% | 17.2%→31.0% | 17.2%→10.3% | 7.2%→3.0% | n/a→2.2% |
| weekend | 102 | v2 | 69.6% | | | | | | 38.0% | | 3.1% | 13.3% |
| | | v3 | 100.0% | 11.7% | 4.9% | 5.5%→0.2% | 31 | 6.5% | 38.0%→49.3% | 12.7%→1.4% | 3.1%→2.4% | 13.3%→3.7% |
| | | v3_break | 100.0% | 11.7% | 4.9% | 5.5%→0.2% | 31 | 6.5% | 38.0%→49.3% | 12.7%→1.4% | 3.1%→2.4% | 13.3%→3.7% |
| | | v3_sustained | 100.0% | 11.7% | 4.9% | 5.5%→0.2% | 31 | 6.5% | 38.0%→49.3% | 12.7%→1.4% | 3.1%→2.4% | 13.3%→3.7% |
| | | v3_rolling_first | 100.0% | 11.7% | 4.2% | 5.5%→-0.7% | 31 | 7.1% | 38.0%→56.3% | 12.7%→2.8% | 3.1%→2.4% | 13.3%→4.3% |
| | | v3_14_first | 100.0% | 11.7% | 5.7% | 5.5%→1.4% | 31 | 7.4% | 38.0%→50.7% | 12.7%→1.4% | 3.1%→2.2% | 13.3%→4.6% |
| | | v3_both | 100.0% | 11.7% | 4.9% | 5.5%→0.2% | 31 | 6.5% | 38.0%→49.3% | 12.7%→1.4% | 3.1%→2.4% | 13.3%→3.7% |
| | | weekday_28 | 91.2% | 11.9% | 3.6% | 6.6%→-0.4% | 29 | 4.8% | 35.9%→62.5% | 9.4%→0.0% | 2.7%→2.0% | 13.3%→1.8% |
| | | median_weeks | 30.4% | 10.5% | 5.6% | 7.1%→0.8% | 12 | 8.2% | 36.8%→52.6% | 0.0%→0.0% | 1.7%→2.4% | 13.3%→4.9% |
| break | 77 | v2 | 58.4% | | | | | | 0.0% | | 0.0% | 1.6% |
| | | v3 | 79.2% | 27.4% | 23.7% | 27.4%→16.4% | 16 | 11.0% | 0.0%→22.2% | 0.0%→17.8% | 0.0%→3.7% | 1.6%→7.9% |
| | | v3_break | 79.2% | 27.4% | 21.3% | 27.4%→18.8% | 16 | 9.8% | 0.0%→17.8% | 0.0%→4.4% | 0.0%→1.2% | 1.6%→6.9% |
| | | v3_sustained | 79.2% | 27.4% | 23.7% | 27.4%→16.4% | 16 | 9.8% | 0.0%→22.2% | 0.0%→17.8% | 0.0%→3.7% | 1.6%→8.2% |
| | | v3_rolling_first | 79.2% | 27.4% | 21.3% | 27.4%→18.8% | 16 | 9.9% | 0.0%→17.8% | 0.0%→4.4% | 0.0%→1.2% | 1.6%→6.9% |
| | | v3_14_first | 79.2% | 27.4% | 21.3% | 27.4%→18.8% | 16 | 9.8% | 0.0%→17.8% | 0.0%→4.4% | 0.0%→1.2% | 1.6%→6.9% |
| | | v3_both | 79.2% | 27.4% | 21.3% | 27.4%→18.8% | 16 | 9.8% | 0.0%→17.8% | 0.0%→4.4% | 0.0%→1.2% | 1.6%→6.9% |
| | | weekday_28 | 41.6% | 25.7% | 25.9% | 25.7%→-25.9% | 14 | 33.1% | 0.0%→100.0% | 0.0%→88.9% | 0.0%→25.9% | 1.6%→3.8% |
| | | median_weeks | 0.0% | n/a | n/a | n/a→n/a | 0 | n/a | n/a→n/a | n/a→n/a | n/a→n/a | 1.6%→n/a |
| change | 212 | v2 | 53.8% | | | | | | 0.0% | | 0.0% | 1.4% |
| | | v3 | 93.4% | 20.7% | 19.0% | 20.7%→9.0% | 84 | 25.0% | 0.0%→44.7% | 0.0%→22.8% | 0.0%→5.0% | 1.4%→6.5% |
| | | v3_break | 93.4% | 20.7% | 19.0% | 20.7%→9.0% | 84 | 25.0% | 0.0%→44.7% | 0.0%→22.8% | 0.0%→5.0% | 1.4%→6.5% |
| | | v3_sustained | 93.4% | 20.7% | 17.3% | 20.7%→7.4% | 84 | 24.1% | 0.0%→44.7% | 0.0%→22.8% | 0.0%→5.0% | 1.4%→6.6% |
| | | v3_rolling_first | 93.4% | 20.7% | 12.9% | 20.7%→6.6% | 84 | 18.9% | 0.0%→37.7% | 0.0%→14.0% | 0.0%→3.2% | 1.4%→6.5% |
| | | v3_14_first | 93.4% | 20.7% | 16.4% | 20.7%→8.5% | 84 | 21.6% | 0.0%→41.2% | 0.0%→19.3% | 0.0%→3.9% | 1.4%→6.6% |
| | | v3_both | 93.4% | 20.7% | 17.3% | 20.7%→7.4% | 84 | 24.1% | 0.0%→44.7% | 0.0%→22.8% | 0.0%→5.0% | 1.4%→6.6% |
| | | weekday_28 | 71.7% | 17.4% | 17.2% | 17.4%→0.1% | 74 | 27.6% | 0.0%→69.2% | 0.0%→34.6% | 0.0%→8.6% | 1.4%→5.0% |
| | | median_weeks | 17.0% | 12.9% | 11.5% | 12.9%→-11.5% | 15 | 15.1% | 0.0%→100.0% | 0.0%→66.7% | 0.0%→11.5% | 1.4%→2.4% |


### Per scenario and segment (shipped default `v3_break`)

### segment: all
#### Design, v3_break, segment all
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| steady_weekdays | 306 | 56.9% | 100.0% | 174 | 17.4% | 3.7% | 17.1% | 1.7% | 6.9% | 43.1% | 0.0% | 0.0% | 0.1% | 1.0% |
| weekend_light | 346 | 61.8% | 100.0% | 214 | 16.7% | 3.8% | 16.5% | 1.9% | 5.6% | 37.9% | 0.0% | 0.0% | 0.1% | 1.0% |
| weekend_heavy | 346 | 59.2% | 100.0% | 205 | 15.9% | 4.2% | 10.9% | -0.1% | 28.3% | 56.6% | 9.8% | 2.9% | 2.5% | 2.2% |
| extended_break | 276 | 56.5% | 97.8% | 156 | 25.1% | 11.2% | 24.9% | 7.9% | 7.7% | 53.2% | 0.0% | 1.9% | 0.1% | 1.6% |
| sustained_increase | 306 | 56.9% | 100.0% | 174 | 17.3% | 5.7% | 14.6% | -3.4% | 12.1% | 60.3% | 5.2% | 12.1% | 1.3% | 4.6% |
| sustained_decrease | 306 | 56.9% | 100.0% | 174 | 23.0% | 15.3% | 22.8% | 13.3% | 6.9% | 43.1% | 0.0% | 0.0% | 0.1% | 1.0% |
| sparse_decrease | 162 | 44.4% | 96.3% | 72 | 42.1% | 24.2% | 41.6% | 20.4% | 12.5% | 68.1% | 0.0% | 0.0% | 0.2% | 1.9% |
| bursty | 306 | 56.9% | 100.0% | 174 | 40.1% | 16.2% | 8.0% | -1.3% | 47.1% | 49.4% | 43.7% | 28.2% | 16.0% | 8.7% |

#### Held-out, v3_break, segment all
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| four_day_week | 243 | 46.9% | 100.0% | 114 | 34.5% | 4.6% | 34.4% | 3.8% | 2.6% | 27.2% | 0.0% | 0.0% | 0.1% | 0.4% |
| alternating_weeks | 306 | 56.9% | 100.0% | 174 | 31.4% | 4.9% | 13.4% | 0.5% | 51.7% | 39.7% | 39.7% | 4.0% | 9.0% | 2.2% |
| gradual_ramp | 306 | 56.9% | 100.0% | 174 | 12.9% | 6.4% | 12.7% | -5.9% | 6.9% | 87.9% | 0.0% | 17.2% | 0.1% | 6.1% |
| biweekly_bursts | 306 | 56.9% | 100.0% | 174 | 18.6% | 8.8% | -18.1% | -2.7% | 89.7% | 64.4% | 82.8% | 23.6% | 18.4% | 5.8% |
| midnight_crossing | 306 | 56.9% | 100.0% | 174 | 15.9% | 2.6% | 15.6% | -0.8% | 8.6% | 62.6% | 0.0% | 0.0% | 0.1% | 1.7% |
| break_then_decrease | 273 | 56.0% | 95.6% | 153 | 18.6% | 5.7% | 18.5% | 4.8% | 2.0% | 32.7% | 0.0% | 0.0% | 0.0% | 0.4% |
| steady_weekdays | 204 | 56.9% | 100.0% | 116 | 18.3% | 3.8% | 18.1% | 1.8% | 6.9% | 43.1% | 0.0% | 0.0% | 0.1% | 1.0% |
| weekend_light | 224 | 60.3% | 100.0% | 135 | 15.4% | 2.7% | 15.2% | 0.7% | 6.7% | 45.2% | 0.0% | 0.0% | 0.1% | 1.0% |
| weekend_heavy | 229 | 58.1% | 100.0% | 133 | 14.5% | 5.8% | 7.7% | 0.2% | 40.6% | 54.1% | 14.3% | 4.5% | 3.4% | 2.8% |
| extended_break | 184 | 56.5% | 97.8% | 104 | 25.9% | 11.5% | 25.7% | 8.1% | 7.7% | 57.7% | 0.0% | 1.9% | 0.1% | 1.7% |
| sustained_increase | 204 | 56.9% | 100.0% | 116 | 17.6% | 5.4% | 15.3% | -3.4% | 12.1% | 61.2% | 5.2% | 10.3% | 1.1% | 4.4% |
| sustained_decrease | 204 | 56.9% | 100.0% | 116 | 24.2% | 15.4% | 23.9% | 13.4% | 6.9% | 43.1% | 0.0% | 0.0% | 0.1% | 1.0% |
| sparse_decrease | 108 | 44.4% | 96.3% | 48 | 44.2% | 24.6% | 43.7% | 20.7% | 12.5% | 70.8% | 0.0% | 0.0% | 0.2% | 2.0% |
| bursty | 204 | 56.9% | 100.0% | 116 | 40.4% | 17.4% | 8.6% | 0.9% | 59.5% | 50.9% | 48.3% | 29.3% | 15.9% | 8.3% |
### segment: monday
#### Design, v3_break, segment monday
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| steady_weekdays | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| weekend_light | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| weekend_heavy | 49 | 93.9% | 100.0% | 46 | 34.8% | 5.2% | 34.8% | 2.9% | 0.0% | 30.4% | 0.0% | 2.2% | 0.0% | 1.2% |
| extended_break | 54 | 0.0% | 94.4% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| sustained_increase | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| sustained_decrease | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| sparse_decrease | 24 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| bursty | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

#### Held-out, v3_break, segment monday
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| four_day_week | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| alternating_weeks | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| gradual_ramp | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| biweekly_bursts | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| midnight_crossing | 60 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| break_then_decrease | 54 | 0.0% | 88.9% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| steady_weekdays | 40 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| weekend_light | 40 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| weekend_heavy | 24 | 95.8% | 100.0% | 23 | 29.8% | 5.3% | 29.8% | 2.1% | 0.0% | 30.4% | 0.0% | 4.3% | 0.0% | 1.6% |
| extended_break | 36 | 0.0% | 94.4% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| sustained_increase | 40 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| sustained_decrease | 40 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| sparse_decrease | 16 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| bursty | 40 | 0.0% | 100.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
### segment: reset
#### Design, v3_break, segment reset
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| steady_weekdays | 27 | 22.2% | 100.0% | 6 | 29.3% | 4.6% | 29.3% | 2.5% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.0% |
| weekend_light | 29 | 27.6% | 100.0% | 8 | 31.4% | 3.0% | 31.4% | 0.9% | 0.0% | 25.0% | 0.0% | 0.0% | 0.0% | 1.0% |
| weekend_heavy | 30 | 26.7% | 100.0% | 8 | 46.2% | 5.2% | 20.7% | -0.9% | 62.5% | 75.0% | 62.5% | 0.0% | 12.8% | 3.1% |
| extended_break | 27 | 22.2% | 77.8% | 6 | 30.7% | 18.6% | 30.7% | 16.5% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.0% |
| sustained_increase | 27 | 22.2% | 100.0% | 6 | 29.3% | 1.4% | 29.3% | -1.1% | 0.0% | 83.3% | 0.0% | 0.0% | 0.0% | 1.2% |
| sustained_decrease | 27 | 22.2% | 100.0% | 6 | 29.3% | 17.8% | 29.3% | 15.7% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.0% |
| sparse_decrease | 15 | 20.0% | 80.0% | 3 | 26.4% | 2.1% | 26.4% | -2.1% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% | 2.1% |
| bursty | 27 | 22.2% | 100.0% | 6 | 42.4% | 32.6% | -42.4% | 25.0% | 100.0% | 33.3% | 100.0% | 16.7% | 42.4% | 3.8% |

#### Held-out, v3_break, segment reset
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| four_day_week | 21 | 14.3% | 100.0% | 3 | 61.6% | 8.1% | 61.6% | 8.1% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| alternating_weeks | 27 | 22.2% | 100.0% | 6 | 59.2% | 5.5% | 29.0% | 3.4% | 50.0% | 50.0% | 50.0% | 0.0% | 15.1% | 1.0% |
| gradual_ramp | 27 | 22.2% | 100.0% | 6 | 17.7% | 17.4% | 17.7% | -17.4% | 0.0% | 100.0% | 0.0% | 100.0% | 0.0% | 17.4% |
| biweekly_bursts | 27 | 22.2% | 100.0% | 6 | 32.7% | 12.4% | -32.7% | -4.1% | 100.0% | 50.0% | 100.0% | 50.0% | 32.7% | 8.2% |
| midnight_crossing | 27 | 22.2% | 100.0% | 6 | 24.6% | 3.5% | 24.6% | 0.8% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.4% |
| break_then_decrease | 24 | 25.0% | 75.0% | 6 | 37.9% | 20.0% | 37.9% | 20.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| steady_weekdays | 18 | 22.2% | 100.0% | 4 | 33.4% | 4.2% | 33.4% | 1.7% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.3% |
| weekend_light | 20 | 25.0% | 100.0% | 5 | 26.0% | 1.9% | 26.0% | 0.4% | 0.0% | 40.0% | 0.0% | 0.0% | 0.0% | 0.8% |
| weekend_heavy | 20 | 20.0% | 100.0% | 4 | 46.1% | 7.8% | 36.0% | 0.9% | 50.0% | 25.0% | 25.0% | 25.0% | 5.1% | 3.5% |
| extended_break | 18 | 22.2% | 77.8% | 4 | 35.5% | 20.7% | 35.5% | 18.1% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.3% |
| sustained_increase | 18 | 22.2% | 100.0% | 4 | 33.4% | 2.0% | 33.4% | -2.0% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% | 2.0% |
| sustained_decrease | 18 | 22.2% | 100.0% | 4 | 33.4% | 17.3% | 33.4% | 14.8% | 0.0% | 50.0% | 0.0% | 0.0% | 0.0% | 1.3% |
| sparse_decrease | 10 | 20.0% | 80.0% | 2 | 32.3% | 2.5% | 32.3% | -2.5% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% | 2.5% |
| bursty | 18 | 22.2% | 100.0% | 4 | 47.4% | 13.4% | -47.4% | 0.1% | 100.0% | 25.0% | 100.0% | 25.0% | 47.4% | 6.7% |
### segment: weekend
#### Design, v3_break, segment weekend
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| weekend_light | 40 | 100.0% | 100.0% | 40 | 19.5% | 4.1% | 19.5% | 3.3% | 0.0% | 17.5% | 0.0% | 0.0% | 0.0% | 0.4% |
| weekend_heavy | 123 | 58.5% | 100.0% | 72 | 9.1% | 4.4% | 0.2% | -1.2% | 48.6% | 63.9% | 18.1% | 2.8% | 4.4% | 2.8% |

#### Held-out, v3_break, segment weekend
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| weekend_light | 20 | 95.0% | 100.0% | 19 | 16.4% | 2.3% | 16.4% | 1.6% | 0.0% | 15.8% | 0.0% | 0.0% | 0.0% | 0.3% |
| weekend_heavy | 82 | 63.4% | 100.0% | 52 | 10.0% | 5.8% | 1.5% | -0.4% | 51.9% | 61.5% | 17.3% | 1.9% | 4.2% | 3.1% |
### segment: break
#### Design, v3_break, segment break
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| extended_break | 48 | 56.3% | 87.5% | 27 | 26.1% | 15.6% | 26.1% | 10.0% | 0.0% | 25.9% | 0.0% | 11.1% | 0.0% | 2.8% |

#### Held-out, v3_break, segment break
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| break_then_decrease | 45 | 60.0% | 73.3% | 27 | 28.5% | 24.7% | 28.5% | 24.7% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| extended_break | 32 | 56.3% | 87.5% | 18 | 25.7% | 16.2% | 25.7% | 9.9% | 0.0% | 44.4% | 0.0% | 11.1% | 0.0% | 3.1% |
### segment: change
#### Design, v3_break, segment change
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sustained_increase | 63 | 57.1% | 100.0% | 36 | 24.1% | 9.3% | 24.1% | -6.2% | 0.0% | 58.3% | 0.0% | 33.3% | 0.0% | 7.7% |
| sustained_decrease | 63 | 57.1% | 100.0% | 36 | 17.9% | 37.0% | 17.9% | 37.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| sparse_decrease | 12 | 0.0% | 75.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

#### Held-out, v3_break, segment change
| Scenario | n | v2 avail | v3_break avail | comparable n | v2 err | v3_break err | v2 bias | v3_break bias | v2 under% | v3_break under% | v2 material | v3_break material | v2 shortfall | v3_break shortfall |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gradual_ramp | 60 | 50.0% | 100.0% | 30 | 10.8% | 12.5% | 10.8% | -12.5% | 0.0% | 100.0% | 0.0% | 66.7% | 0.0% | 12.5% |
| break_then_decrease | 60 | 60.0% | 80.0% | 36 | 27.9% | 19.0% | 27.9% | 18.3% | 0.0% | 16.7% | 0.0% | 0.0% | 0.0% | 0.3% |
| sustained_increase | 42 | 57.1% | 100.0% | 24 | 24.6% | 8.7% | 24.6% | -6.1% | 0.0% | 62.5% | 0.0% | 25.0% | 0.0% | 7.4% |
| sustained_decrease | 42 | 57.1% | 100.0% | 24 | 18.2% | 37.2% | 18.2% | 37.2% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| sparse_decrease | 8 | 0.0% | 75.0% | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |


## Honest reading and limitations

1. **Underprediction share rose; material underprediction did not (outside bursty/ramp).** v0.4.0 is systematically biased high on these shapes (+15–25 % on steady weekday usage), so it rarely underpredicts. The new methods are close to unbiased (bias within ±7 % in most scenarios), so they fall below truth on roughly half of dates by a small amount. Material (>10 %) underprediction is 0 % for steady, four-day-week and weekend-light shapes; it is 28–29 % for bursty usage (v2: 44–48 %) and 17–24 % for gradual ramp and biweekly bursts. A deliberate conservative tilt would be a separate, explicit policy decision; none was added.
2. **Sustained decreases are slow to be recognized.** A 28-day pooled window keeps the old rate for weeks. Within 28 days of a sustained decrease the new default over-forecasts by about 37 % versus 18 % for v0.4.0. This is the conservative direction for budgeting but it is less accurate. The symmetric sustained-change switch narrows it only to about 29 % and costs bursty accuracy, so it stays off.
3. **Stability is not uniformly better.** Overall day-to-day stability is similar to v2 (3.5 % vs 5.2 % design; 3.2 % vs 3.1 % held-out); v2's figure covers only the biased subset of dates where it is available. Monday-morning stability improves strongly.
4. **Unobserved weekends after a reset are excluded, not zero.** The first days of a cycle use prior-cycle evidence; if the last days before a reset were unobserved, the rate is averaged over observed time only, which can read slightly high.
5. **Backtests are simulations.** Real Kiro log cadence, rounding, retention and plan changes are not modelled. Thresholds are initial policy values, boundary-tested and checked here, not calibrated on real accounts. Windows, Ubuntu and RHEL remain unverified.

## Test evidence

- `pnpm test`: 157 tests pass (130 from v0.4.0, 27 new: evidence, forecast-history, backtest acceptance). Backtest acceptance tests assert availability never below v2 per scenario and segment, Monday/weekend/reset availability and error, steady/bursty error and material underprediction not worse than v2, Monday stability, no hiding of decreases by the break heuristic, and first-day-after-reset availability, on both design and held-out sets.
- `tests/unit/backtest-report.ts` regenerates all tables (`node tests/unit/backtest-report.ts summary` or `per <candidate> <segment>`).

## Packaging and local install

- `dist/easykirogauge-0.4.1.vsix` (51,171 bytes) contains only `package.json`, `readme.md` and `dist/extension.cjs`; no tests, baseline copy, source logs, stores or dependency caches. The bundle contains no baseline module, synthetic fixture marker or local absolute path, and no exhaustive break-even code.
- Installed into the local Kiro IDE with `kiro --install-extension`; `--list-extensions` reports `easykirogauge.easykirogauge@0.4.1` and the installed `dist/extension.cjs` has the same SHA-256 as the built bundle.
- **UI check (macOS, Kiro 1.2.56, 2026-10-10):** the 0.4.1 detail view was opened from the status bar after a window reload and inspected by screenshot. It showed the Forecast section, the Observed history coverage, the new "Forecast evidence" and "Forecast qualifiers" rows in technical details, and the note "Forecast policy v3 …". The check found one defect, a stale hard-coded "Forecast policy v2" note; it was fixed, the VSIX rebuilt (50,040 bytes) and reinstalled, and the corrected note was confirmed in the reloaded window.
- **Live data limit:** the local account has only about two days of retained history (27 snapshots), so the live panel correctly reads "Collecting data" and forecast evidence rows are "Not available". A qualified pooled forecast was therefore *not* observed live; it is covered by the synthetic tests and the rendered synthetic detail page. No live account values are recorded in this repository.
