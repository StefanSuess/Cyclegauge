# Milestone 4C implementation plan (approved 2026-10-10, with refinements)

## Approved refinements (mandatory)

1. **Observed zero net change is not proven inactivity.** An unchanged counter between two real snapshots is *observed zero net change*; it is exposure with zero credits and carries the assumption `zero_net_change_not_proof_of_inactivity`. Missing snapshots never imply zero usage: unobserved time is excluded from exposure (`unobserved_periods_not_zero`).
2. **Independent comparable observations.** A pooled window needs enough *independent* evidence, not just elapsed coverage across few snapshots: minimum snapshots, minimum distinct UTC days with a snapshot, minimum observed exposure, and no single interval supplying more than half of the exposure (`dependent_window`). Implemented thresholds (policy v3): 7 d: exposure ≥ 6 d, ≥ 8 snapshots, ≥ 4 days; 14 d: ≥ 12 d, ≥ 10, ≥ 6; 28 d: ≥ 24 d, ≥ 16, ≥ 12; 84 d: ≥ 72 d, ≥ 40, ≥ 30.
3. **Heuristics are evidence-gated.** Completed-break exclusion and sustained-change selection are policy switches enabled only if the walk-forward backtest shows improvement without hiding genuine long-term decreases or regressing steady/bursty usage. Results are recorded in [milestone-4c-validation.md](../../milestone-4c-validation.md).
4. **Separate reporting** of availability, comparable-date error (plus signed bias), underprediction risk (share, material share >10 %, mean shortfall) and day-to-day stability, on design scenarios and a held-out set (new shapes and seeds) that was not used to choose thresholds.
5. **Version 0.4.1** for Milestone 4C; 0.5.0 is reserved for the visual analytics dashboard. No charts.

Constraints carried over: collector, Store, projection, privacy safeguards, account isolation and Cost Optimizer billing semantics are unchanged; no automatic Git commits.

## Original approved plan


## Context

v0.4.0 forecasts are built only from the current billing cycle and only from "dense" observations. Reviewing `src/store.ts`, `src/history.ts`, `src/forecast.ts` and `src/cost/demand.ts` shows four causes of fragile forecasts (inferred from code, not from live data):

1. **History is already retained, but discarded at read time.** `Store.snapshots()` returns every snapshot ever ingested (no pruning, per-account HMAC partition, billing-only body). `history()` keeps only the latest contiguous `resetAt` run (`history.ts:45-53`). A reset erases forecasting until 48 h / 3 snapshots accumulate again. **No schema change is needed.**
2. **The 36-hour rule treats a quiet weekend as a quality barrier** (`history.ts:69`, `forecast.ts:56`). A user whose IDE is closed Friday evening to Monday morning loses the window every Monday and can never reach the regular tier.
3. **`rolling_7_day` needs a snapshot exactly 7×24 h before the latest one, to the millisecond** (`forecast.ts:84`), so live selection falls through to `observed_window`, which is not week-aligned.
4. **The Cost Optimizer multiplies whatever window was selected by up to six months** (`demand.ts:49,69`) and reconstructs the rate from current-cycle endpoints.

Key fact: the usage counter is cumulative within a cycle. For two same-cycle, same-limit snapshots the net change between them is known however long the gap; only its distribution over the days inside is unknown. An unchanged counter is **observed zero net change**, not proof that no billable activity occurred. Missing snapshots alone never imply zero. The stretch between the last snapshot of a cycle and its reset is unknown.

## Trade-offs

| Approach | Strength | Weakness |
| --- | --- | --- |
| Short rolling averages (48 h, 7 d) | React fast; available early | High variance; a 48 h window is blind to the weekly pattern; dense gates fail on weekends |
| Longer windows (28 d, multi-cycle) | Low variance; a whole-week multiple contains the weekday/weekend mix; survives resets | Lag behind genuine changes; diluted by a holiday; must stop at plan changes |
| Weekday-aware profile | Correct for short horizons and exhaustion dates | 7 parameters from few samples; needs dense observation for 3+ weeks; UTC vs local weekday |

Median/trimming is not proposed: usage is right-skewed and a median under-forecasts a cumulative total. The backtest includes a median-of-weeks candidate to demonstrate this.

## Design

Additive: the three existing methods, tiers and thresholds stay. Store schema, collector, projection and cost simulation/optimization are untouched.

### 1. Cross-cycle evidence in `history()` (`src/history.ts`)

- Share the existing grouping/conflict step; `points`, `intervals`, `days`, `coverage` keep their current-cycle meaning.
- Add `evidence` (trailing 85 UTC days at most), built by walking back from the latest point:
  - `cycles[]`: `resetAt`, evidence-backed `startAt | null`, `baseLimit`, first/last observation, snapshot count.
  - Intervals only between consecutive points of the same cycle, plus a cycle-head interval `[startAt, first point]` when the start is evidence-backed (the rule `cycle_to_date` already uses). Nothing is subtracted across a reset; a cycle's tail after its last snapshot is excluded from exposure, never counted as zero.
  - **Regime stops**: base-limit change, reset regression/unknown reset, `unsupported_extra_credits`. **Local exclusions**: conflicting snapshots, missing billing, counter decrease.
  - Output is billing-only: `days[] {day, netChange, observedMilliseconds, zeroNetMilliseconds, snapshots}` and `spans[] {from, to, netChange}`.
    - interval inside one UTC day → that day;
    - zero-change interval → split across the days it covers as observed zero net change (tracked in `zeroNetMilliseconds`, assumption `zero_net_change_not_proof_of_inactivity`); not applied when an endpoint is `reduced_precision`;
    - positive interval crossing midnight → a span: total known, days unattributed. No interpolation.
- Account isolation unchanged.

### 2. Gap rule (policy v3)

An interval > 36 h is a barrier for the existing dense methods only if its net change is positive. A zero-change interval between two real snapshots is comparable. Positive gaps count in the new window means as spans.

### 3. New methods in `forecast()` (`src/forecast.ts`)

Exposure-weighted mean over complete UTC days before the latest observation's UTC day: `rate = Σ credits / Σ observed time` of day rows and spans wholly inside `[D−N, D)`.

| Method | Window | Regular tier requires |
| --- | --- | --- |
| `history_7_day` | 7 d | exposure ≥ 6 d, ≥ 8 snapshots, snapshots on ≥ 4 distinct UTC days |
| `history_14_day` | 14 d | exposure ≥ 12 d, snapshots on ≥ 6 distinct UTC days |
| `history_28_day` | 28 d | exposure ≥ 24 d, snapshots on ≥ 12 distinct UTC days |
| `history_84_day` | 84 d | exposure ≥ 72 d, snapshots on ≥ 30 distinct UTC days |

- Independence gate for all four: no single interval may supply more than half of the window's exposure. Thresholds are initial values in `policy`, boundary-tested and checked in the backtest.
- Each estimate carries exact `evidenceCredits`, `evidenceMilliseconds`, `cyclesUsed`, `observedDays`.
- Schema/policy version 3; new estimates appended after the existing three. No confidence intervals.

### 4. Selection policy

Existing top-level blocks stay first. Then `history_28_day` → `history_14_day` → `history_7_day` → `rolling_7_day` → `cycle_to_date` → `observed_window` (regular, then provisional).

Two heuristics are implemented as policy switches and **enabled only if the walk-forward backtest shows an improvement without hiding genuine long-term decreases**:
- **Sustained increase**: two most recent 7-day blocks both above the older half of the 28-day window by more than 3:2 → `history_14_day`.
- **Completed-break exclusion**: a completed run of ≥ 5 zero-net UTC days followed by observed positive usage is removed from exposure for in-cycle methods. Weekends are never excluded.
Otherwise they stay off and only qualifier codes are reported (`recent_usage_higher`, `recent_usage_lower`, `extended_zero_net_period_in_window`).

### 5. Cost Optimizer (`src/cost/demand.ts` only)

- Rate from the estimate's exact `evidenceCredits / evidenceMilliseconds`, re-verified against a fresh `forecast()` run. Identical numbers for existing methods.
- Bridge: selected method. Future cycles: longest qualified of `history_84_day` → `history_28_day`, else the selected method plus assumption `short_window_long_horizon`.
- No change to status semantics, manual demand, catalog, simulation or optimization.

### 6. Weekday-aware projection

Backtest candidate only; becomes a method only if it beats `history_28_day` on weekday scenarios without regressing steady/bursty ones. Otherwise documented as evaluated and deferred.

## Implementation steps (test-driven)

1. Backtest harness (`tests/unit/backtest.ts`) with seeded synthetic generator and a frozen copy of v2 `history`/`forecast` as baseline.
2. Evidence in `src/history.ts` + `tests/unit/evidence.test.ts`.
3. Gap rule.
4. Pooled methods, selection, schema v3 + `tests/unit/forecast-history.test.ts`.
5. Demand adapter + tests.
6. Heuristic and weekday decisions from backtest numbers.
7. Presentation text (no charts).
8. Docs (SPEC, ARCHITECTURE, ROADMAP, README, AGENTS, `docs/milestone-4c-validation.md`); version **0.4.1**. No commits.

## Backtest reporting and acceptance

Reported separately, old vs new, for design scenarios and a held-out set (4-day week, alternating heavy/light weeks, gradual ramp, biweekly bursts, usage crossing UTC midnight, other seeds) that is not used to choose thresholds:
- availability;
- error of projected usage at reset on comparable dates (both qualify) and on new-only dates;
- underprediction risk (share below truth, mean shortfall);
- day-to-day stability.

Acceptance: availability ≥ baseline everywhere; qualified forecast on the first day after a reset given ≥ 24 d prior exposure; comparable-date error and underprediction not worse than baseline on steady/bursty and better on weekday/weekend/reset scenarios; same on held-out. Heuristics enabled only as stated in section 4.

## Verification

`pnpm test`, typecheck, `python3 tests/fixtures/kiro/validate.py`, `git diff --check`, CLI `--json` on a synthetic root, VSIX build + allowlist check, install in local Kiro and check the detail panel (live data viewed only in the IDE, never copied or printed).

## Completion report

Old-versus-new for Monday mornings, billing resets, weekends, extended breaks and sustained increases/decreases, with the four metrics, held-out results and any rejected heuristic.

## Not in scope

Milestone 5 charts, Store schema/retention, collector/projection changes, session/CLI/Crew sources, billing or purchase semantics, probability intervals, automatic commits.
