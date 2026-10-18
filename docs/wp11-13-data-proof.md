# Data proof for WP11 and WP13: session metadata semantics

Observation date: **2026-10-18**. Environment: **macOS**, Kiro IDE application bundle version **1.3.11** (read from the app bundle's property list; the version that wrote each retained session file is **unknown**, and the earlier [Kiro data format](kiro-data-format.md) note observed 1.2.37). One user installation, one machine. This is a dated local observation, not a Kiro contract, and says nothing about Windows, Ubuntu or RHEL.

The maintainer approved read-only access to local Kiro session data on 2026-10-18, solely to establish field semantics for WP11 and WP13 (see [evidence check](wp10-13-evidence.md)). This approval does not extend to collector, Store or feature implementation.

Labels: **Observed** (seen in the local files), **Inference** (reasoned from observations), **Unknown** (not established).

**Update of 2026-10-18 (second observation, after the maintainer used non-Auto models):** see [the dated update section](#update-2026-10-18-second-observation-with-non-auto-models). It supersedes the first-pass statements "only Auto observed" and the WP13 no-go below; those paragraphs are kept as the record of the first pass.

**Update of 2026-10-18 (third observation, Sonnet 4.5 and runtime-read approval):** see [the third update](#update-2026-10-18-third-observation-claude-sonnet-45-and-combined-design). It supersedes the WP13 recommendation and the dip statements of the second update and adds the combined WP11/WP13 design.

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

### WP11 recommendation (first pass, superseded by the third update)

**Data proof: partly successful.** Feasibility of a context-percentage snapshot is shown (field exists, is a snapshot, is monotonic apart from sub-0.1-point dips, is written as events occur). Compaction behaviour, live-session freshness and values near the limit are not shown, and the token and message-count fields are not usable.

**Recommendation: conditional go; ship in 1.1, not 0.13.** If the maintainer nonetheless wants it in 0.13, the unknowns must be accepted explicitly (no compaction evidence, one machine, short sessions) and the feature should never claim more than "latest observed context fill of the newest session, as of its time". Mandatory `security-reviewer` (session-data reading) either way.

### Minimal safe design sketch (WP11)

- **Roots:** `~/.kiro/sessions` only (resolved once; reject symlinks and any path resolving outside it). IDE: the newest session by `session.json` modification time within the workspace folders; CLI: the newest `cli/*.json`. No recursion beyond the two known depths; at most a bounded number of entries listed (for example 200) and further entries counted as "not checked".
- **Reads:** read-only handles, no sidecars. IDE: read at most the last 256 KiB of `messages.jsonl` (a larger file is read by its tail only, not rejected; first-pass sketch, superseded by the combined design below, which also defines the exact line handling). A cheap pre-filter on the literal `session_metadata` may skip parsing, but a hit must still be parsed as JSON and shape-checked. CLI: file size cap (for example 256 KiB; the largest observed was 94 KiB), parse, then keep only the allowlist below and discard everything else immediately.
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

### WP13 recommendation (first pass, superseded by the update below)

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

## Update 2026-10-18: second observation with non-Auto models

Same method, same privacy rules, same read-only scope as above (session metadata fields only; the throwaway script printed key names, types, model identifiers and aggregate numbers). New data since the first pass: **one new IDE session** (now 11 `messages.jsonl` files, 13 `session.json` files, 459 plus 44 events) in which non-Auto models were used. The 40 CLI-format files were unchanged (their newest file is about 8 days old), so the CLI side has **no** non-Auto data. No Kiro process was found running; the newest IDE file was modified a few minutes before the read, and over a 20-second poll `modelId` did not change.

Public documentation was queried for the published multipliers (page `models/available-models` and the models overview, retrieved 2026-10-18; the queries contained no private values): **MiniMax M2.5 is 0.25x with a 200K context window, MiniMax M2.1 is 0.15x with a 200K context window**; Auto is the 1.0x baseline with a 1M window, "automatic fallback capabilities" and may route to any active model. The same page states that Kiro does not switch a selected model automatically when a model is removed. The repository table in [the evidence check](wp10-13-evidence.md) lists only example rows and does not contain these two models, so the comparison below is against the public page.

### WP13 with non-Auto evidence

**Distinct non-Auto identifiers observed (IDE, 1 session):** `minimax-m2.5` and `minimax-m2.1`. Nothing else, so Anthropic, OpenAI and other families are **unobserved**.

| Field | Non-Auto value observed | Notes |
| --- | --- | --- |
| IDE `session.json` `modelId` | `minimax-m2.5` | Plain kebab-case product identifier, no namespace. Same value in `contextSnapshotModelDisplay.modelId` |
| IDE `messages.jsonl` `assistant` event `reasoningModelId` | `<namespace>::minimax-m2.1`, then `<namespace>::minimax-m2.5` | Same namespace prefix as for Auto (`<namespace>::auto`); the identifier after `::` has the same form as `modelId` |
| IDE multiplier | none | The IDE files hold **no** `rate_multiplier`, unit or context window |
| CLI per-turn `model`, `rts_model_state.model_info` | `auto` only | No non-Auto CLI record exists; whether the CLI stores a multiplier for a chosen model remains **Unknown**. The only multiplier ever recorded is 1.0 for Auto |

Answers:

- **How a chosen model is recorded (Observed):** `session.json` `modelId` is a plain identifier of the chosen model; the key is written for Auto too (`auto`, in 10 of the 11 files that have it; absent in 2 of 13 files). The per-request label `reasoningModelId` carries the same identifier behind the namespace prefix. So Auto versus chosen model is distinguishable by the identifier `auto` versus anything else (Observed for one family).
- **Per-session or per-turn (Observed):** both. But `reasoningModelId` is present only on `assistant` events of operation type `Reasoning`; in the new session the first three turns have `contextUsage` and `usage_summary` events and **no** label at all, so the model of those turns is not recorded per request (Observed). A per-request model cannot be assumed to exist.
- **Latest/active session and mid-session switch (Observed, Inference):** in the new session the two labelled requests (consecutive turns, 6 seconds apart) are `minimax-m2.1` then `minimax-m2.5`, and `session.json` `modelId` equals the **latest** label (in 11 of 11 files where both exist). That is consistent with `modelId` being updated when the user switches (Inference). I did not observe the switch itself, so I cannot prove the update timing, and I cannot tell a user switch from a fallback; only the maintainer's account of what was done can. `session.json` `lastModifiedAt` equalled the last event time and the file was written as events happened, as in the first pass.
- **Auto versus fallback (Unknown):** a fallback event or a distinct field for a resolved model was not seen. Under Auto only `auto` is recorded; the model that served a request is not. The documentation says Auto routes with automatic fallback, so a hint must stay silent for Auto.
- **Does the recorded multiplier equal the published table (not verifiable locally):** no local multiplier exists for non-Auto models, so there is nothing to compare. The published page gives 0.25x and 0.15x, which a hint would have to take from a dated in-extension table. Local credit amounts cannot validate it either: the single-request turns of the non-Auto session recorded between 0.04 and 0.37 credits, and single-request Auto turns in earlier sessions recorded 0.04 to 0.13; the ranges overlap, which is expected because credits depend on tokens and thinking depth, not only on the multiplier.
- **Context window (Inference):** the percentage appears to be relative to the selected model's window. The first contextUsage of Auto sessions is 3.5 % (1M window, about 35,000 tokens) and of the 200K-window non-Auto session 17.5 % (about 35,000 tokens), the same absolute baseline. This is arithmetic on aggregate numbers, not a Kiro statement.

### WP11 re-check

- **Higher fill:** the highest IDE value is now 17.5 % (the 200K-window session; earlier IDE maximum 8.8 %, CLI 17.6 %). Fill near the limit is still unobserved.
- **Non-monotonic values (Observed):** adjacent IDE pairs now number 55 with **4 decreases**, the largest **2.98 percent points** (earlier 2 decreases, at most 0.05). The new session starts at 17.5 % and falls to 15.5 % and 12.5 % over its first three turns, then rises to 15.9 % and 16.0 %. The cause is **Unknown**: candidates are a change of the selected model (different window), context trimming or compaction. No event kind names compaction, `disableAutoCompaction` is false everywhere, and `contextUsage` events still equal the sum of `requestIds` lengths. The statement "monotonic non-decreasing within a session" from the first pass therefore holds only for sessions without a model switch or trimming; it must not be relied on.
- **Consequence:** a reminder must treat the value as a snapshot, should use the newest value by timestamp (file order differed from timestamp order in 10 of the 11 `messages.jsonl` files) and must not assume growth. Percentage is relative to the model in use at that time (Inference), so it can fall when the model changes.
- **Live freshness:** still not verified during an active turn; the file was last written minutes before the read, and no process was running.

### Updated WP13 recommendation

**Conditional go; target 1.1; 0.13 only if two conditions hold.** The IDE records the chosen model as a plain identifier in `session.json` `modelId`, the value follows the latest request label, the identifier `auto` separates Auto from a chosen model, and the multipliers are documented and citable with date. What is still missing is evidence for the case that makes the hint useful: **only the cheap MiniMax family was seen (0.15x and 0.25x), no model above 1x**, and the CLI has no non-Auto record. A hint "about a quarter of the credits of Auto" is accurate but rarely actionable; the hint with value is "about 2x". Therefore:

1. 0.13 requires the maintainer to approve the read of session metadata as a feature (the 2026-10-18 approval covers evidence only; AGENTS.md requires separate approval for session data) and `security-reviewer`.
2. 0.13 additionally requires one more controlled observation with a model above 1x (for example an Opus-class model), to confirm the identifier form and its mapping to the published row. Without it, the in-extension table may contain only the identifiers that were actually observed, and every other identifier produces **no hint**.

If either condition fails, ship in 1.1. The first-pass "no-go" is withdrawn for the IDE `modelId` field; it still applies to anything CLI-based.

### Minimal safe design sketch (WP13, IDE only)

- **Source:** only the IDE `session.json` of the newest session under the allowlisted root `~/.kiro/sessions/<workspace folder>/<session folder>/`, the same reader, caps, symlink rejection and read-only handles as WP11. Newest chosen by `session.json` modification time within a bounded listing (for example 200 entries, further ones counted as "not checked"). `session.json` is tiny (largest seen 1 KB; cap at 64 KiB). `messages.jsonl` is **not** needed for this hint; do not read it.
- **Allowlisted field:** `modelId` only (fall back to nothing; `contextSnapshotModelDisplay` and `reasoningModelId` are not read). Accept it only if it matches `^[a-z0-9][a-z0-9._-]{0,39}$`; anything else, including an absent key, yields no hint.
- **Decision:** `auto`, absent, unknown or unlisted identifier: no hint (fixed code). A listed identifier: look up the multiplier in a dated in-extension table whose entries carry identifier, multiplier, published name, source page and retrieval date. Show a hint only if the multiplier is at least 1.5 (an "about Nx the credits of Auto" message) unless the maintainer also wants a savings message for cheaper models; cite the source and date; say "last used model of your newest session".
- **Output and privacy:** a fixed-text message with the multiplier and date. No session, workspace, path, title, timestamp of the session or raw model string in output or diagnostics (the table's own published name is shown, not the raw value). No persistence, no network, no writing under `~/.kiro`, opt-out setting.
- **Table maintenance:** a review step on each Kiro model release (as for the pricing catalog); a stale-table age shows "check Kiro's current table" wording instead of a number.
- **Caveats the message must reflect:** multipliers are relative per request and not per task; higher thinking effort and long context cost more; the newest session may not be the one in use; Auto hides the real model.

### Synthetic-fixture test plan (WP13, IDE only)

All fixtures invented; identifiers like `synthetic-model-a` stand in for table entries, never real session files.

1. `session.json` with `modelId` `auto`: no hint. Absent `modelId`: no hint. Listed invented id with multiplier 2.0: hint "about 2x" with the table date and source.
2. Listed invented id with multiplier below the threshold: no hint (or the savings message if approved); multiplier exactly at the threshold.
3. Unlisted id, over-long id, id with path separators, spaces, control characters or uppercase: no hint, fixed code, the raw string never appears in output or diagnostics (sentinel test).
4. `modelId` of the wrong type (number, object, array, null): no hint.
5. Invalid JSON, empty file, file over the cap, truncated file: "unavailable" code.
6. Several synthetic sessions with different modification times: the newest wins; ties and equal times resolve deterministically; listing over the cap yields a "not checked" count.
7. Symlinked session folder or symlink escaping the root: rejected; opened read-only; test fails if any file is created or modified.
8. Table staleness: a table older than the stated age returns the "check Kiro's current table" wording.
9. Extra fields containing sentinel strings (`display`, `title`, `rootPaths`) must never reach any output.
10. A messages file next to the session file (with sentinel content) is never opened (assert via a spy on the file reader).

## Update 2026-10-18: third observation (Claude Sonnet 4.5) and combined design

Same read-only, metadata-only method and privacy rules as before (the throwaway script printed key names, types, model identifiers, event kinds and aggregate numbers only; whole JSON documents were parsed in memory and content was never printed or stored). New since the second update: the maintainer ran **Sonnet 4.5** in the same IDE session as the MiniMax turns (now 14 `session.json` and 12 `messages.jsonl` files; the 40 CLI-format files are unchanged, so the CLI still has **no** non-Auto record). The maintainer has also **approved runtime reading of session metadata** for WP11 and WP13, subject to `security-reviewer`, limited to allowlisted metadata fields, no content. That approval is the maintainer's decision, recorded here; it is not an implementation approval beyond that scope.

### How Sonnet 4.5 is recorded (Observed)

| Field | Value | Notes |
| --- | --- | --- |
| IDE `session.json` `modelId` | `claude-sonnet-4.5` | Also in `contextSnapshotModelDisplay.modelId`. Same file that held `minimax-m2.5` at the previous read: the value was **replaced in place** (Observed across two reads), so it tracks the current selection |
| IDE `reasoningModelId` | none for the Sonnet turn | The Sonnet turn (4 requests, 0.98 credits) has `contextUsage` and `usage_summary` events but **no** reasoning label. `modelId` is therefore the only record of the model for that turn |
| IDE multiplier | none | Same as for MiniMax: no multiplier, unit or window stored |
| CLI per-turn `model`, `rate_multiplier`, `rate_unit` | not observed | CLI files unchanged (Auto, 1.0, `Credit`) |

- **Identifier form (Observed, Inference):** `claude-sonnet-4.5` has the same form as `minimax-m2.5`: lowercase, hyphen-separated, dot in the version. It matches the published product name lowercased with spaces replaced by hyphens ("Claude Sonnet 4.5", "MiniMax M2.5"). Two vendors fit the rule; whether it holds for every model (for example Opus, GPT, Kimi, Qwen) is an **Inference**, so each table row must be marked as observed or pattern-derived.
- **Published multiplier (Documented):** Kiro's public models overview and available-models page (retrieved 2026-10-18, no private values in the queries) list **Claude Sonnet 4.5: 200K context window, 1.3x**; Claude Sonnet 4.0 also 1.3x with 200K; Sonnet 4.6, 5 and 5.5 are 1.3x with 1M. MiniMax M2.5 0.25x and M2.1 0.15x as before; Auto is the 1.0x baseline. A recorded multiplier cannot be compared with this (none is stored locally for non-Auto models), and local credit amounts cannot validate it (Sonnet turn 0.98 credits for 4 requests; single-request Auto turns 0.04 to 0.13).
- **`modelId` versus `reasoningModelId` (Observed):** `modelId` equalled the latest request label in 11 files; in the Sonnet session it differs from the latest label (`auto`, an earlier turn) because the Sonnet turn has no label. **`reasoningModelId` is therefore not usable; `modelId` is the field to read.** Whether `modelId` changes at the moment of selection or at the next prompt is **Unknown**.
- **Auto versus chosen versus fallback:** the same session shows the sequence MiniMax, then Auto (labels `auto`, 1M-window baseline), then Sonnet 4.5. `modelId` is `auto` for Auto. A fallback record is still **not observed**; under Auto the served model is not recorded.

### WP11 update (Observed)

- **Fill values:** highest IDE value now **23.9 %** (the Sonnet turn: 18.7, 20.9, 22.8, 23.9 over its four requests, increasing within the turn). Near-limit fill and compaction remain unobserved.
- **Dips (Observed):** 71 adjacent IDE pairs (timestamp order), **5 decreases**, the largest **12.4 points**. Of the five: one is the switch from a 200K-window model to Auto (about 16 % to 3.5 %), two are tiny (at most 0.05 points), and two (2.0 and 3.0 points, early turns of the session) are unexplained. The reverse jump (3.7 % to 18.7 %) occurs at the switch to Sonnet 4.5. The Auto baseline returned to the same 3.5 % as in other Auto sessions, and the 200K-window sessions start at about 17.5 % to 18.7 %, which supports **percentage = used tokens / window of the currently selected model** (Inference; about 35,000 tokens in both cases).
- **Consequences for a reminder:** use the newest value by event timestamp (file order differed from timestamp order in nearly every inspected `messages.jsonl` file); never assume monotonic growth; a model switch can lower or raise the percentage without any change in conversation size, so a reminder should be re-armed by falling below the threshold and may fire after a switch to a smaller-window model. Percentage is "of the selected model's window", as Kiro's own meter presumably shows (Unknown whether identical).
- **`contextUsage` events** still equal the total number of `requestIds` (one per model request) in every session with messages.
- **Freshness:** the session files were modified one minute before the read and `lastModifiedAt` equalled the last event; events are written as they occur (Observed). Behaviour exactly during an unfinished request is still unverified.

### Does a model above 1x change the WP13 recommendation?

Yes. Both conditions set in the second update are met: the maintainer approved the runtime read, and a model above 1x (Sonnet 4.5, 1.3x) is recorded in the same way as a cheap one. What remains is `security-reviewer` and native macOS acceptance. The cost of a minimal IDE-only implementation is small: one pure parser for `modelId`, one dated table, one bounded reader that WP11 needs anyway, one notification and one setting; no new dependency, no Store or collector change, no persistence. Because 0.13 is the last feature beta and 1.0 adds no features, the choice is 0.13 or 1.1, not 1.0 itself.

**Updated recommendation: GO for 0.13 as one small combined feature (WP11 reminder plus WP13 hint), IDE-only, macOS first.** If `security-reviewer` or the native test fails or finds an open question, both move to 1.1 together. WP11 is a go with weaker evidence than WP13: the thresholds below are educated guesses, compaction and near-limit behaviour are unobserved, and Kiro already shows its own meter. The reminder must be worded as an advisory and be switchable. The hint should only appear for a table multiplier above 1.0; at or below 1.0 stay silent. CLI-based reading remains out of scope (no non-Auto CLI record, different files).

### Combined implementation design (WP11 plus WP13, one feature "session hints")

Revised after the security review of this design (reported to me by the coordinator as: no blockers; hardening items H1 to H3, M1 to M5, L1 to L5, all incorporated below as acceptance criteria). These criteria were the requirements for the implementation; see the decision record below (2026-10-18) for what was decided and implemented.

**Decision record (2026-10-18).** The maintainer decided D1 to D3 and the feature was implemented: **D1** default on (application-scope setting `cyclegauge.sessionHints` turns it off; release-notes entry in the CHANGELOG); **D2** pattern-derived table rows are allowed to show a hint, so the table covers every model of Kiro's published table (22 models besides Auto, as of 2026-10-18) with rows marked *observed*, *documented* (identifier string in Kiro's settings documentation) or *pattern-derived*, and a hint only for a multiplier above 1.0; **D3** no in-product notice (it would need a new persisted flag); a step in the first-minute walkthrough explains the feature instead. Security review follow-ups were applied afterwards: the reader's privacy wording names the up to 20 `session.json` files that are parsed, an over-full workspace folder (more than 200 sessions) is skipped and counted instead of silencing the whole check, and the model hint appears at most once per model per run across sessions. Where a later bullet below still reads as a proposal, this record prevails.

**Purpose.** From the most recent IDE session of the open workspace, show at most (a) a context-fill reminder at two thresholds and (b) a hint when the session's model costs more than Auto per the published table. Silent in every uncertain case.

**Trust boundary.** A new, third read class: *Kiro session metadata, IDE format, read at runtime*. It sits beside the account-usage readers and is separate from the collector's inputs, the Store and the forecast; nothing read here enters history, Store, CLI JSON or diagnostics. The reader module has no VS Code dependency (like the collector); only the thin wiring in the extension host (timer, notification, setting) uses the editor API. The reader returns a small in-memory value `{ contextPercent | null, modelId | null, asOf }` and discards everything else.

#### Gating and settings (H3, L2)

- **No filesystem access when off.** If the feature is disabled, or the platform is not macOS (the only observed platform), or the extension host is not local (`remoteName` set), or no open folder has the `file:` scheme, the feature performs **no filesystem call at all**, not even a `stat` of the home folder. Acceptance test: an fs-spy over every `node:fs` and `fs/promises` entry point records zero calls in each of those cases.
- **Setting scope.** One enable setting registered with application (machine) scope, so a workspace or folder `settings.json` cannot switch it on; workspace and folder values are ignored. Thresholds are constants, not settings, in the first version.
- **Default (decision D1, decided: default on).** Decided: **default on** for both parts, with a one-time notice in the release notes, CHANGELOG and README, because the maintainer wants maximum automation; the alternative is opt-in (default off) for the first beta. The reader is read-only, bounded and silent when uncertain, but it is a new read of Kiro-owned session files, so the choice must be an explicit maintainer decision. An in-product one-time notice is an optional addition.
- **Multi-root and remote (L2).** Match against **any** `file:` workspace folder. Remote, WSL, SSH and other non-local extension hosts: silent. Path-versus-URI forms (`fsPath` of the folder URI versus the strings in `workspacePaths`) and NFC/NFD folder names are a native-test item, not assumed.

#### Selection of the session (H1, M2, L3)

- **Root.** `~/.kiro/sessions` on macOS only. **No user-configurable root** (M4): the root is fixed; a test-injected root exists only as a constructor argument of the reader, never reachable from settings. If the maintainer later wants an override, it needs a separate machine-scoped setting and its own review. If `~/.kiro` (or any ancestor below the home folder) is a symlink, the reader **fails closed** and stays silent (L3); users who symlink `~/.kiro` get no hints, and this is documented.
- **Pre-selection by mtime, bounded opens.** List workspace folders and their session folders non-recursively (skip the `cli` folder; at most 200 entries per level; a larger listing yields the fixed code `listing_capped` and silence). `lstat` only the `session.json` of each session folder for its mtime, sort by mtime descending with a deterministic tie-break (the folder name compared as bytes, in memory only), and open **at most N = 20** `session.json` files per tick. If the open workspace's session is not among the N newest, the result is silent (`no_match`); this is documented, not worked around.
- **Strict `lastModifiedAt` (H1, L1).** Parse `lastModifiedAt` strictly as ISO 8601 with a numeric offset or `Z` (no free-form dates); reject values more than 5 minutes in the future of the local clock; require rough agreement with the file mtime (suggest within 10 minutes) or reject the candidate. Among accepted candidates whose workspace matches, pick the greatest `lastModifiedAt`, then the greatest mtime, then the folder name.
- **Allowlisted fields of `session.json`:** `schemaVersion` (must be `1.0.0`), `dataModelVersion` (must be `1`), `modelId`, `lastModifiedAt`, `workspacePaths`. The file is parsed whole (cap 64 KiB; the largest observed was about 1 KiB) and everything else is discarded immediately.
- **Workspace match as pure string comparison (M2).** `workspacePaths` must be an array of at most 8 strings of at most 4096 characters each, otherwise the candidate is rejected. Compare the open folder's path with each entry as strings only: Unicode NFC on both sides, the platform's case rule (macOS: case-insensitive, documented), trailing separators trimmed, **no filesystem call** (no `realpath`, no `stat`). Whether `workspacePaths` equals the open folder in practice was not tested here and is a native-test item. No match: silent; never fall back to the newest session overall. Sessions whose `lastModifiedAt` is older than 12 hours count as inactive.

#### One bounded reader (H2, M3, L5)

Generalise the existing primitive in `src/audit/read-ignore.ts` (lstat, `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`, `fstat` equal to `lstat` on `dev` and `ino`, regular-file check, same-device check, ancestry walk without symlinks) into **one** shared reader with two modes, whole file with a byte cap and tail with a byte window. The audit's behaviour and tests stay unchanged (that refactor is part of what the reviewer must see). Requirements:

- **Checks before and after the read.** `lstat` the file; verify the **ancestry** from the fixed root to the file (every segment a real directory, not a symlink, same device as the root); open; `fstat` must be a regular file with the same `dev` and `ino` as the `lstat` and the same device as the root; read; then repeat the `fstat` and the ancestry check. A change of size, mtime or inode between the checks, or an ancestry change, yields the fixed code `changed` and silence for this tick; a partial result is never used.
- **Abort and timeouts (L5).** A tick has a time budget (a few hundred milliseconds) and an abort signal; on abort or timeout the file handle is closed in a `finally` path and the result is the fixed code `aborted`. Acceptance test: abort in the middle of a read closes the handle (spy on `close`) and returns silence.
- **Tail mode for `messages.jsonl` (M3).** Window = the last 256 KiB. If the file is larger than the window, read `window + 1` bytes starting one byte **before** the window: if that extra byte is `\n`, the first line of the window is complete and is kept; otherwise drop everything up to and including the first `\n`. If the file is not larger than the window, read it from offset 0 and keep every line. A file larger than 256 KiB is **not** an error and **not** "too large": only its tail is examined; if no candidate is found in the tail the result is `no_candidate` and silence.
- **Work in bytes.** Split the buffer on `\n` and consider only **newline-terminated** lines (an unterminated last line may be mid-write and is ignored). Skip lines longer than 4 KiB. Find candidates with a byte search for both literals `"session_metadata"` and `"contextUsage"`; **decode only candidate lines** as UTF-8. Parse them with `JSON.parse` and require the exact top-level event shape: an object with a string `timestamp` (strict ISO with offset), an object `payload` with `type == "session_metadata"`, `key == "contextUsage"` and an object `value` with a number `usagePercentage`. Anything else is dropped. After use, zero-fill the read buffer (`buffer.fill(0)`); decoded strings of candidate lines cannot be zeroed in JavaScript, which the privacy text must not claim.
- **Correction of an earlier claim.** The earlier draft called candidate lines "content-free". That is **not guaranteed**: a user message containing both literals within 4 KiB would be a candidate and would be decoded and parsed. The shape check discards it (its `payload.type` is `user`), and it is never stored, shown or logged, but it is a content-bearing line passing through memory. The same holds for the raw bytes of the whole tail window.
- **Selection of the value.** Newest `contextUsage` by event timestamp (ties: later line wins). The percentage must satisfy `Number.isFinite`; 0 to 100 is shown as is; above 100 and up to 105 is shown as "about 100 %"; above 105, negative or non-numeric is silent (L1). Event timestamps that are more than 5 minutes in the future are rejected.

#### Privacy and diagnostics (M2, M4)

- **Catch-all to fixed codes.** Every error path is caught and mapped to a fixed code from a closed list (`disabled`, `unsupported_platform`, `no_root`, `listing_capped`, `no_match`, `unsafe`, `changed`, `aborted`, `unsupported_schema`, `invalid_shape`, `no_candidate`, `out_of_range`, `stale`, `error`). The text of a thrown error (`err.message`, stack, errno path) is **never** logged, shown or put in a diagnostic. Diagnostics gain only these codes and counts; they never carry the model name, percentage, as-of time, title, workspace path or folder name.
- **Documentation text, in the style of "What is read, honestly".** [Privacy and storage](privacy-and-storage.md), the README privacy bullets and `SECURITY.md` currently say only Kiro's usage logs are read; they must state: "Cyclegauge parses the newest session's `session.json` whole in memory, including its title and workspace paths, and loads up to the last 256 KiB of the session's conversation file into memory, which can contain prompts and replies. It keeps only the model identifier, the context percentage and a timestamp, compares workspace paths only to find your open folder, and never stores, logs, shows or sends anything else." It must also name the macOS-only scope, the byte caps, the setting and its scope, and that the root is fixed.
- **Other documents.** [ARCHITECTURE.md](../ARCHITECTURE.md) line 29 ("explicit root override") must be reconciled: the discovery rule there applies to the usage readers; this reader has a fixed root with a test-only injected root. The same file gets the third trust boundary and the module split. [SPEC.md](../SPEC.md): advisory behaviour and labels. [Kiro data format](kiro-data-format.md): pointer to this proof with the observation date. [Usage guide](usage.md), CHANGELOG and [platform support](platform-support.md) (macOS only). The maintainer approval of this narrow runtime read is recorded in the roadmap or path-to-1.0 entry, not as blanket authorisation for session aggregation.

#### Notices and wording (WP11 thresholds, WP13 table; M1, M5, L4)

- **Gating.** Notify only if the observation's `asOf` is **after the extension started** and **within about 10 minutes** of now. Older sessions never produce a notice. All times are shown in the device's local time as "as of HH:MM".
- **At most one notice per tick (M5).** If several are eligible, show only the highest-priority one: the highest crossed context threshold first, then the model hint. A per-session rate limit applies in addition (suggest at most one notice per session per 30 minutes and at most three per session per run). The model hint shows once per model per session per run.
- **Thresholds (educated guesses, not evidence):** remind at **70 %** and again at **85 %** of the newest value; re-arm a threshold when the value falls below it minus 10 points (this also handles compaction and model switches). In-memory state only; it resets on restart; the key derived from the session folder name is never logged, shown or stored. Basis: the documented automatic compaction near the limit and the older 80 % summarisation point; observed fill reached only 23.9 %.
- **Fixed texts.**
  - 70 %: "Your most recent Kiro session in this workspace was about {P} % full as of {HH:MM}. Kiro may compact it soon; consider starting a new session for unrelated work."
  - 85 %: "Your most recent Kiro session in this workspace was about {P} % full as of {HH:MM}, close to its limit."
  - Model hint: "Your most recent Kiro session in this workspace is set to {Name} as of {HH:MM}. Kiro lists it at about {N}x the credits of Auto (Kiro model table, retrieved {date}); actual credits per task vary."
- **Table (L4).** Rows: identifier (regex `^[a-z0-9][a-z0-9._-]{0,39}$`), published name, multiplier as decimal text, source page, retrieval date, flag *observed* or *pattern-derived*. **Decision D2 (decided 2026-10-18): pattern-derived rows may show a hint.** Rows carry the flag *observed* (`claude-sonnet-4.5` 1.3, `minimax-m2.5` 0.25, `minimax-m2.1` 0.15), *documented* (`claude-opus-4.8`, `claude-sonnet-4.6`) or *pattern-derived* (all others); the GPT-5.6 rows are tiered (the listed factor is the base, higher above 272K tokens, so the hint says "from about") and Claude Sonnet 4.0, retired on 2026-10-14, is kept but silent. The hint shows only for a table multiplier above 1.0. A stale table (suggest older than 90 days) uses "check Kiro's current model table" instead of a number. A review step on each Kiro model release joins the pricing-catalog review in the release runbook.
- Never shown: raw identifier, session or workspace names, titles, paths, any number other than the rounded percentage and the table multiplier.

#### Decisions reserved for the maintainer

- **D1** Decided 2026-10-18: default on, with a release-notes entry.
- **D2** Decided 2026-10-18: pattern-derived table rows may show a hint.
- **D3** Decided 2026-10-18: no in-product notice; a walkthrough step instead (no new persisted key).

#### Phases

1. *Spec and approval record*: add the narrow approval and this design to path-to-1.0/ROADMAP; no code.
2. *Pure parsers and table* (no I/O): `session.json` projection, `contextUsage` line projection, strict timestamp parser, string workspace matcher, threshold/hysteresis state machine, notice arbiter, wording. Unit tests.
3. *Shared bounded reader* (generalising `read-ignore.ts`, audit tests unchanged) with filesystem safety tests, still without the editor API.
4. *Extension wiring*: timer, in-memory state, notifications, setting (application scope), fixed diagnostics codes; webview untouched.
5. *Docs* as listed; `security-reviewer` review of reader, boundary and docs (mandatory); native macOS acceptance in Kiro with an Auto session, a Sonnet 4.5 session and a model switch, a multi-root workspace, and the `workspacePaths` match on the real folder.

#### Synthetic-fixture test plan

All fixtures hand-written with `synthetic-*` identifiers, invented numbers and invented table rows (for example `synthetic-model-x` at 2.0); never derived from real files; the validator and `git diff --check` run for fixture changes.

- *Gating (H3):* disabled, non-macOS and remote-host cases make **zero** fs calls (fs-spy over all entry points); a workspace-scoped settings value cannot enable the feature.
- *Selection (H1):* future-dated `lastModifiedAt` rejected; `lastModifiedAt` far from the file mtime rejected; non-ISO or offset-less timestamp rejected; the newest session by mtime placed last in directory order is still chosen; more than N sessions open at most N `session.json` (spy count); the open workspace's session outside the N newest is silent; listing over 200 entries gives `listing_capped`; equal mtimes resolve deterministically; the `cli` folder is skipped; inactive (older than 12 hours) session silent.
- *Workspace match (M2, L2):* NFC versus NFD folder names, case differences, trailing separators, more than 8 or over-long `workspacePaths` entries, non-string entries; multi-root matching any folder; a spy proves no fs call happens during matching.
- *Session projection:* `modelId` `auto` / absent / listed / unlisted / over-long / uppercase / path-like / control characters / non-string; unsupported `schemaVersion` or `dataModelVersion`; oversized or invalid JSON.
- *Reader safety (H2, L3, L5):* symlinked file, symlinked ancestor, symlinked `.kiro`, a symlink escaping the root, FIFO or device file (open does not block), different device (injected), inode swap between `lstat` and `open`, size or mtime change between the before and after checks gives `changed`, ancestry changed after the read gives `changed`, abort mid-read closes the handle (spy) and yields silence, time budget exceeded yields silence, read-only guarantee (test fails if anything is created or modified under the fixture root).
- *Tail reader (M3):* file smaller than, exactly equal to and larger than 256 KiB; the byte before the window being `\n` keeps the first line and being another byte drops it; unterminated last line ignored; a line over 4 KiB skipped; a candidate containing a multi-byte character straddling the window start; no candidate in a large file gives `no_candidate` (not "too large"); a user event containing both literals is dropped by the shape check; a content line without the literals is never decoded (spy on the decoder); the read buffer is zero-filled after use.
- *Context value (L1):* out-of-order lines (newest by timestamp), duplicate timestamps, future event timestamp rejected, values 0, 100, 104, 105, 105.1, negative, NaN, Infinity, string.
- *State machine and arbiter (M1, M5):* 69, 70, 71 and 85 crossings fire once; hysteresis re-arm after an invented compaction drop (80 to 12) and an invented model-switch drop (16 to 3.5); a jump up at a model switch; restart resets; when a context threshold and a model hint are both eligible only one notice is shown; per-session rate limit; `asOf` before extension start or older than about 10 minutes is silent.
- *Hint decision (L4):* Auto, 1.0, 0.25 silent; an observed row with 1.3 shows "about 1.3x"; an invented observed row at 2.0 shows "about 2x"; a pattern-derived row may hint (D2) while a silent or tiered row follows its flag; stale table wording; unlisted silent; wording contains the table date and source and never the raw identifier.
- *Sentinels (M2, M4):* sentinel strings in `title`, `rootPaths`, `workspacePaths`, folder names, file names, `display`, content lines and in the message of an injected thrown error never appear in results, notices, diagnostics, logs or persisted output; diagnostics contain only the closed code list and counts and never the model name, percentage, as-of time or title.
- *Boundaries:* the reader module imports nothing from the editor API and nothing from Store/history; nothing is written to storage; a packaging check that no fixtures or Kiro-derived data are in the VSIX; the audit's existing `read-ignore` tests still pass after the shared-reader extraction.

## Implementation notes 2026-10-18: Windows and Linux

**Maintainer decision (2026-10-18).** The session hints are also enabled on Windows and Linux, not only on macOS. Nothing else about the approved read changes: same allowlisted fields, read-only handles, bounds, no persistence, local extension host only, Kiro only, setting `cyclegauge.sessionHints`. This is **not** approval for session aggregation or any other read.

**Evidence status.** Only macOS has observed evidence (this document). On Windows and Linux the session root and the format of `workspacePaths` are **unverified assumptions** (Unknown); the feature must fail closed silently with a fixed code when the layout differs, and native verification on both platforms remains open.

- **Gate** (`gate` in `src/session/hints.ts`): `darwin`, `win32` and `linux` pass; every other platform is `unsupported_platform`. A remote, WSL or SSH host, a disabled setting or a window without a `file:` folder stay closed on all three, with zero filesystem calls.
- **Root:** the fixed `<home>/.kiro/sessions` from `os.homedir()` on all three platforms (on Windows `%USERPROFILE%`); still no user-configurable root. A symlink anywhere on the way (home, `.kiro`, `sessions`, the workspace and session folders, the files) fails closed with `unsafe`. Node's `lstat` reports a Windows junction or symlink reparse point as a symbolic link, so the same check covers them (a test injects a junction as a symbolic link); other reparse point kinds are not detected specifically. A missing folder is `no_root`.
- **Workspace match** (`normalizePath` in `src/session/parse.ts`, pure string comparison, no filesystem call, platform passed from the extension, default `process.platform`):
  - macOS: Unicode NFC, case-insensitive, trailing `/` trimmed (unchanged).
  - Windows: NFC, case-insensitive, backslashes read as `/`, a leading `/` before a drive letter removed (`/c:/x` equals `c:/x`), trailing separators trimmed. Assumption: Kiro writes either `C:\...`, `C:/...` or `/c:/...` (the form of a `file:` URI path); UNC paths and 8.3 short names are compared as plain strings and may not match.
  - Linux: NFC, case-**sensitive**, trailing `/` trimmed.
  - No match on any platform is silent (`no_match`); there is never a fallback to the newest session overall.
- **Native-test items still open:** the actual session root and `workspacePaths` form on Windows and Linux, and whether Kiro on those platforms writes the same `session.json` and `messages.jsonl` fields.

## Summary

| Item | Data proof | Recommendation |
| --- | --- | --- |
| WP11 context reminder | IDE `contextUsage` per request, snapshot of the selected model's window (inference), newest-by-timestamp required; 5 of 71 adjacent pairs decrease (largest 12.4 points, mostly at model switches); highest fill 23.9 %; compaction and near-limit unobserved; CLI token counts zero | **Go for 0.13 in the combined feature** (advisory, 70 % and 85 % are guesses), else 1.1; `security-reviewer` mandatory; hardening criteria H1 to L5 in the combined design; maintainer decisions D1 to D3 decided 2026-10-18 (see the decision record) |
| WP13 model hint | IDE `session.json` `modelId` tracks the current selection (`auto`, `minimax-m2.5`, `claude-sonnet-4.5`; consistent identifier form); published Sonnet 4.5 is 1.3x (200K); no multiplier stored in the IDE; `reasoningModelId` unreliable; fallback unobserved; CLI has no non-Auto record | **Go for 0.13 in the combined feature** (IDE-only, macOS, table multiplier above 1.0 only), else 1.1; `security-reviewer` mandatory; hardening criteria H1 to L5 in the combined design; maintainer decisions D1 to D3 decided 2026-10-18 (see the decision record) |

Limits of this proof: one installation, short sessions, one session (with MiniMax, Auto and Sonnet 4.5 turns) as the only non-Auto evidence, no CLI non-Auto record, no near-limit fill, no fallback observed, `workspacePaths` matching untested, no running Kiro process, mixed unknown writer versions, macOS only, and the fact that local files are an undocumented implementation detail that Kiro can change without notice. Every reader must fail closed to "unavailable".
