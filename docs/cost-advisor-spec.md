# Automatic Cost Advisor — specification and phased plan

Status: **Phase A implemented on `feature/cost-advisor-phase-a` (unmerged, draft).** Phases B–D are planned and gated.
Baseline: `feature/cross-platform` @ `02e6390`, bundled catalog `kiro-commercial` `2026-10-10`.
Supersedes the manual scenario-builder design. Milestone 6, PR #1, SC1 and the Windows fail-closed behaviour are unchanged.

## 1. Product behaviour

The primary experience is automatic: **recommendation first, configuration only when needed.** The "Your credit
budget" view shows a *Cost Advisor* card with one of four outcomes per planning horizon (1, 3 and 6 full billing cycles):

| Outcome | Meaning | Required inputs |
|---|---|---|
| **No action needed** | The current plan is the cheapest supported option | Plan and billing system chosen by the user, add-on state answered, supported (not conditional) comparison, no engine condition |
| **Potential savings** | A cheaper supported option exists; modelled range shown | Same as above, and the minimum modelled saving is greater than zero |
| **Conditional comparison** | Priced comparison exists but depends on stated assumptions | Any open assumption (hinted plan, assumed billing, assumed "no add-ons", unverified add-on balance) or any engine condition |
| **Insufficient information** | Nothing can be priced | No qualified forecast, no plan, or engine result unavailable |

A conditional comparison never uses the word "saving" as a conclusion and never tells the user to buy. Savings and
"no action" cannot be reached while any assumption is open.

**Reachability today (verified by test):** the cost engine marks every priced comparison `conditional` (constant-rate
demand, unverified purchase rules, unknown cohort and promotion). Phase A therefore surfaces only *conditional
comparison* and *insufficient information* in production. *No action needed* and *potential savings* are defined and
unit-tested at the classifier, and become reachable only when a future, separately approved change lifts the engine's
conditionality (Phase C: cohort, promotion and purchase facts). Until then the card never claims either outcome.

## 2. Plan inference (hint, not identification)

The reported credit limit (`usageLimitWithPrecision`) is **not verified** to be base-only. Kiro's documentation says the
IDE/CLI usage display combines add-on credits with plan credits, and unused add-ons remain available after switching
to Free until expiry. Therefore:

1. An exact match with a bundled plan's nominal credits (50 / 1,000 / 2,000 / 5,000 / 10,000) yields a **hint** with
   confidence `moderate` and reasons `limit_semantics_unverified`, `nominal_match_only`. Any plan, including Free and
   Pro, can be matched by a different plan plus retained add-ons if the limit is combined; no claim of uniqueness is made.
2. No match yields no hint (`none`). A candidate explanation such as "a lower plan plus add-ons" is never used in
   calculations and is never presented as a statement that purchased credits exist.
3. **Precedence:** explicit user selection > hint > unknown. A changed reported limit alone does **not** invalidate an
   explicit selection (purchases, expiry and billing changes can all move a combined limit).
4. Hints are recomputed every time and never persisted as confirmed.

## 3. Minimal questions (native, no scripts)

Reached from the light-bulb status bar item shown while the view is open (the title-bar button does render in Kiro but was easy to overlook in the owner's native test), the title-bar button where rendered, the in-view text and the Command Palette entry
`Cyclegauge: Cost Advisor`. At most four questions, each with *Not sure*, which keeps results conditional:

1. Plan (confirm one of the five, or not sure).
2. Billing system (personal, Enterprise, not sure). Enterprise skips consumer add-on questions: prepaid add-ons and
   postpaid overages are separate and consumer purchase rules are not applied.
3. Purchased add-on credits: none / yes / not sure.
4. If yes: remaining add-on credits (may be left empty = unknown). Remaining credits are never derived from an
   original purchase amount.

Purchase amounts in USD/EUR and expiry dates are Phase C; EUR needs a user-entered exchange-rate basis and never
implies a remaining balance.

## 4. How false purchase advice is prevented

- Unknown stays unknown: "not sure" is never zero. The only hypothesis is "no purchased add-ons", and it is returned
  as an explicit assumption that forces the outcome to *conditional comparison*.
- The reported remaining credits are used as plan remaining only when add-ons are none or assumed none; with an
  unverified add-on balance the plan remainder is unknown and the engine reports it.
- The engine is unchanged (pricing catalog, demand builder, optimizer, simulation). The Advisor only builds a
  manual-provenance billing profile and labels the engine's output.
- Offline only. No telemetry, no authenticated API access, no online price requests, no purchases. Prices and
  assumptions stay traceable to the bundled catalog, whose version and review date are shown on the card.

## 5. Data-contract verification (owner-run)

`scripts/verify-limit-contract.mjs` is a small, auditable, read-only script the **owner** runs on their own machine. It
reads only `q-client.log*` files under `<source-root>/logs/*/*/exthost/kiro.kiroAgent/`, only lines containing
`GetUsageLimitsCommand`, skips symbolic links (every directory on the path is lstat-checked, files are opened with
`O_NOFOLLOW|O_NONBLOCK`), applies the collector's record checks, keeps `output.userInfo.userId` in memory only to count
and separate accounts (it is never printed), writes nothing, opens no network connection and prints one JSON object of
counts, booleans and tokens from closed lists (no paths, values, timestamps, titles, identifiers or raw lines).

Interpretation of `limit_tokens`: `nominal_<plan>` (limit equals that plan's nominal credits),
`exceeds_<plan>_within_addon_range` (limit exceeds the nearest lower plan's credits by an amount a purchase set could
explain; other combinations could explain it equally, so it is not an identification) and
`no_catalog_explanation`. `limit_changes_within_cycle_count > 0` (counted per account and cycle, in log-time order, using only records that pass
the collector's checks) shows that the limit moved inside a cycle. It is necessary but not sufficient evidence for the
combined-capacity reading: a plain mid-cycle plan change also moves it; `bonuses_nonempty_seen` and `overage_credits_nonempty_seen` show whether those
schemas have ever been populated. `plan_token_agrees_with_nominal_limit` compares the classified
`subscriptionInfo` type/title with the nominal match. The extraction allowlist is not changed by this script.

Parity statement: record acceptance is the collector's own parser (`src/projection.ts`). File framing is separate and
slightly different by design: lines are split on bytes, must be valid UTF-8 (otherwise counted as `malformed_record`),
are limited to 256 KiB in bytes (`records_too_long`), and an unterminated final line is counted
(`records_partial_unterminated`) and not parsed. The script exits with `RUNTIME_UNSUPPORTED` when the JSON reviver
source text needed for exact decimals is unavailable. Records at equal instants keep file order, which comes from the
directory listing, so flapping between equal-instant records is possible and is not evidence of a change.

### 5.0 Records dated in the future

`records_dated_after_now_by_bucket` counts accepted records ahead of this computer's clock in four closed buckets
(`le_2m`, `le_1h`, `le_14h`, `gt_14h`). A cluster near the zone difference suggests a time-zone mismatch; a few seconds
suggests clock skew. The application ignores records beyond a 2-minute tolerance (flag `future_records_ignored`) and
fails closed only when no usable record remains.

### 5.1 Time zone of the log timestamps

Kiro's account-log timestamps have no UTC offset. The collector interprets them in `cyclegauge.sourceTimezone` (or the deprecated `easykirogauge.sourceTimezone`)
(empty = this computer's zone). The script does the same: **default = this computer's zone**; pass
`--source-timezone <IANA zone>` only if you changed that setting or Kiro ran in another zone. The zone affects only
record ordering and the resolution of wall-clock times; ambiguous or non-existent daylight-saving times are rejected by
the production parser and counted in `records_rejected_by_status`. Output reports `source_timezone_origin`
(`device` or `argument`) and `assumed_source_timezone_seen`, never the zone name.

## 6. Phased plan

| Phase | Content | Gate |
|---|---|---|
| A (this change) | Spec; "reported" wording fix; plan hint; four outcomes; session-only answers; native action in the panel; token-only verification script; regression fix for forecast-derived demand | Independent review; owner approval; no merge without it |
| B | **SC5:** persisted explicit inputs as an account-bound local storage class: separate `cost-inputs.json` (0600 in the 0700 store directory, atomic write, schema-versioned, strict parse, size/count caps), HMAC binding to the opaque account partition, concurrent-window safety, stale-balance confirmation, Windows disabled with Windows storage | Written SC5 specification, independent security review, approval |
| C | Verified limit semantics from the owner-run script; optional purchase amount (USD/EUR with rate basis), expiry dates, Enterprise overage/headroom questions; optional scripted inline form only if native controls prove unacceptable | Owner decision on script results |
| D | Native macOS verification of the Advisor UI on an isolated instance with synthetic data; versioned release candidate | Owner approval |

## 6.1 UI simplification (after Phase A)

The standalone Cost Optimizer UI is removed: no separate section, link, configure/edit/clear commands, title-bar
buttons or manual profile prompts. The Cost Advisor is the single user-facing entry point. The engine
(`src/cost/*`, `calculateCosts`, `presentCost`) is unchanged and is reached only through the Advisor; per-strategy
costs, assumptions and sensitivity are in the card's collapsed "Compare options, assumptions and sensitivity" details.
The picker has a "Clear my answers" item instead of a separate command.

## 7. Defect found and fixed in Phase A

Forecast-derived demand (the only automatic demand source) was rejected by the optimizer's assumption allowlist
(`long_history_future_rate` and `short_window_long_horizon` were produced by the demand builder but not accepted by
`validDemand`), so every forecast-demand comparison was `invalid_cost_input`. The two codes were added to the
allowlist; no algorithm changed. A regression test covers it.

## 8. Terminology kept for compatibility

The CLI/`--json` keys `baseLimit` and `remainingBaseCredits`, and the forecast assumption code `base_credits_only`, are
public or pinned contracts and keep their names. They mean the *reported* limit and *reported* remaining credits; the
limit is not verified to be base-only. Human-readable text uses "reported".

## 8. Numerical estimates (modelled savings)

Added on top of Phase A without changing the catalog, demand builder, simulator or optimizer. `src/cost/estimate.ts`
reads the optimizer result per horizon and assigns one of four tiers:

| Tier | Meaning |
|---|---|
| **Supported estimate** | Every input explicit and the engine's own classification is *potential savings* / *no action*. Not reachable in production today; never used for a move to Free. |
| **Modelled estimate** | The current plan and an alternative are both calculable over the same full billing cycles. Unconfirmed assumptions (hinted plan, assumed billing, assumed "no add-ons", unknown cohort/promotion) are listed beside the figure. |
| **Cost comparison only** | Alternatives can be priced but the current plan cannot, so no difference is computed. |
| **Insufficient information** | Nothing can be priced, or the inputs are unusable (add-ons present or unknown, Enterprise, usage above the reported limit, a limit that differs from the plan, stale or mismatched balances, hypothetical catalog, opening purchased lots). |

Rules: only *keep the plan* and *change plan at the next UTC reset* are compared (they share the same partial cycle, so
only full future cycles differ). The figure is the lowest **calculable** option, never a global optimum; unpriced options
and a cheaper immediate upgrade are flagged. A tie prefers the current plan. Differences round down and costs round up.
The card leads with the next-cycle figure, its period (UTC, start date and length), USD, the assumptions and the
"modelled list-price difference, not a guarantee, not realised, not an invoice" note. 1-, 3- and 6-cycle lines, the
75/100/125% sensitivity, conditions and full calculations are under expandable details. When the lowest-cost plan changes
with usage the card says so. The inferred plan is offered first ("Yes, I'm on X") in the native picker.

Headline wording: when the lowest-cost plan changes with usage or any usage level (75/100/125%) has an unpriced option,
the figure reads "USD N under your current forecast" (never "up to", because no upper bound is known) with one short
limit line; the calculated range is only in the details, marked "not a complete bound". Reasons, assumptions and the
fit of the forecast within the plan's credits sit under "Why this figure and its limits". The confirm-or-correct plan
instruction appears once.
