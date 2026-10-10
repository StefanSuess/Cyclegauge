# Kiro local credit data: investigation findings

Investigation date: **2026-10-08**. Verified environment: **macOS, Kiro IDE 1.2.37**, bundle `dev.kiro.desktop`. CLI-format files and a CLI database were present; the CLI executable version was not established. This is a dated local observation, not a supported Kiro API contract.

## Findings and evidence boundaries

Account snapshots are the source of truth for **current observed account usage**, with an explicit as-of time and freshness. Session metering supplies **observed local daily attribution** where its interpretation is supported. Neither retained sessions nor sparse snapshots establish a complete daily billing ledger. Do not combine their totals.

Labels used here:

- **Observed:** inspected locally during the read-only investigation.
- **Documented:** stated in linked official public documentation, consulted on the investigation date.
- **Inferred / unverified:** a design candidate or hypothesis requiring validation.

No raw transcripts, source code, prompts, credentials, identity values, private workspace names, or raw log/database copies were output or placed in the repository. Scripts emitted only structural metadata, billing-unit enums, aggregate counts, and date/continuity checks. Identity equality was checked in memory without emitting values or hashes. Authentication values were not inspected. No Kiro command or authenticated service request was run.

SQLite connections used URI `mode=ro&immutable=1`; no WAL/SHM files were present on the inspected databases. No write statements, exports, backups, or checkpoints were performed. This method does **not** validate reading live databases with WAL or prove a stable snapshot under concurrent modification. A future collector must detect unsupported states and report unavailable data instead of silently omitting WAL changes.

## File and database inventory

`~` denotes the user's home; angle-bracket components are placeholders, never captured identifiers.

| Source | Observed format and purpose | Credit relevance |
| --- | --- | --- |
| `~/Library/Application Support/Kiro/logs/<run>/<window>/exthost/kiro.kiroAgent/q-client.log` | Timestamped log lines with JSON command envelopes | Historical account usage snapshots |
| `~/Library/Application Support/Kiro/User/globalStorage/state.vscdb` | SQLite `ItemTable`, columns `key TEXT`, `value BLOB`; JSON value at key `kiro.kiroAgent` | Latest notification usage cache |
| `~/Library/Application Support/Kiro/User/globalStorage/state.vscdb.backup` | Backup file present; not used as current data | Not a historical ledger; may be stale |
| `~/Library/Application Support/Kiro/User/workspaceStorage/<workspace>/state.vscdb` | Three workspace databases inspected; same key/value table structure | UI/session state, no separate billing ledger established |
| `~/.kiro/sessions/<workspace>/<session>/messages.jsonl` | JSONL events with `id`, `timestamp`, `payload` | IDE `usage_summary` records |
| `~/.kiro/sessions/<workspace>/<session>/session.json` | Session metadata; observed `schemaVersion: 1.0.0`, `dataModelVersion: 1` | Discovery/provenance; does not establish complete credit history |
| `~/.kiro/sessions/cli/<session>.json` | Session-state JSON with turn metadata | CLI-format metering entries, semantics unresolved |
| `~/.kiro/sessions/cli/<session>.jsonl` | `version`, `kind`, `data`; kinds include `Prompt`, `AssistantMessage`, `ToolResults` | Conversational content; not a collector input for credit totals |
| `~/.kiro/session-index/<index>.jsonl` | `op`, `sessionPath`, `at` | Session discovery, not usage |
| `~/Library/Application Support/kiro-cli/data.sqlite3` | CLI SQLite database | No usable credit ledger established in this installation |
| `~/.kiro/logs/<run>/{kiro,mcp,powers}.log` and IDE `Kiro Logs.log` | Operational logs | Keyword matches do not establish a credit ledger |

The CLI database has `migrations`, `history`, `auth_kv`, `state`, `conversations`, `conversations_v2`, `extracted_kas_versions`, and `pinned_bin_versions`. Relevant schemas: `state(key TEXT, value BLOB)`, `conversations(key TEXT, value TEXT)`, and `conversations_v2(key TEXT, conversation_id TEXT, value TEXT, created_at INTEGER, updated_at INTEGER)`. Both conversation tables were empty, and no credit-related state keys were found. This does not imply other installations have empty tables. Never read `auth_kv` values or shell-history contents.

The extension's `globalStorage/kiro.kiroagent` directories contained no files. Browser caches, cookies, credential stores, private session snapshots, source files, and workflow outputs are not credit-data inputs.

## Account-response log format

**Observed:** 18 successful `GetUsageLimitsCommand` responses across four dates, 2026-09-11 through 2026-10-08, in retained `q-client.log` files. Each had an `[info]` log level, a timestamp shaped `YYYY-MM-DD HH:mm:ss.SSS` without a timezone, and a parseable JSON object with `clientName`, `commandName`, `input`, `output`, and `metadata`. Metadata included HTTP status 200. Do not ingest `input`, identity fields, or request metadata beyond a success check.

| Field under `output` | Observed type | Interpretation |
| --- | --- | --- |
| `nextDateReset` | ISO 8601 string with offset | Explicit next cycle reset |
| `usageBreakdownList` | Array | Select supported resource breakdowns |
| `usageBreakdownList[].resourceType` | String, `CREDIT` observed | Credit discriminator |
| `usageBreakdownList[].unit` | String, `INVOCATIONS` observed | Do not mistake this enum for a request-count billing rule |
| `currentUsageWithPrecision`, `usageLimitWithPrecision` on each breakdown | JSON number | Prefer over integer variants |
| `currentUsage`, `usageLimit` | Integer in inspected records | Reduced-precision fallback only |
| `currentOveragesWithPrecision`, `overageCapWithPrecision` | Integer in inspected records; accept supported JSON numbers | Distinct overage values |
| `currentOverages`, `overageCap`, `overageCharges` | Integer in inspected records | Do not add these blindly to usage |
| `overageRate` | Fractional number | Rate, not a credit total |
| `currency` | String | Monetary currency |
| breakdown `nextDateReset` | ISO 8601 string | Matched outer reset in all 18 observations |
| `displayName`, `displayNamePlural` | Strings, `Credit` / `Credits` observed | Display labels, not stable discriminators |
| `bonuses`, `overageCredits` | Empty arrays in all inspected responses | Populated element schema and aggregation unverified |
| `subscriptionInfo` | Object | Observed keys: `type`, `upgradeCapability`, `overageCapability`, `subscriptionManagementTarget`, `subscriptionTitle` |
| `overageConfiguration.overageStatus` | String | Overage configuration, not consumption |

`output.userInfo` was present and contains private identity fields: exclude it from persisted records, fixtures derived from real data, and diagnostics. A narrowly projected in-memory continuity check may be designed separately; account partitioning cannot be inferred from usage amounts.

Preserve decimal values from JSON numeric text; do not introduce binary-float rounding or round each entry before aggregation. Official documentation describes fractional credits, but the parser must preserve supplied precision rather than hardcode two-decimal truncation.

## Latest cached account snapshot

Read only the `ItemTable` value whose key is `kiro.kiroAgent`, then project `kiro.resourceNotifications.usageState`:

- `timestamp`: integer epoch milliseconds; freshness belongs to this timestamp, not file-read time.
- `usageBreakdowns[]`: `currentUsage` (fractional number), `usageLimit`, `resetDate` (ISO 8601), `type`, `unit`, `displayName`, `displayNamePlural`, `percentageUsed`, and `extraCredits`.
- Overage fields: `currentOverages`, `overageCap`, `overageCharges`, `overageRate`; `currency` is an object with `code` and `symbol`, unlike the log's currency string.
- `extraCredits` was empty; its populated schema remains unverified. The exact cache `type`/`unit` values were not retained by the investigation and must not be invented as observed enums.

Latest cache usage and reset matched the latest logged precise usage and reset. Its epoch timestamp matched the latest log time within 0.001 seconds **when interpreted as Europe/Berlin**. This supports that interpretation for this observation only; historical log timezones and DST ambiguity still require handling. The cache is a latest-value store, not a time series or proof of ongoing refresh cadence.

## Local metering formats

### IDE JSONL

Of 132 inspected events in three `messages.jsonl` files, five had `payload.type: usage_summary`. Each had a timezone-aware `timestamp`, event `id`, `payload.executionId`, and a single `payload.promptTurnSummaries[]` entry containing `unit: credit`, `unitPlural: credits`, and fractional numeric `usage`. All five summaries were on one date. Other payload fields can contain sensitive material and must be dropped.

Use supported summaries for **observed local completion-time attribution**. Stable opaque event identity is needed for idempotency. A turn spanning midnight cannot be split exactly from its completion summary. Repeated/migrated events and multiple same-unit summaries need validation; do not treat every message or token/context statistic as an additional charge.

### CLI-format session JSON

29 JSON files were inspected. Ten contained turn metadata; 40 turns spanned three dates between 2026-09-12 and 2026-09-26. Of these, 39 had metering, containing 205 entries; one turn had an empty list. These are counts of records, **not an established credit total**.

The path is `session_state.conversation_metadata.user_turn_metadatas[]`:

- `loop_id`: candidate turn identity, private; no duplicates observed in this sample.
- `end_timestamp`: timezone-aware ISO 8601 string.
- `metering_usage[]`: objects with numeric `value`, `unit: credit`, and `unitPlural: credits`.
- Other observed metadata includes request counts, model, durations, token counts, context percentages, and message references; it is unnecessary for the initial collector and must not be copied wholesale.

**Mandatory unresolved check: are `metering_usage[]` entries additive charges or successive cumulative values?** The investigation did not establish this. Do not sum the entries, choose the maximum/latest, or treat them as daily credits until authoritative or separately authorized controlled evidence establishes the semantics for the relevant format/version. For an invented list `[0.10, 0.30]`, additive semantics yield `0.40`; a verified cumulative-with-final-last interpretation yields `0.30`. Neither interpretation is the default. Expected current output is `unverified_semantics` with an unknown total.

Verification must cover intermediate/final writes, retries, resumed turns, entry ordering, and within-turn versus between-turn accumulation. Comparing one sample with a delayed account counter does not prove semantics. Repeated turn snapshots must be upserted, not added. No CLI loop IDs matched IDE execution IDs in this sample, but the date ranges did not overlap, so this does not establish a general cross-format deduplication rule.

## Reconstruction, resets, and coverage

| Question | Supported conclusion | Limitation |
| --- | --- | --- |
| Current account usage | Latest valid comparable account snapshot is authoritative as of its timestamp | May be stale; service/account corrections remain possible |
| Local daily usage | Accepted IDE summaries can be grouped by local completion date | Partial retained history; CLI aggregation still blocked |
| Account change between same-cycle observations | Precise counter difference is a net interval change | Not a complete daily allocation or necessarily gross consumption |
| Consumption on missing days | Unknown | Never infer zero, interpolate by default, or assign the gap to the next observation day |
| Cycle transition | One advancing reset date plus decreased usage for the same account was observed | Observations were 11 days apart; exact boundary usage was not captured |
| Forecast | Potentially feasible after collecting sufficient quality history | Existing evidence does not justify a confident daily forecast |

There were two distinct reset dates. Both were first-of-month midnight UTC; all 18 snapshots belonged to the same user identity according to an in-memory equality check. No same-reset counter decreases were observed. These facts support a cycle-change detector, not a universal guarantee about account changes, counter adjustments, or billing behavior.

Reset detection must use explicit reset metadata and continuity, not just a smaller counter. Do not subtract across cycles or invent the prior cycle's final total. Distinguish a scheduled next reset from evidence that a new cycle was actually observed. Preserve unknown consumption through gaps, including both sides of a reset.

Daily presentation defaults to the device's IANA timezone (Europe/Berlin for this investigation); billing timestamps remain UTC. Preserve offsets and handle 23/25-hour days. Offset-free log times need a declared source timezone and an ambiguity status. Session completion attribution does not establish when every underlying request consumed credits.

Other limitations: retention and log rotation are not guaranteed; sampling is sparse; refresh can lag; active/crashed turns may lack final metering; deleted sessions and remote/other-device usage may be absent; session-to-account association is not established; plan changes, bonuses, overages, and recalculations can affect comparisons; storage schemas can change without notice. The absence of a record is not evidence of no consumption.

## Official documentation and platform status

- [Kiro billing](https://kiro.dev/docs/billing/) documents fractional consumption and cycle renewal.
- [Billing questions](https://kiro.dev/docs/cli/billing/related-questions/) describes UTC calendar-month billing; explicit observed reset timestamps should still be preferred.
- [Kiro FAQ](https://kiro.dev/faq/) describes account usage reporting and an update cadence of at least every five minutes; this is not a guarantee that a local log/cache refreshes while Kiro is closed or inactive.
- [Add-on credits](https://kiro.dev/docs/billing/overages/) describes plan credits being consumed first and add-on rollover/expiry. Do not model every credit pool as resetting monthly.
- [CLI setup](https://kiro.dev/docs/cli/quick-start/) documents platform-specific temporary log locations. The macOS temporary `kiro-log` directory existed but no relevant top-level `.log` files were found in the targeted scan.
- [CLI session management](https://kiro.dev/docs/cli/chat/session-management/) describes persistence generically. It is not a reliable versioned schema for every locally observed storage generation.

Only macOS paths/data were inspected. Windows `%APPDATA%\Kiro` and Ubuntu/RHEL `${XDG_CONFIG_HOME:-~/.config}/Kiro` are **inferred discovery candidates**, not verified locations or supported-platform claims. See [architecture](../ARCHITECTURE.md) for native path, locking, permissions, WSL, XDG, and SELinux validation requirements. Do not assume Ubuntu validation also verifies RHEL.

## Synthetic fixture contract

See [fixture README](../tests/fixtures/kiro/README.md). All inputs are invented; they are not redacted exports. Inputs preserve relevant observed structures while omitting private/unneeded fields. Unknown cache enums are omitted rather than fabricated; hypothetical schemas/scenarios are explicitly marked.

Expected results preserve unknown values as JSON `null`, separate account snapshots from local attribution, and keep CLI totals unknown pending semantic verification. The fixture validator checks syntax, decimal arithmetic, timestamps, scenario consistency, and privacy projections only. It is not a production collector or proof that a production parser satisfies these contracts.

## Milestone 1 implementation note

The explicit implementation request enabled a TypeScript/Node.js log-only collector. [README.md](../README.md) documents commands and behavior. This does not add evidence about Kiro versions, live cache safety or target platform compatibility to the discovery findings above. Only synthetic account-response logs were used for implementation tests; no additional real logs or databases were read. A numeric `q-client.log.<number>` suffix is a tested adapter convention, not an observed Kiro retention contract. Identity projection is limited to in-memory userId for device-local HMAC partitioning; neither raw identity nor private tokens appear in CLI output.
