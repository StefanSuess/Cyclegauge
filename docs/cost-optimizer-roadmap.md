# Milestone 4 — Intelligent subscription and cost optimizer

**Status: Milestone 4A accepted (113 tests); Milestone 4B Task 5 and responsive-comparison prerequisite approved and implemented on 2026-10-10. See [M4B evidence](milestone-4b-validation.md). Milestone 5 remains deferred.** Reviewed 2026-10-10 against v0.3.2. The goal is to minimize estimated future expenditure for a stated credit requirement, with sufficient evidence to explain each recommendation. Correct financial boundaries take precedence over always producing an answer.

This document is the Milestone 4 design and billing-evidence register. The [implementation plan](superpowers/plans/2026-10-10-milestone-4.md) defines delivery tasks. The [Milestone 5 dashboard proposal](milestone-5-visual-dashboard.md) is documentation only.

## 1. Existing architecture and scope

Reviewed `src/forecast.ts`, `history.ts`, `decimal.ts`, `view.ts`, the extension controller/presentation/native adapter, packaging, SPEC, ARCHITECTURE and ROADMAP. Package version is 0.3.2. The existing validation report records 64 synthetic tests; that evidence does not establish predictive accuracy or billing semantics for purchased credits.

- `forecast()` exposes schema/policy v2, selected method, tier, window, as-of/reset and projected base-credit usage. Its displayed rate/projections are truncated to six decimals. The optimizer must not silently treat these as exact purchase inputs.
- `history()` supplies comparable endpoints and explicit gaps without public account keys. Use these endpoints to reconstruct the selected method's exact rational rate after checking forecast eligibility.
- `view()` is billing-only. `startExtension()` collects and renders it. `present()` supplies the existing budget cards; the native adapter owns commands and a script-disabled webview.
- The collector's limit is not verified as base-only for accounts with purchased credits. Neither that limit, the overage fields nor empty bonus arrays establish plan, purchased balance or billing eligibility.
- Keep the log collector, Store schema, CLI contract and forecast policy unchanged. No new source adapters, Kiro SQLite access, session aggregation, Crew integration, actual-invoice ingestion or efficiency analysis.

The repository's AGENTS scope paragraph predates implemented Milestone 3. The subsequent user approval authorizes M4A Tasks 1–4 only. AGENTS/SPEC/ARCHITECTURE/ROADMAP record that scope while preserving every privacy rule.

### Architecture alternatives

| Approach | Benefit | Problem / decision |
| --- | --- | --- |
| Pure deterministic engine plus explicit profile and existing detail view | Testable arithmetic, small integration surface, no services | **Recommended**; gated scenarios can remain conditional |
| Monthly price lookup/formula in presentation | Smallest initial edit | Cannot reliably model existing lots, expiry, transitions or cash timing; reject |
| General optimization solver, automatic billing discovery and new dashboard | More possible schedules and automation | Larger unverifiable input surface and unnecessary infrastructure; defer |

M4A delivers the engine and synthetic tests. M4B adds manual inputs and recommendations. Each stage requires its own acceptance evidence. Financial calculations execute locally with no runtime dependencies or network fetches.

## 2. Verified official billing reference

Public sources were read on **2026-10-10** using generic requests only. These are published rules, not verified facts about a user's account or local log schema. Page update dates are not legal effective dates. Prices and rules must be rechecked before implementation and release.

| Plan | Monthly USD list fee | Included credits |
| --- | ---: | ---: |
| Free | 0 | 50 |
| Pro | 20 | 1,000 |
| Pro+ | 40 | 2,000 |
| Pro Max | 100 | 5,000 |
| Power | 200 | 10,000 |

Standard prices exclude taxes/duties. Plan credits do not roll over. Enterprise has no Free tier. GovCloud's approximately 20% uplift is insufficient for exact prices. A first-paid subscription promotion exists; its application is not inferred. [Pricing](https://kiro.dev/pricing/).

| Rule ID | Published rule and source | Treatment |
| --- | --- | --- |
| B1 | Consumer add-ons cost USD 0.04/credit; minimum USD 5 / 125 credits, maximum USD 100/pack, at most five packs at a time. Payment is immediate. [Add-ons](https://kiro.dev/docs/billing/add-on-credits/) | Consumer paid plans only; minimum is not purchase step |
| B2 | Plan allocation precedes purchased credits; earliest-expiring pack first; unused purchased credits carry forward for 12 months from purchase. IDE/CLI display can combine capacities. [Add-ons](https://kiro.dev/docs/billing/add-on-credits/) | Separate lots, plan balance and expenditure |
| B3 | First Free-to-paid month is prorated with full allocation; further upgrades in that month use the original paid start. Later paid upgrades charge the full monthly fee difference and rerate cycle usage. Remaining purchased credits are preserved. [Billing](https://kiro.dev/docs/billing/) | Separate first-paid and established-paid cohorts |
| B4 | Billing follows UTC calendar months; later upgrades charge immediately. The FAQ gives USD 6.67 then USD 6.66 additional for its first-month example. [Billing FAQ](https://kiro.dev/docs/billing/related-questions/) | Calendar boundaries verified; exact rounding policy still unresolved |
| B5 | Downgrades take effect next cycle with no current-month reduction; purchased credits carry over. [Downgrading](https://kiro.dev/docs/billing/downgrading/) | No immediate downgrade savings |
| B6 | Cancellation moves to Free next cycle; unused purchased credits remain available until expiry. [Cancelling](https://kiro.dev/docs/billing/cancelling/) | Existing retained lots on Free are distinct from eligibility to buy new ones |
| B7 | Enterprise upgrades refund the lower subscription and charge the higher fee; cycle usage is rerated. Downgrades apply next month; new subscriptions have proration. [Enterprise billing](https://kiro.dev/docs/enterprise/billing/) | Separate postpaid implementation, per user and profile |
| B8 | Enterprise overages are opt-in, USD 0.04/credit billed at month end. [Pricing](https://kiro.dev/pricing/) | Never consumer pack purchases |
| B9 | Enterprise overages default off and are governed by a profile quota; the default can vary. [Subscription management](https://kiro.dev/docs/enterprise/subscription-management/) | Require explicit eligibility and applicable headroom; never invent cap |

### Open rules and decision gates

| Uncertainty | Evidence / resolution required | Safe M4 behavior |
| --- | --- | --- |
| Purchase step, fractional purchase support and currency rounding | B1 gives bounds, not an increment; public purchase examples do not establish every allowable quantity | `purchaseStepCredits = null`; no exact arbitrary pack recommendation. Conditional cost floor only, or calculations under an explicitly supplied hypothetical step |
| Pack slot lifecycle | Meaning of “five at a time” after depletion, pending payments and partial depletion is not fully specified | Do not promise sequential refills. Require a known free slot for each proposed purchase; otherwise conditional/unavailable |
| Restoration of already consumed packs after upgrade | B3/FAQ describe rerating, but no lot-level restoration/expiry ledger | Do not refund historical spend or recreate consumed packs. Exact bridge upgrade only if no prior add-on consumption is confirmed, or a future validated rerating contract supplies the resulting inventory |
| Generic upgrade wording | [Upgrading](https://kiro.dev/docs/billing/upgrading/) broadly says prorated; B3 and FAQ explicitly distinguish cohorts | Record scoped precedence of the detailed cohort rules, not a universal prorated upgrade |
| First-month rounding, day inclusion and promotion accounting | FAQ examples and pricing promotion description do not fully specify the algorithm or user's eligibility | First-paid immediate charges remain conditional; show regular full-cycle scenarios with promotion exclusion visible. Do not claim actual first invoice or stack guessed credits |
| Free and retained add-ons | B6 preserves availability; FAQ broadly says Free does not support add-ons | Use B6 only for retained lots after a paid cancellation; forbid new Free purchases. Other Free-with-lots cases remain conditional |
| Consumer vs Enterprise, discounts and region | Not established by current account projection | Explicit user selection; custom contracts/GovCloud exact recommendations unavailable without separately reviewed rules |
| Reset contradicts UTC first-of-month | B4 does not prove that every observed field maps to that schedule | Preserve observed reset; withhold transition calculations on conflict. Never rewrite historical boundaries |
| Future price stability / true effective dates | Current public pages do not guarantee next six months | Future scenarios explicitly assume unchanged catalog; no retrospective invoice calculation |
| Balances and demand attribution | Combined local display and unsupported extras; net counter rate is not gross billable work | Manual balance/usage inputs or conditional forecast adapter; no unsupported automatic profile detection |

No authenticated portal inspection or service calls are required to close these gates in M4. Unresolved cases remain visible rather than blocking unrelated comparisons.

## 3. Catalog and profile contracts

Use a bundled, immutable, versioned data catalog behind a validator, not price constants scattered through formulas. Runtime configuration means selecting a reviewed catalog/billing cohort; arbitrary user prices are hypothetical inputs and cannot become verified catalog evidence. No automatic catalog downloads or telemetry.

Catalog metadata: schema version, catalog ID/version, `verifiedOn`, public source URL/section per rule, `effectiveFrom`/`effectiveTo` nullable, currency, commercial/GovCloud/custom market, and rule-level `verified | unknown | conflicting` status. Unknown effective dates stay null. An application `reviewBy` of 30 days after verification is a conservative product policy, not Kiro policy: after it, comparisons are conditional and show catalog age. Every future scenario says prices are assumed unchanged. Known dated rule changes split the simulation at their effective boundary.

Input bounds reuse the existing 256-character decimal limit; at most five plan choices, five opening consumer lots and six future cycle totals are accepted. Simulations have a 100,000-event limit; exceeding a bound returns a fixed unavailable code. Profile inventories older than 24 hours are conditional (application policy), and as-of mismatch is always disclosed. Validation rejects negative/invalid decimals, unsupported units/currency, duplicate tiers, missing provenance, overlapping contradictory rule periods, inconsistent pack bounds and consumer/Enterprise mixing. Unknown rules are represented explicitly, not defaulted. Rule completeness is assessed per strategy: a missing pack step need not block a no-purchase scenario.

Proposed public interfaces (`src/cost/types.ts`); all names below are design, not implemented exports:

```ts
type PlanId = 'free' | 'pro' | 'pro_plus' | 'pro_max' | 'power';
type Status = 'available' | 'conditional' | 'unavailable';
type Decimal = string;
type Instant = string; // validated timestamp with offset; compare as UTC instants
type Knowledge<T> = { kind: 'known'; value: T } | { kind: 'unknown' };
type Money = { currency: 'USD'; amount: Decimal };
type Rational = { numerator: bigint; denominator: bigint }; // internal only
interface PurchasedCreditLot {
  remainingCredits: Decimal;
  expiresAt: Instant | null;
  expiryPrecision: 'instant' | 'day' | 'unknown';
}
interface BillingProfile {
  provenance: 'manual';
  confirmedAt: Instant;
  billingSystem: 'consumer_prepaid' | 'enterprise_postpaid' | 'unknown';
  market: 'commercial' | 'govcloud' | 'custom' | 'unknown';
  currentPlan: PlanId | null;
  allowedPlans: PlanId[]; // explicitly selected feature/eligibility constraints
  cohort: 'established_paid' | 'first_paid_month' | 'never_paid' | 'returning_free' | 'unknown';
  firstPaidAt: Instant | null;
  promotion: 'none_confirmed' | 'present_or_unknown';
  resetAt: Instant | null;
  planRemaining: Knowledge<Decimal>;
  cycleUsageForRerating: Knowledge<Decimal>;
  priorAddOnConsumption: 'none_confirmed' | 'present_or_unknown';
  purchased: Knowledge<PurchasedCreditLot[]>;
  availablePackSlots: Knowledge<number>;
  enterpriseOverage: { enabled: Knowledge<boolean>; headroomCredits: Knowledge<Decimal> };
}
interface DemandScenario {
  id: 'low' | 'base' | 'high';
  source: 'forecast_provisional' | 'forecast_regular' | 'manual';
  anchorAt: Instant;
  beforeReset: Knowledge<Rational>; // future demand from anchorAt, not cycle total
  futureCycles: { from: Instant; to: Instant; credits: Rational }[];
  withinCycle: 'constant_rate_assumption';
  assumptions: string[]; // fixed codes; no free text or identifiers
}
interface Strategy {
  id: string; // deterministic public enumeration, never an account key
  targetPlan: PlanId;
  timing: 'keep' | 'now' | 'next_reset' | 'now_then_revert_at_reset';
  extras: 'as_needed' | 'none';
}
interface CostScenario {
  strategy: Strategy;
  demandId: DemandScenario['id'];
  status: Status;
  reasons: string[];
  effectiveAt: Instant | null;
  bridge: CostBreakdown; // anchor to next reset, shown separately
  future: CostBreakdown; // N complete cycles, explicit dates
  assumptions: string[];
}
interface CostBreakdown {
  from: Instant; to: Instant;
  newSubscriptionSpend: Money | null;
  newAddOnSpend: Money | null;
  newOverageLiability: Money | null; // not a prepaid charge
  totalNewExpenditure: Money | null;
  additionalCreditsNeeded: Decimal | null;
  unmetDemandCredits: Decimal | null;
  openingPurchasedCredits: Decimal | null;
  existingCreditsConsumed: Decimal | null;
  expiredPurchasedCredits: Decimal | null;
  closingPurchasedCredits: Decimal | null;
  purchases: { modeledAt: Instant; credits: Decimal; spend: Money }[];
}
```

`PricingCatalog` contains the metadata above, plan fee/allowance entries, separate consumer/Enterprise rules, step/slot/expiry rules and transition evidence. `CostRequest` contains `{ now, horizonMonths: 1 | 3 | 6, catalog, profile, demands }`. `CostOptimization` contains `{ schemaVersion: 1, status, catalogVersion, reasons, scenarios, baselineStrategyId, recommendation, savings, breakEven }`. Recommendation is null or an evaluated strategy ID plus supporting demand IDs. Savings are baseline minus candidate expenditure for the **same** date range, demand, billing regime and opening inventory, separately for bridge and future. Break-even returns conditional usage points/tie intervals with assumptions, not a single universal number. `BreakEvenResult` contains `{ status, reasons, basis, points, intervals, assumptions }`; points carry compared plan IDs and a decimal credit amount, intervals carry lower/upper credit bounds, endpoint inclusion flags and tied/winning plan IDs. `basis` is `single_full_cycle_no_opening_lots` or `conditional_linear_reference`. Unavailable numerical outputs are null, never zero. Preserve negative savings.

## 4. Demand adapter and horizon meaning

Functions: `buildDemand(forecast: ForecastResult, history: AccountHistory, manual: ManualDemand | null, profile: BillingProfile, horizonMonths: 1 | 3 | 6, now: Instant): DemandResult`; `ManualDemand` contains an explicit as-of instant, optional credits still needed before reset, and one or N future cycle totals, plus low/high factors. `DemandResult` contains status, fixed reasons and zero or three `DemandScenario` values.

- Use the selected, qualified forecast method and exact endpoint delta/duration (cycle-to-date uses its proven cycle start and usage). Reject schema mismatch or endpoints that no longer match the selected window. Do not derive demand from rounded status-bar text or a daily budget allocation.
- A fresh regular forecast is a usable rate estimate, not a guarantee of future billable demand. Provisional forecasts retain their limited-history label. Unsupported extras, stale/conflicting/multi-account states stay blocked for automatic use. Manual demand works independently and is labeled hypothetical; it does not repair local data quality.
- Manual profile balances and remaining demand must share the anchor instant. A forecast can be evaluated from a user-confirmed current balance using its qualified rate. If inventories are older, do not silently subtract estimated usage from them and call them current; return an as-of conditional model or request reconfirmation. Usage since that anchor remains unknown.
- Current-period demand is **additional demand from the anchor until reset**. It must not include credits already consumed. For upgrades, total cycle usage needed for rerating is separately explicit; no inferred combined/base usage.
- Main 1/3/6-month comparison means **N complete billing cycles starting at the next verified reset**. Show the exact dates. Present the partial current cycle as a separate “Before next reset” bridge. Combined bridge-plus-N figures may be shown only with that label; never call the bridge alone a full month. At a reset boundary, bridge length is zero and N cycles start then.
- Future cycles use UTC calendar boundaries only for a confirmed applicable B4 schedule; February/leap years and 30/31-day months use actual durations. This future scenario schedule does not fabricate historical cycle starts or daily observations.
- Repeat the exact daily rate across future cycle lengths, or accept explicit monthly totals. Repeating a manual total is a stated stable-month assumption. Within-cycle uniform demand is a modeling assumption used for expiry/timing; it never fills observed gaps.
- Default sensitivity policy: 75%, 100%, 125% of **future demand**. Factors are editable assumptions, not probabilities or empirical confidence. Do not scale already observed usage or existing inventory. Allow a manual per-cycle vector for occasional spikes. Validate ordered nonnegative factors; zero demand is valid.
- Three- and six-month outputs are always conditional scenarios under sustained usage/prices. If the winning strategy changes between low/base/high cases, present the alternatives and their savings ranges; do not issue a categorical switch recommendation. A range is scenario spread, not a confidence interval.

## 5. Small deterministic engine

Modules proposed: `types.ts` (contracts), `catalog.ts` (data/validation), `demand.ts` (adapter), `money.ts` (exact rationals and explicit rounding), `simulate.ts` (single strategy), `optimize.ts` (candidate comparison/break-even). No solver, class hierarchy or generic rules DSL.

Exports: `validateCatalog(input: unknown, now: Instant): CatalogValidation`; `simulateStrategy(request: CostRequest, strategy: Strategy, demand: DemandScenario): CostScenario`; `optimizeCosts(request: CostRequest): CostOptimization`. Validation returns fixed codes, never rejected values or exception contents.

### Candidate set and simulation

Enumerate keep-current with/without additional capacity; every allowed higher plan now or next reset; every allowed lower plan next reset; and a temporary higher plan now reverting to the original plan next reset. Consumer candidates use existing eligible lots then as-needed packs; Enterprise candidates use authorized postpaid overages. Free above its usable capacity is infeasible, never an artificially cheap winner. Plans excluded by required features/eligibility cannot win on cost. Unknown current plan still permits a standalone manual plan comparison but not current-plan savings or a personalized transition recommendation.

This is the **lowest estimated expenditure among evaluated strategies**, not a global optimum over every possible monthly plan sequence. No month-by-month arbitrary switching search or speculative bulk purchases in M4. A temporary current-cycle upgrade provides useful occasional-spike coverage without a general solver.

Simulate ordered events at plan changes, resets, lot expirations, capacity exhaustion and modeled purchases. Expire known-instant lots before demand at the same instant; reset then supplies the new allowance; plan capacity is consumed before valid purchased lots. Do not make expiring credits win over plan credits. Same-expiry lots can be consumed in stable input order; no persisted lot identifier is needed. A day-only expiry creates uncertainty throughout that UTC day, not a guessed exact instant.

Every candidate starts from an independent copy of the same opening inventory. Its bridge closing inventory becomes its future-period opening inventory; never reuse a different strategy's balance. If the bridge cannot establish that inventory, future totals inherit the uncertainty. A separate zero-opening-inventory what-if is allowed only as an explicit assumption, never a fallback for unknown balances.

A purchase occurs only when needed, only if eligible and a slot is known available, and only with a verified quantity rule. Split large needs into permitted packs, respecting simultaneously outstanding slots; unavailable slot-release semantics prevent an exact replenishment schedule. Unknown steps permit a clearly labeled lower bound `0.04 × max(shortfall, 125)` for a positive shortfall covered by a single eligible pack within the published maximum, **not a valid pack quote or exact optimum**. Larger/slot-constrained needs remain conditional with no arbitrary allocation. User-supplied hypothetical steps enable what-if results only. Do not use a cost floor to prove that an unknown competing strategy is more expensive unless its bound actually establishes dominance.

Established-paid immediate upgrades add the full fee difference, use the new total allocation minus supported month-to-date usage, and preserve known unconsumed lots. Do not add a fresh full allowance on top of spent credits. Block exact rerating when previously consumed lots could be restored but their treatment is unknown. Downgrades retain the current plan through the bridge. Next-reset upgrades have no current upgrade charge; bridge demand must still be covered under the existing plan.

First-paid/prorated/promotion cases return conditional explanatory comparisons until their precise rules are validated. Enterprise uses separate fee adjustments and month-end overage liabilities, no pack minima/rollover. Require explicit profile-level eligibility/headroom; one user's local usage cannot establish shared capacity. Custom organization contracts and exact GovCloud quotes are unavailable. A disabled overage path cannot satisfy excess demand; report unmet credits rather than silently price nonexistent capacity.

### Financial accounting and break-even

All credit and money arithmetic uses decimal strings and exact BigInt rationals. Do not reuse six-decimal truncation helpers for decisions. If official invoice rounding is unknown, expose a modeled amount or bound, not an exact charge; display rounding cannot change ranking or purchase quantities. Synthetic test catalogs may define exact step/rounding rules and must be labeled synthetic.

Opening purchased credits are already paid inventory. Consuming them adds **zero new expenditure**. Do not multiply them by today's unit price and report a charge, saving, refund or cash-equivalent asset. Historical acquisition cost is not collected in M4. Report credits consumed/expired/carried out separately. Newly bought packs count in full when purchased, even when partly unused at horizon end. No assumed resale/refund or terminal cash credit. Existing subscription fees before the anchor are sunk; only modeled additional fees and future renewals enter new spending.

The keep-current baseline must cover the same demand with eligible extras. If it cannot, show capacity failure and withhold monetary savings against it. If any relevant competitor has unknown costs/eligibility, the recommendation cannot assert universal cheapest status. Ties prefer keep-current, then fewer changes, and display equivalent cost.

For intuition, under full-cycle list pricing, no opening lots, no tax/promotion and continuously purchasable extras, the linear expression is `fee + 0.04 × max(demand − allowance, 0)`. Derived adjacent-tier ties are 1,500, 3,500 and 7,500 monthly credits. These are **conditional analytical references**, not validated pack purchase thresholds. Exact M4 break-even is scoped to one complete steady-usage cycle, no opening purchased inventory, an established cohort and verified purchase rules. Enumerate piecewise cost boundaries at allowances, purchase minima/steps and pack/slot limits, compare through the same simulator, and return all ties/winner intervals in the feasible range. Bound evaluation to 100,000 breakpoints; return `break_even_limit_exceeded` rather than approximate an exact threshold. For personalized multi-cycle inventory/expiry cases, return `break_even_complex_scenario` with the already calculated low/base/high scenario comparisons; do not invent a unique scalar crossing. A conditional analytical reference can still explain the trade-off. Check all eligible tiers, not just adjacent ones. Never divide a fee difference by the add-on price and silently ignore existing inventory.

## 6. Milestone 4B — recommendations UI

Extend the current detail view with one “Cost optimizer” section. Keep the daily-budget status bar unchanged. No dashboard or chart dependency.

1. **Inputs:** current plan or “Not specified”, billing system/market, as-of, forecast/manual source, monthly demand, and 1/3/6 complete-month selection. Show forecast tier and history window. A manual override never masquerades as detected data.
2. **Before next reset:** remaining projected demand, known plan/purchased capacity, shortfall, possible extra spend and effective change date. Clearly distinguish credits needed from credits a minimum-sized purchase would supply.
3. **Comparison:** keep-current versus best evaluated strategy, estimated new spending and potential savings for the same dates. Show unavailable baseline/savings as text, not USD 0. Label all amounts pre-tax USD; no foreign-exchange conversion or invoice claim.
4. **Decision detail:** break-even conditions, add-on need, ending purchased balance, expiry waste and low/base/high alternatives. “No change” is a valid recommendation. Missing information yields a concrete next input, not a purchase prompt.
5. **Assumptions:** catalog date/version, rule limitations, price stability, omitted promotions, inventory age and why a strategy is conditional. Public billing links are explanatory only.

Native commands/QuickPick/InputBox provide “Configure cost optimizer”, “Edit what-if usage” and “Clear optimizer inputs”. The detail webview remains script-disabled; commands are available through the command palette and the panel title action menu. No broad command-URI permission is required.

Collect only enums, decimal balances/demand and timestamps. Ask for plan explicitly; purchased inventory offers “Unknown”, “None (confirmed)” or lots with remaining balance/expiry. A total balance without lot expiries is allowed as incomplete input and cannot support precise expiry-sensitive scenarios. Slots, cohort and overage eligibility remain unknown until explicitly provided. User input is not official rule verification.

**Smallest M4 persistence decision:** manual inputs are session-only, in extension memory. Explain this in the input flow; clear on extension restart. Do not use workspace settings, Settings Sync or alter the existing SQLite schema. Persistent profiles can be a later explicit enhancement. Internally bind inputs to the existing private account partition through the controller; discard on partition change or ambiguity and never expose that key to the engine/UI/diagnostics. A detached what-if calculation may continue only after explicitly choosing manual mode; it is not attached to an inferred account.

Use bounded decimal validation, fixed messages and HTML escaping. Cancellation leaves the prior valid input untouched. Recompute locally when inputs, forecast freshness or catalog availability change, including an already-open panel. A cost-engine failure must not hide the working account budget view. No “Buy”, “Apply plan”, automatic change or authenticated API action.

## 7. Acceptance criteria and synthetic cases

Use invented identifiers and fixed dates (2030/2032) only. Production catalog facts are not synthetic billing assumptions: keep separate fixtures for complete invented rules versus the reviewed but partially unknown catalog.

| ID | Required result |
| --- | --- |
| A1 Catalog | All five consumer/four Enterprise tiers represented; source/version/date validated; bad/expired/conflicting/region-mismatched catalog cannot produce an unconditional result |
| A2 Arithmetic | Exact rational boundary comparisons; 0.01 credit and sub-cent results preserved; six-decimal display truncation cannot change a winner |
| A3 Minimum / max / slots | Under a synthetic step of 1 credit, a 1-credit deficit buys 125 for USD 5; a 2,501-credit deficit needs 2,500 + 125 for USD 105; insufficient slots produces no feasible exact purchase |
| A4 Real unknown steps | Real catalog retains unknown increment; exact pack quantity and optimum withheld where it matters; illustrative lower bound is not a quote |
| A5 Lots | Plan-first then earliest expiry; partial lots roll across resets; expiry/day ambiguity is explicit; opening 125 credits covering a 100-credit deficit costs USD 0 new money and leaves 25 |
| A6 Transitions | Established Pro to Pro+ adds USD 20, rerates the allocation, never doubles it; downgrade saves nothing before reset; missing prior pack consumption prevents fabricated restoration |
| A7 Cohorts | Unknown first-paid/promotion eligibility stays conditional; first-month FAQ example is evidence, not enough to invent general invoice rounding |
| A8 Free / constraints | Free demand above 50 without usable retained lots is infeasible; retained cancellation lots considered under B6; no new Free packs; required paid-only features exclude Free |
| A9 Enterprise | Opt-in overages separate from packs; no USD 5 minimum; explicit remaining headroom enforced; disabled/unknown/shared quota cannot be guessed from local fields |
| A10 Horizons | February/leap year, UTC reset versus DST/local date, bridge versus full cycles, next-reset change, expiry before end of horizon; no multiply-one-month savings shortcut |
| A11 Ranking | Same baseline inventory/demand, ties, negative savings, incomplete competitor, all tiers and temporary upgrade; no saving from unserved demand |
| A12 Rollover example | Synthetic exact-step scenario: Pro with 1,050 credits each cycle and no opening lots spends USD 25 / 70 / 135 over 1 / 3 / 6 full cycles; corresponding Pro+ costs USD 40 / 120 / 240; savings USD 15 / 50 / 105. Carryover is why savings are not simply multiplied |
| A13 Sensitivity | Low/base/high can choose different strategies; output range not confidence; repeat-rate versus explicit occasional-spike vector changes conclusions appropriately |
| A14 Forecast | Provisional/regular quality preserved; exact selected endpoints; schema/window mismatch, stale/unsupported/conflicting/multiple accounts unavailable; manual mode works without observations |
| A15 Inputs / privacy | Unknown differs from confirmed zero; stale/misaligned inventory cannot become current; negative, huge, malformed, HTML sentinels rejected/escaped without echoing contents; no identity/path in results/errors |
| A16 UI / packaging | Native edits/cancel/clear/refresh, narrow/light/dark rendering, unavailable baseline, session reset and account switch; scripts stay off; existing budget view survives optimizer failure; VSIX remains the existing public file allowlist |

M4A acceptance requires independently reproducible numeric results, deterministic input-pure core, no VS Code/filesystem/network imports in the engine, fixed error codes, and safe partial availability. Unresolved public rules are an expected supported outcome, not a reason to invent prices.

M4B acceptance requires manual setup without data collection, all labels/conditions above, synthetic integration tests, local synthetic UI inspection and VSIX inventory verification. Existing regression tests, typecheck, fixture validator and diff check must pass. No production billing data is needed for tests or screenshots.

## 8. Planning validation — 2026-10-10

Fresh checks against the unchanged application: 64/64 tests pass; `pnpm typecheck` passes; the fixture validator passes seven synthetic data files and twenty contracts; `git diff --check` passes. These checks protect the existing baseline and fixture contracts. No M4 code/tests, VSIX or financial recommendation have been implemented or validated by this planning run.

## 9. Approval and delivery boundary

The user approved Tasks 1–4; the independent engine is implemented and validated in [M4A evidence](milestone-4a-validation.md). No UI integration, Kiro-owned source reads, purchases, plan changes or commits were performed. Stop for checkpoint review before M4B. Milestone 5 remains separately approved future work.

## Future efficiency insights

Consider only separately allowlisted non-content metadata: observed credits per session, supported turn counts, duration, model selection, trends and spec/non-spec classification where a reliable marker exists. Validate account association, additive/cumulative semantics, updates, deduplication and incomplete coverage first; CLI/Crew collectors remain outside Milestone 3.

Efficiency needs a meaningful, observable outcome and evidence controlling for task complexity and model/workflow differences. Credit/session and duration correlations alone do not establish waste, and longer sessions or non-spec work are not inherently less efficient. Show sample size, coverage, comparator and limitations; withhold recommendations where outcomes or attribution cannot be established.

No prompt text, source code, conversation content, tool arguments or outputs may be collected/analyzed. Any future content analysis requires a **separate explicit privacy and security design review and opt-in authorization**. This roadmap grants neither and does not weaken AGENTS.md.

## 10. Executable catalog source revalidation — 2026-10-10

Reopened the public pricing page and every B1–B9 link on 2026-10-10, plus the general upgrading page. Listed tier fees/allocations and the scoped rules in the register remain unchanged. Detailed established-paid versus first-paid rules retain precedence over generic prorated-upgrade wording. Consumer purchase step, currency rounding, depleted-slot release, consumed-pack restoration, first-month accounting and exact GovCloud/custom prices remain unknown. Effective dates remain null: page update and retrieval dates are not rule effective dates. No authenticated portal or local Kiro source was used. The executable reviewed catalog retains unknowns; complete invented 2030 rules are test-only.

## M4B execution decisions

Default comparisons now call a separate, cheap conditional analytical-reference function. `findBreakEven` retains its exact engine contract and CPU cost but is absent from the extension bundle and UI command paths. This avoids workers while preserving financial correctness. The native flow defaults to explicitly confirmed independent assumptions. Personalized eligible tiers initially contain only the selected plan until the user confirms alternatives. Native guided lot entry replaces JSON editing. The detail view has a local anchor and native editor-title actions; scripts and command URIs remain disabled.

Public pricing/add-on/Enterprise permission pages were rechecked on 2026-10-10 for release; listed prices and unresolved rule gates remained consistent with the M4A catalog. Retrieval dates remain distinct from effective dates.
