# Passive usage sources across Kiro applications

Investigation: 2026-10-10, macOS. Investigation only; no collector changes.

## Conclusion

The IDE is still the only verified source of a complete, persisted account snapshot in the inspected installation. No independently updated, complete CLI account snapshot was found in the inspected files or database state. Crew has an independent account-fetch implementation, but its account cache is in process memory; its inspected on-disk usage records are per-turn consumption.

This does not prove that no other storage format exists. It means there is currently insufficient evidence for a reliable passive CLI/Crew account adapter. An account-wide server response can include consumption from every application even when only the IDE persists that response. Account coverage and local refresh availability are different properties.

## Versions and locations

Paths below are conventional locations with placeholders, not captured private paths.

| Application | Installed version evidence | Relevant observed locations |
| --- | --- | --- |
| IDE | 1.2.56, installed application Info.plist | `~/Library/Application Support/Kiro/logs/<run>/<window>/exthost/kiro.kiroAgent/q-client.log`; `~/Library/Application Support/Kiro/User/globalStorage/state.vscdb`; `~/.kiro/sessions/<workspace>/<session>/` |
| CLI | Executable present. Exact product version not established without execution; embedded dependency/version strings are ambiguous and must not be reported as its version. | `~/Library/Application Support/kiro-cli/data.sqlite3`; `$TMPDIR/kiro-log/`; `~/.kiro/sessions/cli/`; shared operational logs under `~/.kiro/logs/` |
| Crew | 0.8.0, both desktop Info.plist and installed Python distribution metadata | `~/.kiro/crew/usage/tokens/<day>.jsonl`; `~/.kiro/crew/sessions/`; `~/.kiro/crew/cache/`; `~/.kiro/crew/logs/`; `~/.kiro/crew/gateway.log` |

Crew paths can be overridden; this inspection does not establish the environment of every running process. No application or version command was executed. The earlier IDE 1.2.37 findings are historical, not the current installed version.

## Observed storage and formats

### IDE

The retained account logs contain 21 recognized CREDIT observations. The latest log and notification cache agree on usage, limit, and reset boundary. Their timestamps agree within one millisecond when the offset-free log time is interpreted as Europe/Berlin. This corroborates that timezone for this observation, not every historical line.

The log carries `usageBreakdownList`, precise credit fields and reset metadata. The cache carries `kiro.resourceNotifications.usageState.timestamp` and `usageBreakdowns` with fractional `currentUsage`, `usageLimit`, `resetDate`, `type: CREDIT`, and `unit: INVOCATIONS`. Cache read time is not observation time. No new inspection of IDE session transcripts was necessary; the earlier `usage_summary` findings remain historical evidence.

The user's test supports delayed local refresh: account usage changed outside the IDE, while the retained IDE snapshot changed only after the IDE was opened. This is user-observed evidence, not a controlled experiment performed here; it does not establish all possible IDE refresh triggers.

### CLI

The database has 18 state keys, none matching usage/credit/billing/limit/subscription/quota terminology. Both known conversation tables are empty. State values, authentication values and shell history were not read. A differently named or encoded cache remains unexcluded.

Three temporary log files and 15 shared operational log files were inspected through fixed schema-marker counts. None contained the known account-response/cache markers. This is a bounded negative result, not a guarantee covering every possible CLI log format or retention period.

The 39 CLI session JSON files contain 44 completed-turn metadata records and 214 metering entries. These use `session_state.conversation_metadata.user_turn_metadatas`, `end_timestamp`, and `metering_usage`. They do not establish a current account balance. Additive versus cumulative semantics remain unresolved; no sum, maximum or last-entry credit total was derived. Conversational JSONL files were not used.

### Crew

Six daily usage shards contain 57 per-turn records. The inspected records use `_type: tokens`, `ts`, and `credits`; none contained the checked account-snapshot fields. Crew's installed usage writer and the public project documentation identify these as per-turn analytics. They are not account snapshots, even when a dashboard labels their aggregation as usage.

Installed account handler code uses an in-memory `_usage_cache` and `_usage_cache_ts`. `_publish_usage` assigns those variables; the inspected cache-handling functions have no direct persistence calls. No complete account snapshot was established in the inspected usage/cache directories or gateway log. The gateway log contained no usage-refresh messages or checked account fields.

The latest Crew turn and latest CLI completed turn have nearly identical completion times. This is consistent with Crew using CLI underneath, but timing alone does not prove event identity or a universal deduplication rule.

## Independent refresh and shared state

Static inspection of installed Crew 0.8.0 establishes an account-fetch path independent of IDE startup: an API attempt and a CLI `/usage` fallback. Its GET usage handler schedules a refresh when its cache age exceeds `_USAGE_REFRESH_SECS = 600`. This is a request-triggered age gate, not proof of an unconditional ten-minute background timer or successful requests in this installation.

The installed implementation references CLI authentication state (`auth_kv`); no IDE database or keychain reference was found in that account API module. The public Crew project also documents CLI as its default backend with separate CLI sign-in. This establishes implementation coupling between Crew and CLI, not that the IDE and CLI currently use the same identity or credentials. No authentication store, secret, cookie or keychain was inspected. Separate data locations do not prove independent accounts.

Crew's account response uses normalized fields such as `credits_used`, `credits_plan`, `resets`, and `timestamp`; the IDE logs preserve a service-response envelope. These are different contracts. Crew also has informational account-refresh log statements, but no matching retained records were found. A partial numeric refresh message alone would not prove account association, billing cycle, complete pools, or original decimal precision.

Do not poll Crew's `/api/sessions/usage` as a purported passive cache reader. Its GET can launch authenticated work and CLI processes. No local dashboard endpoint was called during this investigation.

Normal CLI/Crew activity has left local turn records, but no before/after experiment established an independently refreshed persistent account cache during CLI-only use. Crew refresh capability is code-verified; successful refresh cadence and an accessible passive account snapshot are not live-verified.

## Smallest reliable recommendation

1. Retain the existing IDE account-log collector and show source, original observation time, and stale/unknown status. Do not make an old snapshot fresh when rescanned.
2. Do not add CLI metering or Crew per-turn totals to an account snapshot, or use them as the account balance. Keep these as separate, explicitly incomplete attribution candidates.
3. Defer CLI/Crew account adapters until a complete passive snapshot contract is demonstrated. Merely watching more directories cannot refresh data that no application persists.
4. For any future valid sources, select the newest comparable observation for a proven account partition and billing cycle; never sum overlapping account observations. Preserve equal-time conflicts and isolate unknown account association. Matching amounts or paths are not identity evidence.
5. The smallest future enabler would be an upstream Crew feature that persists an allowlisted snapshot after its existing successful refreshes, or exposes a strictly cache-only read contract that cannot trigger refresh/authentication. It must retain original as-of time, account continuity, credit pools/reset metadata, provenance and precision. Such a feature was not implemented or requested from upstream here. It would still depend on Crew actually performing its ordinary refreshes.

Under the current constraints, always-current account totals without IDE activity are not established as achievable. If no installed application publishes a fresh account snapshot, Cyclegauge must report stale/unknown; passive observation cannot manufacture it.

## Safety and evidence limits

All source access was read-only. SQLite inspection was limited to sidecar-free files, using URI `mode=ro&immutable=1`, with metadata/sidecar checks before and after. This is investigative evidence only, not proof of a safe live/WAL reader or race-free snapshot. No production adapter should be enabled on that basis.

No Kiro command, application launch, authenticated service call, dashboard call, database copy, export, checkpoint, configuration edit or verbose logging was performed. Private contents and identifiers were not emitted. Real billing amounts and observation timestamps are intentionally excluded from this repository report; the requested narrow comparison is provided in the chat. No real fixtures were created.

Public sources support architecture, not installed-version equivalence:

- [Crew project and default CLI backend](https://github.com/kirodotdev/KiroCrew)
- [Crew account cache and refresh implementation](https://github.com/kirodotdev/KiroCrew/blob/main/src/kiro_crew/dashboard/handlers/sessions.py)
- [Crew account API implementation](https://github.com/kirodotdev/KiroCrew/blob/main/src/kiro_crew/dashboard/handlers/kiro_usage_api.py)
- [Crew per-turn metrics contract](https://github.com/kirodotdev/KiroCrew/blob/main/docs/system-specs/modules/metrics.md)

Public main can change. Installed metadata and bounded local structural inspection, rather than current public main, support the installed-version findings above. Other operating systems remain unverified.

## Follow-up after user-reported CLI activity

A second read-only inspection on the same day found five temporary CLI logs (previously three), 18 shared operational logs (previously 15), and 40 CLI session JSON files (previously 39). Completed-turn metadata increased from 44 to 45 records, with metering entries increasing from 214 to 215. This establishes that additional local logs and session metering were retained after the reported CLI use.

The expanded account-field marker scan still found no known account snapshot in those logs. The CLI database still had 18 state keys and no billing-related key names. The IDE account log remained at 21 snapshots with its latest observation unchanged. These findings support CLI activity updating local session records without refreshing the inspected IDE account log; they do not establish the absence of an account cache in every possible CLI format.
