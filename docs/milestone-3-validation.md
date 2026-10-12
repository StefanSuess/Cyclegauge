# Milestone 3 validation — 2026-10-10

## Verified

- 59 wholly synthetic unit/integration tests pass: history/day attribution, steady/increasing/decreasing rates, missing/sparse days, mid-cycle activation, resets/regression, staleness/future time, adjustments/limit changes, extras/conflicts/account isolation, decimals/offsets/UTC/DST boundaries, public-view privacy and extension rendering.
- `pnpm typecheck` passes.
- `python3 tests/fixtures/kiro/validate.py`: seven synthetic files and twenty contracts pass. This is fixture validation, not production-format proof.
- `git diff --check` passes.
- Code review's two precision findings reproduced RED → GREEN: final-only projection truncation and conditional exhaustion immediately before UTC midnight/reset.
- `pnpm package:vsix` builds 0.3.1. Exact ZIP inventory: `[Content_Types].xml`, `extension.vsixmanifest`, `extension/package.json`, `extension/readme.md`, `extension/dist/extension.cjs`. No source logs/stores/tests/dependency cache or internal design docs.
- Local Kiro IDE installer successfully installed the VSIX. A clean Kiro window displayed the extension's status item; clicking it opened the account details. Native accessibility checks confirmed history, coverage, forecast, policy and insufficient-comparable-coverage explanation. Only fixed booleans/labels were retained in this report; no screenshots or private account values/identifiers/paths.

## Limitations and data-quality gates

- Live history was insufficient for a qualified forecast. Live forecast accuracy, current-cycle daily completeness and exhaustion timing are not established by rendering or synthetic tests.
- All projections are qualified constant-rate scenarios; provisional three points/48 hours and regular eight points/seven days, with shared 36-hour gaps/24-hour freshness are conservative policy choices, not calibrated probability guarantees. Zero net change can conceal adjustments between observations. Gaps and missing exact rolling boundaries constrain availability.
- Explicit reset metadata lacks a cycle start unless prior-cycle evidence establishes it. No calendar-month inference. A current counter and a known start do not prove a complete daily ledger.
- Account counter usage and limit are the existing billing projection. Unknown add-on schemas remain unsupported. Official docs describe combined plan/add-on displays; they do not prove the local limit field's base-only semantics for purchased-credit accounts. Purchased balances/lots need independent validated allowlists before total-availability or cost recommendations.
- Service reporting delay and usage since the latest snapshot remain unknown. Dynamic budget is based on an as-of amount and query-time horizon.
- Existing multi-account views fail unavailable; no active-account inference/selector was added. Platform/storage/format limits from Milestones 1/2 remain, including Windows ACL support, unverified Windows/Linux and disabled Kiro SQLite readers.
- Packaging warns about missing repository metadata/license. This is a local development VSIX, not a marketplace release.
- Pricing/rules documented from official public pages are dated references only. No pricing engine, recommendations, session metadata collection or behavioral/content analysis was implemented.

## Progressive forecast adjustment — 2026-10-10

- RED → GREEN coverage for 48-hour/three-snapshot provisional eligibility, promotion at seven days/eight snapshots, inadequate snapshot count despite seven-day span, duplicate points, exact 36-hour gap boundary, stale observations, unknown/multiple accounts, changed limits, missing fields, counter decreases, extras, conflicts and fresh post-reset windows.
- A quality barrier restarts the usable window. Unknown daily values remain unknown; only fresh comparable endpoints contribute to the new rate. Cycle-to-date and rolling methods retain their stricter gates.
- Synthetic extension integration exercises provisional → regular → stale/unavailable and checks the window/count/limitations text. JSON schema/policy v2 uses `tier` rather than the misleading former `confidence` property.
- VSIX 0.3.1 installed via Kiro's local VSIX picker and the extension host restarted. Opening the account command exposed policy v2, provisional 48-hour and regular seven-day requirements, selected observation coverage and the unavailable label. Checks retained only fixed booleans; no account amounts, identifiers, source data or screenshots were captured in this report.
- Live eligible provisional/regular forecasts and predictive accuracy remain unverified; available live evidence yielded unavailable. No authenticated usage request was initiated by the extension. No Kiro-owned logs or databases were modified.


## Focused UI refinement — VSIX 0.3.2, 2026-10-10

- 64 wholly synthetic tests pass; typechecking, seven-file/twenty-contract fixture validation, whitespace and exact VSIX file allowlist checks pass. Existing collector, history, persistence and forecast calculations are unchanged.
- Presentation tests cover daily-budget status, on-track/tight/over-budget states, conditional UTC exhaustion, exhausted base credits, provisional risk labeling, zero rate, collecting data, stale observations, incompatible accounts, unsupported extras and elapsed resets. Integration tests still verify activation, passive refresh, disposal and progressive tiers.
- Right-aligned status text emphasizes daily allowance/outlook rather than a duplicate balance. Tooltip retains the exact allowance, tier, observed rate and as-of time. Tight is a display threshold of at least 90% of budget; it changes no core eligibility gate. Exact adjacency to Kiro's own item is not guaranteed by the API.
- Local Kiro VSIX picker installed 0.3.2 and restarted extensions. Opening the account command rendered “Your credit budget”, daily-budget summary, current status, history, quality/notes and the plain insufficient-history explanation. Fixed checks confirmed derived status wording/new tooltip and absence of the old balance status. No real billing amounts, identities, logs or screenshots are retained in this report.
- Desktop and 360-pixel narrow layouts visually inspected using invented 2030 account observations in a separate local preview. Summary cards wrap, conditional dates remain readable, and technical details are collapsed. Preview tab/server closed after validation.
- Live evidence did not establish eligible forecasts or predictive accuracy; outlook variants are verified synthetically. No cost optimizer, charts, session-content analysis, authenticated request or new runtime dependency was added. Packaging retains the existing missing-license/repository warnings for this development VSIX.
