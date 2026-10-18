# Data proof for WP11 and WP13: session metadata semantics

Observation date: **2026-10-18**. Environment: **macOS**, Kiro IDE application bundle version **1.3.11** (read from the app bundle's property list; the version that wrote each retained session file is **unknown**, and the earlier [Kiro data format](kiro-data-format.md) note observed 1.2.37). One user installation, one machine. This is a dated local observation, not a Kiro contract, and says nothing about Windows, Ubuntu or RHEL.

The maintainer approved read-only access to local Kiro session data on 2026-10-18, solely to establish field semantics for WP11 and WP13 (see [evidence check](wp10-13-evidence.md)). This approval does not extend to collector, Store or feature implementation.

Labels: **Observed** (seen in the local files), **Inference** (reasoned from observations), **Unknown** (not established).

## Method and privacy statement

- Read only, by a throwaway script outside the repository: `~/.kiro/sessions/<workspace>/<session>/session.json`, `.../messages.jsonl` (parsed line by line) and `~/.kiro/sessions/cli/<session>.json`. Directory listings gave only counts, extensions and sizes.
- Not opened: CLI `*.jsonl` conversation files, `session-index`, any SQLite database, log, auth store, keychain, cookie, `~/.aws` or token file. No Kiro command was run; no file was written or touched under any Kiro folder. A process check found no running Kiro process, so no live session could be observed.
- Parsing necessarily loaded whole JSON documents into process memory, including content fields. The script printed only key names, value types, enum-like values (event kinds, stop reasons, model identifiers) and aggregate numbers. No prompt, assistant text, tool input or output, source, identifier, workspace name, path or session time is printed here or stored in the repository. Dynamic-looking key names were collapsed by the script.

Sample size: 5 workspace folders, 20 session folders, 13 IDE `session.json` files (all `schemaVersion` `1.0.0`, `dataModelVersion` 1), 10 IDE `messages.jsonl` files with 459 events, 40 CLI-format session-state files (all `session_state.version` `v1`) of which 13 contain turn metadata (45 turns in total). Sessions were short: the highest context fill seen was **17.6 %** (CLI) and **8.8 %** (IDE).

## WP11: context and message data

### (a) Which fields exist (Observed)

| Source | Field | Type | Meaning observed |
| --- | --- | --- | --- |
| IDE `messages.jsonl` | event with `payload.type` `session_metadata`, `payload.key` `contextUsage`, `payload.value.usagePercentage` | float | Context fill in percent points (values such as 1.7 to 8.8, not 0 to 1) |
| IDE `messages.jsonl` | `payload.type` kinds `turn_start`, `turn_end`, `user`, `usage_summary`, ... with `timestamp` | string/enum | Structural event stream; message and turn counts can be derived by counting kinds |
| IDE `messages.jsonl` | `usage_summary.payload.promptTurnSummaries[].usage` and `payload.requestIds[]` | float, list of string | Credits per turn; number of model requests per turn (length of the list only) |
| IDE `session.json` | `disableAutoCompaction` | bool | `false` in all 13 files |
| IDE `session.json` | no token count, no message count, no context percentage | | **Absent** |
| CLI session-state | `last_context_usage.percentage`, `.model_id` | float, string | Latest completed turn's context fill |
| CLI session-state | `rts_model_state.context_usage_percentage` | float or null | Mirror of the latest value (equal to `last_context_usage.percentage` in 12 of 13 sessions with turns; null/absent in the other) |
| CLI turn metadata | `context_usage_percentage`, `final_context_usage_percentage` | float or null | Fill at turn start and at turn end; end value was never lower than the start value in 42 comparable turns |
| CLI turn metadata | `total_request_count`, `number_of_cycles`, `message_ids[]`, `metering_usage[]` | int, int, list, list | Per-turn request count (1 to 52 observed) |
| CLI turn metadata | `input_token_count`, `output_token_count`, `cache_read_input_token_count`, `cache_write_input_token_count` | int | **Always 0** in all 45 turns |
| CLI turn metadata | `user_prompt_length`, `assistant_response_length` | int | Character lengths; not needed and content-adjacent |

Token counts are present as fields but carry no information in this installation. Message counts exist only as derivable counts of events or turns, not as a stored field. Only the context percentage is a stored, directly usable number.

### (b) Cumulative, per-turn or snapshot (Observed, Inference)

- **Context percentage is a snapshot of current fill, not a cumulative sum.** In the IDE it is emitted once per model request: the number of `contextUsage` events equals the total length of all `requestIds` lists in every one of the 10 sessions. In the CLI it is a per-turn start/end pair plus a "last" value.
- **Within a session the value is monotonic non-decreasing apart from tiny dips.** CLI: 13 of 13 sessions monotonic by turn (start and end values). IDE, ordered by event timestamp: 51 adjacent pairs, 2 decreases, the largest 0.05 percent points; no equal pairs. The first value of an IDE session is a nonzero baseline (1.7 to 3.7 %).
- **File order is not time order in the IDE stream.** 9 of 10 `messages.jsonl` files contain events whose line order differs from timestamp order. Any reader must sort by timestamp.
- **Compaction behaviour: Unknown.** No compaction was observed (maximum fill 17.6 %, no event kind that names compaction, `disableAutoCompaction` false everywhere). Whether and how the percentage drops, and whether message counts survive, could not be tested. [Documentation](wp10-13-evidence.md) says compaction replaces older messages with a summary, so a drop is expected (Inference), but no data shows it.
- **CLI request counts are per turn, not cumulative.** `total_request_count` is not monotonic across turns in all 4 sessions with 3 or more turns. It equalled the number of metering entries in 39 of 45 turns (6 differ) and never equalled `number_of_cycles`; their relation is **Unknown**. Credit values were not analysed here (additive versus cumulative is a separate, still open check in the [data format note](kiro-data-format.md)).
- Percentage basis (percent of which context window, and whether IDE and CLI use the same basis) is **Unknown**. The CLI records a context window size next to the model (see WP13) but token counts are zero, so the percentage cannot be cross-checked.

### (c) Presence and freshness (Observed, Unknown)

- **IDE:** every session with at least one model request has `contextUsage` events, so the latest value exists once the first request has run. The `messages.jsonl` modification time matched the last event timestamp to within rounding (under one second) in 10 of 10 files, and `session.json` `lastModifiedAt` equalled the last event time in 10 of 10. This indicates the stream is appended as events happen, not rewritten only at session end (Inference). The value is emitted after each model request, so it updates inside a running turn, not only at its end.
- **CLI:** the session-state file is updated when a turn completes (`updated_at` was at or after the last turn end in 13 of 13 sessions; it equalled it in the typical case). An in-progress turn has no turn metadata yet (Inference), so the CLI value lags the live turn by up to one turn. 27 of 40 CLI files have no turn metadata and null `last_context_usage`.
- **Not testable:** no Kiro process was running, the newest session file was about 21 hours old, so behaviour during a **currently active** session (write cadence, buffering, partial lines, file replacement) is **Unknown**. Retention is also unknown: 19 of 115 files were older than 30 days.

### (d) Can a reminder be built from live fields? (Inference)

- **Context nearly full:** yes in principle, from the newest session's latest `contextUsage` (IDE) or `last_context_usage` (CLI). Limits: the fill never exceeded 17.6 %, so behaviour near the compaction threshold, the meaning of 100 %, and the effect of compaction are unobserved; the IDE and CLI have different freshness; one installation only.
- **Many messages:** derivable by counting `turn_start` events (IDE) or turn metadata entries (CLI) in the current session, but a count has no verified relation to context fill or cost, and compaction behaviour for counts is unknown. The context percentage is the better signal; a message count adds little.
- Kiro already shows a context meter and compacts automatically ([evidence check](wp10-13-evidence.md)). A reminder adds value only if it fires earlier or in a place the meter is not visible. That is a product judgement, not a data question.

### WP11 recommendation

**Data proof: partly successful.** Feasibility of a context-percentage snapshot is shown (field exists, is a snapshot, is monotonic apart from sub-0.1-point dips, is written as events occur). Compaction behaviour, live-session freshness and values near the limit are not shown, and the token and message-count fields are not usable.

**Recommendation: conditional go; ship in 1.1, not 0.13.** If the maintainer nonetheless wants it in 0.13, the unknowns must be accepted explicitly (no compaction evidence, one machine, short sessions) and the feature should never claim more than "latest observed context fill of the newest session, as of its time". Mandatory `security-reviewer` (session-data reading) either way.

### Minimal safe design sketch (WP11)

- **Roots:** `~/.kiro/sessions` only (resolved once; reject symlinks and any path resolving outside it). IDE: the newest session by `session.json` modification time within the workspace folders; CLI: the newest `cli/*.json`. No recursion beyond the two known depths; at most a bounded number of entries listed (for example 200) and further entries counted as "not checked".
- **Reads:** read-only handles, no sidecars. IDE: read at most the last 256 KiB of `messages.jsonl` (more means "too large", report unavailable), drop a partial first line, parse each line strictly. A cheap pre-filter on the literal `session_metadata` may skip parsing, but a hit must still be parsed as JSON. CLI: file size cap (for example 256 KiB; the largest observed was 94 KiB), parse, then keep only the allowlist below and discard everything else immediately.
- **Allowlisted fields:** IDE `timestamp`, `payload.type`, `payload.key`, `payload.value.usagePercentage`; CLI `last_context_usage.percentage` and the final turn's `end_timestamp`. Accept the percentage only if it is a finite number in 0 to 100 (or small tolerance above 100 shown as "full"); anything else is unavailable.
- **Output:** one record `{percentage, asOf, source: "ide"|"cli"}` in memory. No session id, workspace name, path, title, model or prompt-derived data; no persistence (nothing written, so no Store change); diagnostics show only fixed codes and counts (for example "no session found", "file too large", "unsupported shape", "value out of range").
- **Freshness:** show "as of" and mark stale after a stated age; never present the value as the live meter. Missing, unparsable or partially written data yields "unavailable", never a guess. Sort IDE events by timestamp; take the newest `contextUsage`.
- **Behaviour:** a threshold (setting, default for example 70 %, not evidence-based) triggers an informational reminder once per crossing; no count-based reminder in the first version.

### Synthetic-fixture test plan (WP11)

All fixtures hand-written with `synthetic-*` identifiers and invented numbers; none derived from the real files.

1. IDE stream with `turn_start`, three `contextUsage` events (invented 4.0, 6.5, 9.0), `usage_summary`, `turn_end`: newest value 9.0.
2. Out-of-order lines (timestamps shuffled): newest by timestamp, not by line.
3. Tiny decrease between consecutive values: accepted, newest by timestamp wins; larger decrease (invented compaction drop 80 to 12) is accepted as the newest value, labelled as a snapshot.
4. Truncated last line, empty file, file over the size cap, invalid JSON, missing `payload`, wrong types, string percentage, NaN/negative/over-range value: each yields the fixed "unavailable" code with counts only.
5. Content fields present with sentinel strings (for example `synthetic-prompt-sentinel`): assert the sentinel never appears in the result, diagnostics, logs or persisted output.
6. CLI state with and without `last_context_usage` (null), zero turns, multiple turns; token fields present as zero are ignored.
7. Symlinked session folder and a symlink escaping the root: rejected. Read-only guarantee: opened with read flags only; test fails if the code path creates or writes any file.
8. Newest-session selection among several synthetic sessions; more entries than the listing cap.
9. Threshold logic: below, at and above the threshold; one reminder per crossing; stale value suppresses the reminder.

## WP13: model data

### (e) Where the model is recorded (Observed)

| Source | Field | Type | Observed values |
| --- | --- | --- | --- |
| IDE `session.json` | `modelId` | string | `auto` in 11 files; key **absent** in 2 files |
| IDE `session.json` | `contextSnapshotModelDisplay.modelId`, `.display` | string, string | `modelId` `auto` in 8 files (equal to `modelId` every time); `display` is a localized descriptive sentence beginning with "Auto" (about 47 characters), not an enum |
| IDE `messages.jsonl` | `assistant` events with `payload.reasoningModelId` | string | `<namespace>::auto` in all 61 reasoning events; exactly one distinct value per file |
| CLI turn metadata | `model` | string | `auto` in all 45 turns |
| CLI session-state | `last_context_usage.model_id`, `rts_model_state.model_info.model_id` | string | `auto` in all |
| CLI session-state | `rts_model_state.model_info` | object | In 37 of 40 files: `model_name`, `description`, `model_id`, `context_window_tokens` (int, 1000000), `rate_multiplier` (float, **1.0**), `rate_unit` (`Credit`). In 1 file an older shape with only `model_id`, `context_window_tokens` (200000) and an empty description; in 2 files `model_info` is null |

Findings:

- **Granularity (Observed):** IDE records the model both per session (`modelId`, snapshot display) and per request (`reasoningModelId` on reasoning events); CLI records it per turn and per session. It is available for the newest session in both formats.
- **Auto versus chosen model (Unknown):** every observed value is Auto. No session with a manually chosen model existed, so the field values and shapes for a chosen model, whether `modelId` then carries a concrete product identifier, and whether `rate_multiplier` is then relative to Auto, were **not observed**. The two IDE sessions without `modelId` suggest the key is optional (it may be written only when set; Inference).
- **Resolved model under Auto (Observed):** the records say "auto", not the model that actually served a request. A per-request resolved model, a fallback event or a model change inside a session was not observed. The IDE per-request label is a routing label, not a resolved model (Inference).
- **Kiro's own multiplier in the CLI file (Observed, important):** `rate_multiplier` and `rate_unit` are stored next to the model, with Auto at 1.0, which is the same baseline as the published table ([evidence check](wp10-13-evidence.md), S7). If a chosen model carries its own multiplier there, the extension would not need to maintain the table for the CLI. The IDE format has no such field.

### (f) Could the extension say "about Nx the credits of Auto"? (Inference)

- **Source of N:** (1) CLI `rate_multiplier` when present and the model is not Auto; (2) otherwise the dated published table (S7) keyed by the recorded model identifier. The mapping from recorded identifier to published product name is **Unknown** until a non-Auto value is observed.
- **Caveats:** Auto resolves to varying models and fallback may occur, so for Auto no multiplier above 1.0 can be claimed and a hint would be silent. Multipliers are per request or per unit as Kiro defines them; the published page itself warns that equal multipliers do not mean equal credits per task, that higher reasoning effort uses more, and that some models have a two-tier context price. The wording must be "about", dated, and cite the source. The table changes with each Kiro model release, so a hard-coded table needs a review step. Plan availability and Enterprise-preview models can make a recorded model unavailable to a user. A session's last model may differ from the model the user will pick next, so the hint is about the last used model, not a prediction.
- **Reading cost:** one more field from the same files used for WP11, so no new class of access, but it is still a Kiro-owned session read needing the same review.

### WP13 recommendation

**No-go for 0.13; revisit for 1.1.** The data exist (per-session and per-turn model, and in the CLI Kiro's own multiplier), but the proof is incomplete in the one case that matters: **only Auto was ever observed**, so how a chosen model is recorded, and whether the hint can fire at all, is unverified. Shipping on that basis would encode an assumption, which AGENTS.md forbids. To close the gap the maintainer can run **one short session with a manually chosen non-Auto model** in the IDE (and optionally the CLI) and have the same read-only script re-run; this spends a few credits and is the maintainer's decision. If the field shows a concrete model identifier (and, for the CLI, a multiplier), WP13 becomes a conditional go for 1.1 with the design below. Mandatory `security-reviewer` if session data is read.

### Minimal safe design sketch (WP13)

- **Same roots, caps, read-only handles and newest-session selection as WP11**; reuse one reader.
- **Allowlisted fields:** IDE `modelId` (fallback `contextSnapshotModelDisplay.modelId`), newest `reasoningModelId`; CLI newest turn `model` and `rts_model_state.model_info.{model_id, rate_multiplier, rate_unit}`. Accept a model identifier only if it matches a short pattern (letters, digits, dot, dash, underscore, colon; at most 40 characters). The localized `display` and `description` strings are not read.
- **Decision logic:** Auto or unknown identifier means no hint. A known non-Auto identifier maps to a multiplier from the CLI field (if finite and `rate_unit` is `Credit`) or from the dated in-extension table; no match means no hint. Output is a fixed-text hint with the multiplier, the table date and source name; the session itself, identifiers and paths are never shown.
- **No persistence, no network, no workspace or session identity in output or diagnostics.** Opt-out setting. Diagnostics carry only fixed codes and counts.

### Synthetic-fixture test plan (WP13)

1. IDE `session.json` with `modelId` `synthetic-auto`-style Auto value: no hint. With an invented non-Auto identifier present in a test table: hint with the invented multiplier and date.
2. `modelId` absent; `contextSnapshotModelDisplay` only; both disagreeing (the session value wins, documented in the test).
3. CLI state with `model_info` carrying `rate_multiplier` 1.0 versus an invented 2.0; missing `rate_multiplier`; non-finite, negative or string value; `rate_unit` not `Credit`.
4. Unknown identifier, over-long identifier, identifier with path or control characters: no hint, fixed code.
5. Multiplier rounding and wording ("about 2x", never "exactly"), including values below 1 ("about half"), and a stale table date triggering the "check Kiro's current table" wording.
6. Sentinel-content test and symlink/size-cap/invalid-JSON tests shared with WP11.
7. Test that `display` and `description` strings never reach output.

## Summary

| Item | Data proof | Recommendation |
| --- | --- | --- |
| WP11 context reminder | Field exists in IDE and CLI, snapshot semantics, monotonic apart from sub-0.1-point dips, IDE written per request; token counts always zero; compaction, live-session freshness and high fill unobserved | **Conditional go; ship in 1.1**, not 0.13; design above if the maintainer overrides |
| WP13 model hint | Model recorded per session/turn/request and, in the CLI, with Kiro's own multiplier; only Auto observed, so the hint's trigger case is unverified | **No-go for 0.13**; revisit for 1.1 after one controlled non-Auto observation |

Limits of this proof: one installation, short sessions, Auto only, no running Kiro process, mixed unknown writer versions, macOS only, and the fact that local files are an undocumented implementation detail that Kiro can change without notice. Every reader must fail closed to "unavailable".
