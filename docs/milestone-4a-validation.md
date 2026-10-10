# Milestone 4A engine checkpoint — 2026-10-10

Tasks 1–4 of the approved implementation plan are implemented. Milestone 4B, Milestone 5, purchases, automatic commits and UI integration are excluded. Six independent TypeScript modules live under `src/cost/`; no runtime dependency was added. Existing collector, Store, CLI, forecast policy and extension files were not edited.

## Implemented capabilities

- Immutable allowlisted, versioned commercial catalog: five consumer tiers, four Enterprise tiers, B1–B9 provenance, strict rule/date/quantum validation and conditional review age after 30 days. Reverified all linked official public pages on 2026-10-10; retrieval dates are not effective dates. Unknown consumer step, currency rounding and slot release remain null.
- Exact BigInt rational amounts, quantum ceilings and signed comparison/savings. Decisions use transient exact values, not six-decimal forecast text or displayed currency. Simulation money/credit strings display at 18 decimal places with an explicit assumption; rationals remain internal and simulation/comparison JSON contains no BigInt.
- Automatic qualified forecast adaptation rechecks existing policy/evidence and reconstructs selected endpoint rates; retains provisional/regular quality and net-change limitations. Manual totals, repeated totals or per-cycle vectors work without forecast history; 75/100/125% sensitivity is hypothetical, not statistical confidence.
- Explicit detached manual comparison is available with unknown current plan/account profile. `ManualDemand.standalone` declares billing system, commercial market, UTC calendar schedule, zero opening purchased inventory and excluded promotions. These are what-if assumptions, not account observations. No personalized baseline, savings or transition recommendation is returned. Missing slot/overage permissions remain unknown rather than implied by zero inventory.
- Separate before-reset bridge and 1/3/6 full UTC billing cycles, including February/leap years. Known prices changing at reset apply then; unresolved mid-cycle price changes fail closed. As-of mismatch and inventories older than 24 hours are disclosed; unsupported resets are not rewritten.
- Independent candidate copies, plan-first/earliest-expiry inventory use, minimum/maximum packs, supported quantum and known-slot gates, expiration, carryover and conservation. Already purchased inventory adds zero new expenditure. Day-only/unknown expiry remains uncertain. Unknown bridge inventory propagates to future calculations.
- Established-paid immediate upgrades charge the fee difference and rerate total allocation against explicit cycle usage; consumed-pack restoration and first-paid/proration charges remain gated. Next-reset downgrades, cancellation to Free retaining eligible existing lots and temporary upgrades are distinct. Free cannot buy new packs.
- Enterprise has separate opt-in postpaid overage liabilities and explicit headroom; no consumer minimum or pack inventory. Future shared headroom is an explicitly conditional repeated assumption, not verified allocation.
- Finite all-eligible-tier comparisons: keep with/without extras, skip-tier next-reset changes, immediate upgrades and temporary bridge upgrades. Infeasible/unknown-cost candidates cannot win. Savings require a feasible matched baseline for the same dates/inventory/demand; negative savings are preserved. Ties prefer no change, then fewer changes. Different sensitivity winners suppress a categorical recommendation.
- Scoped break-even: conditional continuous-extra references with appropriate consumer/Enterprise rate; exact pack winner/tie intervals under complete invented rules through the reported `evaluatedUsageRange`. Recyclable slots make the domain conditional/bounded. Unknown applicable rules do not become exact competitor exclusions. Complex inventory/expiry/multi-cycle cases return unavailable alongside ordinary scenario comparisons.

## Numerical evidence

All values below are hand-derived expectations exercised by wholly synthetic tests. They are not actual invoices or verified consumer purchase quotes.

| Case | Verified synthetic result |
| --- | --- |
| Exact rate | 1 credit / 3 days; 31-day future cycle retains 31/3 |
| Manual sensitivity | 1,200 -> 900 / 1,200 / 1,500 credits |
| Minimum pack | 1-credit deficit -> 125 purchased credits, USD 5 |
| Split maximum | 2,501-credit deficit -> 2,625 purchased credits, USD 105 |
| Opening inventory | 125 opening credits cover 100; USD 0 new add-on spend; 25 remain |
| Upgrade | Pro with 900 used -> Pro+ 1,100 remaining; USD 20 added subscription fee |
| Enterprise | 1 excess credit -> USD 0.04 liability; no USD 5 minimum |
| Subcent | 0.01 credit at USD 0.04 -> USD 0.0004 |
| Exact cost comparison | USD 39.9999999999999999999 beats USD 40 before display rounding |
| Exact pack tie | Pro / Pro+ tie on (1,499, 1,500] under invented 1-credit step |
| Conditional linear references | 1,500 / 3,500 / 7,500 credits at USD 0.04 continuous extras |
| Separate Enterprise reference | Invented USD 0.08 overage produces first tie at 1,250, not 1,500 |

| Full cycles at 1,050 credits/cycle | Pro expenditure | Pro+ expenditure | Saving by choosing Pro |
| --- | --- | --- | --- |
| 1 | USD 25 | USD 40 | USD 15 |
| 3 | USD 70 | USD 120 | USD 50 |
| 6 | USD 135 | USD 240 | USD 105 |

The opposite transition retains negative savings (-15/-50/-105). Carryover drives the non-linear multi-cycle results. At 1,500 base manual demand, low demand keeps Pro and high demand favors Pro+; alternatives remain conditional rather than a categorical switch.

## Acceptance coverage

| Acceptance | Evidence |
| --- | --- |
| A1 Catalog | cost-catalog: rule/schema/provenance/tiers/age/future changes/incompatible quantum |
| A2 Arithmetic | cost-demand exact ratios, tiny quantum, signed rounding/subcent; optimization near-equal winner |
| A3 Minimum/max/slots | cost-simulation minimum/split, insufficient/unknown/five occupied slots |
| A4 Real unknown rules | reviewed null step and labeled lower bound; exact quantity/feasibility withheld |
| A5 Lots | opening inventory, plan-first expiry, earliest expiry, partial carryover, day ambiguity, conservation |
| A6 Transitions | fee difference/rerating, reset-only downgrade, temporary return, restoration gate |
| A7 Cohorts | first-paid/promotion conditional; future list-price exclusion explicit |
| A8 Free/features | infeasible Free, retained cancellation lots/B6, feature filtering |
| A9 Enterprise | no minimum, disabled/unknown/headroom gates, own analytical rate |
| A10 Horizons | UTC/leap month, bridge inheritance/dates, reset conflicts, dated future prices |
| A11 Ranking | matched feasible baseline, tie, negative savings, unknown competitor and all tiers |
| A12 Rollover | exact 25/70/135 versus 40/120/240 and signed savings |
| A13 Sensitivity | alternative winners, spread and spike vector |
| A14 Forecast | provisional/regular, exact endpoints, policy/window/stale/quality gates; independent manual mode |
| A15 Inputs/privacy | bounded malformed/negative values, unknown versus zero, anchor/future/reset checks, fixed diagnostics, invented private sentinels, JSON-safe simulation/comparison |

TDD evidence is retained in the local ignored plan ledger: missing-module RED runs, task GREEN runs, final review regression RED runs and complete suite output. The final reviewer performed one read-only fresh-context review; eight Important findings were addressed with synthetic regressions. No production Kiro data was read or copied. Core imports contain no filesystem, network or VS Code APIs; public outputs omit profile identities, paths and arbitrary input labels.

## Remaining billing gates

Consumer purchase increments/fractional support, invoice rounding, depleted-slot recycling, consumed-pack restoration, first-month day inclusion/proration/promotion accounting, exact GovCloud/custom pricing, eligibility/shared Enterprise future headroom and local combined/base balance interpretation remain unverified. Public documentation is not a versioned local-storage contract. A single-pack cost floor is illustrative only, never a valid pack quote or proof of a cheapest unknown competitor.

## Architectural checkpoint and execution decisions

- Deferred minor: uncached exact break-even enumeration currently takes about 10–11 seconds synchronously. It uses the same simulator at bounded breakpoints; a 16-entry public-result cache copies outputs, but includes exact evaluation time and therefore misses ordinary refreshes. Move this computation off the extension host or restructure it before M4B. Core tier comparisons do not require exhaustive break-even work conceptually; the current combined API still performs it. This is not ready for synchronous UI integration.
- Exact break-even exposes its bounded evaluated usage domain; it does not claim every feasible demand with recycled slots, or a global optimum over arbitrary switching schedules. The scenario event limit is 100,000 across bridge and future combined; breakpoints are separately capped at 100,000.
- The supplied detached checkout contains the uncommitted approved baseline. Work stayed in that checkout because a clean worktree would omit it and commits are prohibited. Changes are limited to the named cost files/tests and scope/evidence documents. This gives less branch isolation.
- The ignored execution ledger is retained at the checkpoint because there are no commits preserving that evidence; this leaves local scratch only.
- One initial test expectation was corrected by hand: 325 opening credits, 125 expired, 200 consumed, a new 125-credit pack covering remaining 100 and leaving 25 produce USD 65 total over three Pro cycles. Timestamp checks compare UTC instants, and expired-rule checks target the rule actually needed by that strategy.
- Mid-cycle price changes fail unavailable rather than guessing proration; reviewed reset-effective changes work. This is narrower support until accounting evidence exists.
- Standalone comparisons require explicit zero-opening/promotion-excluded/system/market/schedule declarations and provide no personalized savings. This adds declarations but avoids synthetic account defaults.

M4B and M5 are untouched. No automatic commits, staging, VSIX build/install or Kiro launches were performed for M4A. UI/packaging/platform claims remain outside this checkpoint.

## Final validation

`pnpm test`: **113/113 pass** (64 existing regressions, 49 cost-engine tests), zero failures/skips. `pnpm typecheck`: exit 0. `python3 tests/fixtures/kiro/validate.py`: seven wholly synthetic files and twenty contracts pass. `git diff --check`: exit 0. The fixture validator validates fixture contracts, not production parsing or live/platform behavior. Acceptance A1–A15 is covered at the supported conditional engine scope described above.
