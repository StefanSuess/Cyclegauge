# EasyKiroGauge

Version 0.5.1 simplifies the detail view (concise default reading flow, one collapsed "Advanced details" section; UI only, see docs/milestone-5-1-validation.md). Version 0.5.0 adds the Milestone 5 usage trajectory chart (below). Milestone 4B adds a local Cost Optimizer to the existing credit-budget detail view. The daily-budget status bar and forecast policy are preserved. Version 0.4.1 adds pooled multi-week forecasting that survives weekends and billing resets (see docs/milestone-4c-validation.md). It uses native Kiro inputs and a script-disabled view; no network requests, purchases or persistent manual profiles.

## Usage trajectory chart (0.5.0)

The budget detail view now shows a script-free **Usage trajectory** chart (inline SVG, no chart library, no new permission) above the Forecast section. It plots the observed cumulative account counter at the actual snapshot times, thin connectors only between comparable intervals of at most 36 hours, hatched unknown periods (never zero-filled), the reported credit limit, the billing reset, and — only for a fresh qualified forecast — the expected trajectory plus lower (75%) and higher (125%) scenarios, an even-allocation budget guide and a conditional limit-reached marker. The scenario range is a declared assumption, not a statistical confidence interval.

- **Reported credit limit.** The observed CREDIT limit is not verified as base-only or total available capacity; for individual accounts it may include purchased add-on credits, while Enterprise overages can allow usage beyond the subscription quota. Usage above the reported limit (for example `2100 / 2000`) is shown as observed with a distinct marker and tinted region. The counter alone does not establish overage charges, purchased balance or billing eligibility. Remaining-capacity and budget figures are presentation of the existing calculation (`reported limit − usage`, floored at zero); the forecast algorithms are unchanged.
- **Clipped projections.** If a trajectory leaves the visible range it is clipped with a marker and a visible note; the full numeric endpoint is in the text summary and data table.
- **Data parity.** The text summary and the *Chart data table* list every plotted observed point, limit segment, unknown period, event, scenario endpoint, budget-guide endpoint, reset, evaluation time and conditional exhaustion day. At most 96 observed points are plotted; thinning keeps the first, last and every update beside an unknown period or event, and the omitted count is stated.

Details and validation: `docs/milestone-5-validation.md`.

## Cost Optimizer

Click the budget status bar, then its **Cost Optimizer** jump link. Use the panel title gear (Configure), pencil (Edit) or clear action; the same commands are available in the Command Palette.

The quickest flow is **Configure Cost Optimizer → Independent comparison → Consumer prepaid or Enterprise postpaid → expected monthly credits → confirm assumptions**. This explicitly compares commercial list prices for 1, 3 and 6 full UTC billing cycles, assumes no opening purchased credits, excludes promotions and excludes the current partial cycle. It works without a live forecast. It has no personal savings baseline and does not confirm purchase or plan eligibility. Expand each horizon for strategy costs, demand sensitivity, conditional analytical references and limitations.

For personalized scenarios, select your current plan when configuring. No plan is inferred from the observed credit limit. Edit advanced details to confirm the market, balance as-of time, next UTC reset, remaining base credits, cycle usage, additional before-reset demand, existing purchased lots (including explicitly none), available pack slots and eligible tiers meeting your feature/admin restrictions. The default personalized tier menu contains only the selected current plan until you confirm alternatives. Each lot is entered through separate credit, expiry-precision and expiration prompts. Unknown or date-only expiry remains uncertain. Confirm cohort, first-paid date, promotions and prior add-on use when assessing upgrades; Enterprise overages require explicit permission and applicable headroom. Blank optional balances mean unknown, while 0 and confirmed no lots are distinct.

The view separates new expenditure before reset from future complete cycles, subscription/add-on/overage costs, signed savings, expired/remaining inventory and 75/100/125% hypothetical demand alternatives. A lowest calculable option is not called the cheapest overall when a competitor has unknown costs. Missing balances or eligibility explain which details are needed; independent comparisons remain usable. Monetary values are pre-tax USD modeled expenditure, not invoice quotes. Existing purchased credits are not charged again.

Inputs last only for the current extension session. Clear, restart, account-context change or ambiguity invalidates them, including an editor that completes late. Independent inputs may be created without usable account observations but stay isolated to that context. There is no account selector. Manual inventories older than 24 hours are conditional; a passed reset requires reconfirmation. An optional qualified forecast is revalidated through the existing exact demand adapter and can become unavailable independently of the budget view.

Normal comparisons never run exhaustive break-even enumeration. The view only shows labeled continuous-extra analytical references where applicable. They exclude pack minima/steps, quotas, promotions, opening inventory and multi-cycle carryover. The expensive exact `findBreakEven` remains an explicit engine-only operation, deferred from extension interactions; no approximation replaces an exact result. Consumer purchase increments, rounding, depleted-slot release, first-paid proration and pack restoration remain billing gates. Custom/GovCloud prices and arbitrary monthly switching schedules are unsupported. The Milestone 5 usage chart is separate from the Cost Optimizer and shows no costs.

The repository document `docs/milestone-4b-validation.md` contains test, packaging, layout and local Kiro evidence.

Milestone 3 extends the Kiro IDE extension with credit history and qualified forecasts. Its status bar emphasizes daily budget and forecast outlook: collecting data, provisional, on track, tight, over budget with a conditional exhaustion date, stale or unavailable. Remaining base credits stay in the detail view alongside account usage, daily budget and forecast status. Click it to open account usage, base limit, reset, UTC-day allocation, observation time, freshness and warnings. The extension reads existing Kiro IDE account-response logs and writes normalized observations only to EasyKiroGauge-owned storage. It does not call Kiro services or need a separate Node installation.

Build and package locally with `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/esbuild src/extension/extension.ts --bundle --platform=node --format=cjs --target=node24 --external:vscode --outfile=dist/extension.cjs`, then `./node_modules/.bin/vsce package --no-dependencies --out dist/easykirogauge-0.5.1.vsix`. Install the VSIX through Kiro IDE's Extensions: Install from VSIX command. The extension activates after startup, watches IDE account logs and rescans every minute. A rescan of old data never refreshes its observation timestamp.

Settings: `easykirogauge.sourceRoot`, `easykirogauge.storageRoot`, and `easykirogauge.sourceTimezone`. Blank settings use the platform's default IDE/app-owned locations and device timezone. Offset-free historical log timestamps may be ambiguous if the device timezone changed. Stale or unavailable values are labeled. CLI and Crew session metering and add-on balance aggregation remain outside this milestone. Milestone 2 status/details were previously verified in macOS Kiro 1.2.56. The earlier Milestone 3 VSIX 0.3.0 was installed and its history, coverage, forecast labels and insufficient-coverage explanation verified in a clean local Kiro window on 2026-10-10. The progressive-forecast update, VSIX 0.3.1, was installed, restarted and its policy v2/unavailable detail rendering verified locally on the same date. Eligible provisional/regular rendering is covered synthetically; live predictive accuracy remains unverified. Windows, Ubuntu and RHEL remain unverified.

Milestone 1: a local, read-only `GetUsageLimitsCommand` CREDIT collector with persistent observations and a CLI. It reads existing Kiro IDE account-response logs; it never starts Kiro, calls its services, reads credentials, or accesses its SQLite cache or sessions.

## Requirements and use

Node.js **24.13 or newer**. Runtime uses built-in modules only; TypeScript and Node type definitions are development dependencies. Install development tools with `pnpm install --frozen-lockfile`.

Run from this checkout:

```sh
node --disable-warning=ExperimentalWarning src/cli.ts --source-timezone Europe/Berlin
node --disable-warning=ExperimentalWarning src/cli.ts --source-timezone Europe/Berlin --json
node --disable-warning=ExperimentalWarning src/cli.ts --help
```

Declare the timezone actually used by the source logs. Europe/Berlin is supported by the discovery observation, not a universal default. Offset-free timestamps without a declared IANA timezone are unavailable. DST overlaps and nonexistent wall times are rejected rather than guessed. Offset-aware timestamps preserve their spelling and normalize their instant to UTC.

Options:

| Option | Purpose |
| --- | --- |
| `--source-root <directory>` | Override the Kiro IDE data root, containing `logs/` |
| `--source-timezone <IANA>` | Interpret offset-free source timestamps |
| `--store-dir <directory>` | Dedicated private app-owned directory outside source roots and Git repositories |
| `--max-age-hours <hours>` | Observation freshness threshold, default 24; operational policy, not measured service latency |
| `--json` | Local billing/quality query output without account, source or deduplication keys |

Default source candidates: macOS `~/Library/Application Support/Kiro`; Windows `%APPDATA%\Kiro`; Linux `${XDG_CONFIG_HOME:-~/.config}/Kiro`. Only `logs/<run>/<window>/exthost/kiro.kiroAgent/q-client.log` and numeric suffixes such as `q-client.log.1` are read. These suffixes are an explicitly supported synthetic rotation convention, not a verified Kiro rotation contract.

Default owned storage: macOS `~/Library/Application Support/EasyKiroGauge`; Linux `${XDG_DATA_HOME:-~/.local/share}/EasyKiroGauge`. The design candidate for Windows is `%LOCALAPPDATA%\EasyKiroGauge`, but this implementation **fails closed on Windows** until owner-only ACL creation and validation are implemented and verified. Existing storage must have owner-only access. Source roots, Git repositories, symlink paths and Kiro storage directories are rejected as store locations. On macOS, use canonical paths when a path includes system aliases such as `/tmp` or `/var`.

The CLI prints observed usage, base limit, remaining base credits, reset UTC instant, as-of time, quality flags and fixed import diagnostic codes. A successful query exits 0 even when values are unavailable; configuration, storage or fatal collection failures exit 1 with a fixed code. JSON output follows the same policy.

## Meaning of the values

- Account snapshots are authoritative **as observed**, not live service balances. Ingestion time never refreshes observation time. The CLI cannot verify the currently authenticated account without credentials; it uses only retained account-response evidence.
- Remaining base credits are `max(observed base limit - observed CREDIT usage, 0)`. This is a base-budget calculation; total availability including bonuses/add-ons is always unknown. Populated extra-credit schemas are unsupported and stay separate.
- Available per day is remaining base credits divided by remaining seconds until explicit reset, converted to UTC 24-hour days. This allocation is truncated to six decimals for presentation. It is not a forecast, burn rate, historical daily measurement or local-calendar-day allowance. Stale, future, expired-reset or unknown-reset observations cannot supply this allocation. Stale remaining base credits are explicitly an as-of calculation.
- Missing fields stay unknown. Integer fallback is labeled `reduced_precision`. Reset-field conflicts preserve unknown reset. Equal-time billing conflicts withhold a selected observation.
- Advancing reset metadata indicates an observed cycle change. A same-reset decrease is an anomaly/adjustment; a changed base limit suspends comparisons. Cross-cycle deltas and consumption across observation gaps remain unknown. Nothing sums account snapshots with sessions.
- Multiple account partitions or observations without a supported identity withhold the account view. There is no account selector or automatic inference of the active login in this milestone.

## Privacy, storage and reliability

The adapter temporarily parses a bounded complete log envelope, projects only validated billing fields and a narrowly scoped `output.userInfo.userId` for in-memory continuity, then drops the envelope. Identity is HMAC-partitioned with a device-local 32-byte key; raw identity is never persisted. Private source/deduplication tokens stay in owned SQLite and are absent from CLI output. Device key and database use mode 0600; the dedicated directory uses 0700. Unknown fields, raw records, error representations, prompts and source paths are never written to the store or diagnostics. There is no telemetry or network code.

Full bounded rescans plus durable deduplication protect restarts, rotation, truncation and same-size replacement. Content/identity fingerprints and source lengths remain private. `source_changed` means content/identity changed or length shrank, including ordinary append; it does not prove lost usage. Partial trailing lines are deferred until a complete newline. A changing source read is discarded. Each stable source import is transactional; concurrent store connections serialize via SQLite transactions. A failed later file can leave earlier successful file transactions durable and safe to re-import.

Bounds: 256 KiB per line, 64 MiB per file, 10,000 accepted records per file, at most 1,000 discovered files and 1,000 run/window entries per level. Oversized files, too many records, and malformed/unsupported records produce fixed codes. These are conservative operational limits, not verified Kiro limits. The extension adds a watcher and polling fallback; retention pruning and automatic migration remain deferred. SQLite schema version 1 supports this collector only. Keep `device.key` and `usage.sqlite` together; loss or corruption fails unavailable rather than inventing a balance. Local snapshots contain private billing amounts: keep them local and do not attach the store to bug reports.

## Verification and remaining limits

```sh
pnpm test
pnpm typecheck
python3 tests/fixtures/kiro/validate.py
git diff --check
```

The unit/integration suite uses invented records and temporary synthetic sources only, including the existing invented account log fixture. It checks precision, privacy sentinels, DST, source scope and symlinks, read-only file/directory behavior, concurrent source mutation, transactions, restart/deduplication, same-size replacement, corruption, account isolation, conflicts, freshness and cycle transitions.

Verified here: synthetic tests on macOS and live VSIX installation, activation, status bar and detail view in Kiro 1.2.56. The collector was previously reported live-tested by the user. Windows, Ubuntu and RHEL are **unverified targets**, not compatibility claims. Windows is additionally blocked by ACL support. Live SQLite/WAL safety for Kiro's own cache remains unproven, so that adapter is disabled and explicitly unavailable. Format stability, service latency, nonnumeric rotation naming, unknown populated bonuses and historical source timezone changes remain limitations. No session aggregation, statistical probability estimates, cost optimizer or daemon is implemented.

## Milestone 3: credit history and qualified forecasts (historical baseline)

The account detail view now shows history/coverage and a compact textual forecast. Expand recent observations to see up to eight account usage snapshots, fourteen UTC-day net changes and eight gaps/quality barriers. Missing days remain unknown. Partial daily values describe only intervals supported within that day; multi-day deltas are never spread across days. The observed interval average is not a complete daily ledger.

Forecast policy/schema v2 provides two tiers. **Provisional estimate – limited history** requires three distinct comparable account snapshots spanning at least 48 hours. **Regular forecast** preserves eight snapshots over at least seven days and automatically takes precedence. Both require no gap over 36 hours, stable known account/cycle/limit evidence and a fresh latest observation (24 hours by default). The selected window, elapsed days and snapshot count are shown. A provisional window may not represent future usage; it supplies no statistical confidence or accuracy guarantee. Unavailable forecasts show their reasons. JSON uses `tier` instead of the former `confidence` field. Estimates are always **qualified constant-rate scenarios**, not guarantees or statistical confidence intervals. A fresh account snapshot can coexist with an unavailable forecast. Early activation, sparse logs or missing exact seven-day boundaries can prevent a rolling estimate. A qualified observation-window fallback can work after mid-cycle activation. Cycle-to-date additionally needs evidence of the cycle start from an earlier reset; a month is never guessed.

Projected usage is anchored to the latest **observation**, including modeled consumption from that observation until explicit reset. Projected remaining base credits may be negative, indicating a shortfall. Exhaustion gives a conditional UTC day only when the rate predicts it before reset; zero consumption does not invent an exhaustion date. Recent trend compares two exact, eligible seven-day windows. Adjustments, changed limits, conflicts and excessive gaps suspend window forecasts until a new clean window meets its tier’s requirements; cycle-to-date stays suspended for the affected cycle.

Daily budget divides as-of remaining base credits by time from **now** to reset. It is an allocation, and rate-vs-budget is a qualified planning comparison. Unknown usage since the snapshot is not zero. Add-ons, total availability, monetary cost and future usage changes remain unknown. All arithmetic uses decimal strings/BigInt; calculated values are truncated to six decimals and exhaustion is displayed without an exact-time promise. Full formulas/policy and boundaries are in SPEC.md. `--json` contains billing-only `history` and `forecast` alongside existing fields; no private identity/source keys are added.

No persistence migration, Kiro settings change, authenticated call or new runtime dependency is required. Install `dist/easykirogauge-0.5.1.vsix` using **Extensions: Install from VSIX**, then reload the window if Kiro requests it and open **EasyKiroGauge: Show Account Credits**. This command only opens the local billing view.

## Kiro Usage & Cost Optimizer (scope and remaining future work)

Milestones 4A–4B implement the configurable/versioned tier and billing scenarios (keep/upgrade/downgrade/add-ons/existing purchased capacity; 1/3/6-month savings), with separate consumer purchased-credit and Enterprise overage rules. Actual costs need monetary evidence; credits alone are not costs. Evidence-based efficiency insights will use separately validated non-content metadata only. Longer sessions/non-spec work do not inherently imply inefficiency. Content analysis requires separate explicit privacy/security review and opt-in. Nothing in this roadmap authorizes content collection or changes AGENTS safeguards. See `docs/cost-optimizer-roadmap.md` in the source checkout (optimizer roadmap and dated official billing sources).

Milestone 3 verification on 2026-10-10: **59 synthetic tests passed**, typechecking passed, fixture validator passed seven synthetic files/twenty contracts, and `git diff --check` passed. A fresh review found two exact-arithmetic boundary defects; regression tests failed before their fixes and passed afterward. VSIX contains only bundle, package manifest and public README (plus VSIX metadata). Local VSIX 0.3.1 installation, extension-host restart and policy v2/unavailable rendering passed; live evidence did not support an estimate. No real billing values, account keys, private paths or screenshots are included in the validation report. Packaging still warns about the absent repository metadata and license; it is a local development artifact, not a marketplace release.


## Budget-first UI (0.3.2, historical)

This section records the 0.3.2 release. Later versions add the Cost Optimizer (0.4.0), pooled history forecasting (0.4.1) and the usage chart (0.5.0) described above; the last sentence below applies to 0.3.2 only.

The compact status bar shows derived planning information rather than repeating Kiro's credit balance. Its tooltip explains the forecast tier, exact daily budget, observed rate, last account update and conditional outlook. Stale or unavailable data never shows “On track”. Provisional estimates always remain identified, including when exhaustion is predicted. For regular forecasts, “Tight” means the displayed modeled rate is at least 90% of the daily budget while not above it; this is a presentation threshold, not a new forecast eligibility rule. “Over budget” uses the existing engine's rate-versus-budget result. Dates use UTC. Compact budgets truncate to one decimal rather than increase the spending allowance; amounts below 0.1 remain explicitly smaller than 0.1.

The detail view opens with four summary cards, followed by current status, forecast, observed history and data quality/notes. Exact amounts/timestamps, method eligibility and quality codes remain available in expandable details. Daily budget is an allocation, not a measured daily consumption total. The right-aligned status item uses VS Code priority ordering; exact placement beside Kiro's native indicator cannot be guaranteed. Collector, storage, forecast calculations and privacy/read-only safeguards are unchanged. No cost optimizer or content analysis is included.
