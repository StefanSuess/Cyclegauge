# Evidence checks for WP10, WP11 and WP13

Retrieval date: **2026-10-18**. Method: public Kiro documentation only (kiro.dev pages and their `.md` renderings); queries contained no private values. No Kiro-owned local file, database, auth store or log was read and no Kiro command was run. This document decides nothing; it gives the maintainer evidence for the go/no-go calls in [path to 1.0](path-to-1.0.md).

Labels: **Documented** (stated on a cited public page), **Inference** (reasoned from documentation or from earlier dated repo findings, not verified), **Unknown** (no public source found). Page dates are the "Page updated" stamps shown on the pages, where present. The documentation is versioned (IDE 1.x, CLI V3, older 0.x/V1/V2) and changes often; any implementation must re-check it.

Sources:

- S1 Steering: <https://kiro.dev/docs/steering/> (updated 2026-10-06)
- S2 Hooks: <https://kiro.dev/docs/hooks/> (updated 2026-10-10)
- S3 Hook types: <https://kiro.dev/docs/hooks/types/> (updated 2026-10-10)
- S4 Hook actions: <https://kiro.dev/docs/hooks/actions/> (updated 2026-10-10)
- S5 IDE 1.0 Hooks: <https://kiro.dev/docs/ide/whats-new-v1/hooks.md>
- S6 Configuration paths: <https://kiro.dev/docs/configuration.md>
- S7 Models: <https://kiro.dev/docs/models/> (updated 2026-10-17)
- S8 Available models: <https://kiro.dev/docs/models/available-models.md>
- S9 Effort: <https://kiro.dev/docs/models/effort.md>
- S10 CLI settings: <https://kiro.dev/docs/reference/settings.md>
- S11 Compaction: <https://kiro.dev/docs/compaction.md>
- S12 CLI context: <https://kiro.dev/docs/cli/chat/context.md>
- S13 IDE chat export: <https://kiro.dev/docs/ide/chat/chat-export.md>
- S14 CLI sessions: <https://kiro.dev/docs/cli/chat/session-management.md>
- S15 Pricing: <https://kiro.dev/pricing/>
- Repo: [Kiro data format](kiro-data-format.md) (local observation of 2026-10-08, IDE 1.2.37, macOS).

## WP10 Hook and Steering review

### Steering (S1, S6)

Documented:

- Locations: workspace `.kiro/steering/`, global `~/.kiro/steering/`; workspace wins on conflict. Files are Markdown. Foundation files are `product.md`, `tech.md` and `structure.md`, "included in every interaction by default".
- Inclusion mode is set by YAML front matter that must be the first content of the file, enclosed by `---`. Key `inclusion`, values:
  - `always` (default when absent): loaded into every interaction.
  - `fileMatch`: key `fileMatchPattern`, a glob string or an array of glob strings, for example `"components/**/*.tsx"`.
  - `manual`: included on demand through `#name` in chat or a `/` slash command.
  - `auto`: keys `name` and `description` (both required); included when the request matches the description. CLI V3 supports all four modes; CLI V1/V2 only auto-load `always`.
- `AGENTS.md`: picked up from the workspace root, from subdirectories of the workspace, and from `~/.kiro/steering/`. It "does not support inclusion modes and is always included"; no front matter applies.
- File references inside Steering: `#[[file:<path>]]`, with an optional line or line range, and `#[[folder:<path>]]` (one-level listing). Relative paths resolve from the workspace root (workspace Steering), `~/.kiro/steering/` (global) or the AGENTS.md folder. They follow the session's file-read permissions and ignore rules. Referenced files add to the context size.
- Custom agents do not load Steering automatically; they must list it under `resources`, for example `file://.kiro/steering/**/*.md`.
- Steering can also come from cloud configuration (Configuration Sync) and, in CLI V3, can be applied to local sessions. This is not a local file.

Unknown (no public source found): any maximum file size, file count or token limit for Steering or AGENTS.md; truncation behaviour; whether files in nested `.kiro/steering/` subfolders are read by the IDE (the agent glob in S1 uses `**`, the workspace rule only says "under `.kiro/steering/`"); the exact precedence of several matching AGENTS.md files; behaviour of malformed front matter (unknown value, tab indentation, BOM).

### Hooks (S2 to S5, S6)

Documented:

- Location: workspace `.kiro/hooks/<name>.json` (any `.json` name); CLI V3 additionally loads `~/.kiro/hooks/`. Workspace and global Hooks run together. The format was introduced in IDE 1.0 / CLI V3 and replaced the IDE 0.x `.kiro.hook` files (S5); the 0.x file location and schema are not described on the pages retrieved (Unknown).
- Schema `version: "v1"` with `hooks[]`. Per hook: `name` (required), `description`, `trigger` (required, PascalCase), `matcher` (optional), `action.type` `command` or `agent`, `action.command` or `action.prompt`, `timeout` (seconds, default 60, command only), `enabled` (default true), `confirm` (Stop command hooks only; may contain a `confirmCommand`).
- Triggers (S3 list): Prompt Submit, Agent Stop, Session Start, Agent Spawn (alias), Session End (CLI V3), Pre Tool Use, Post Tool Use, File Create, File Save, File Delete, Pre Task Execution, Post Task Execution, Manual. Config names in S2/S5 include `PostFileSave`, `PostFileCreate`, `PostFileDelete`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `PreTaskExec`, `PostTaskExec`.
- Matcher: for file events a regex against the file path; for tool events a tool ID, category (`read`, `write`, `shell`, `web`, `spec`), source selector (`@mcp`, `@powers`, `@builtin`, `@<server>`, `@<server>/<tool>`), a regex, or in JSON a wildcard (`*`, `?`); an empty or absent matcher matches everything. Prompt Submit matches prompt text (S5).
- File triggers fire only for changes made by the agent, not by manual editing (S3).
- Agent prompt actions "consume credits" because each starts a new agent loop; shell command actions do not (S4). This is the documented basis for flagging agent-prompt hooks on frequent triggers.
- Multiple hooks per file are allowed.

Inconsistencies in the documentation itself (Unknown which is current): S3 says a non-zero exit blocks Pre Tool Use and Prompt Submit; S5 says only exit code 2 blocks. Trigger display names differ from the JSON names between pages. A reader must therefore accept unknown triggers and report them as "not recognised", not as errors.

Unknown: maximum hook count, maximum prompt or command length, JSON size limits, whether IDE and CLI treat a malformed file identically.

### What Cyclegauge would need to read (Inference)

For the review described in path-to-1.0 (size, inclusion mode, trigger, matcher, prompt size), only the following is needed:

1. Steering: byte size and the front matter block (first lines up to the closing `---`) of each file. The Markdown body is not needed beyond its length; a length-only read (stat size) suffices for the "large always-included file" finding. `#[[file:...]]` references are needed only if the review wants to count them, which is optional and should be left out of a first version.
2. AGENTS.md: byte size and existence only (always included, no front matter).
3. Hooks: parsed JSON fields `version`, `hooks[].name`, `trigger`, `matcher`, `enabled`, `action.type`, and the length (not the text) of `action.prompt` and `action.command`. The prompt and command text themselves must not be read into any output.

The front matter is configuration text, but a body may contain secrets or private text. Reading the body would be a content read; stat size avoids it.

### Proposed minimal read allowlist and limits (Inference, for the design to decide)

| Item | Proposal |
| --- | --- |
| Roots | Open workspace root only: `<root>/.kiro/steering/*.md`, `<root>/AGENTS.md`, `<root>/.kiro/hooks/*.json`. Global `~/.kiro/...` and nested `AGENTS.md` excluded from the first version (stated as "not checked"). |
| Traversal | Non-recursive directory listing of the two `.kiro` folders; no globbing across the tree; reject symlinks and any resolved path outside the root; no `.kiro.hook` legacy files. |
| Counts | At most 100 files per folder; further files are counted, reported as "not checked". |
| Steering read | `stat` size for every file; read at most the first 2 KiB of a file to parse front matter; never the body. |
| Hook read | Read at most 64 KiB per file (larger: counted as "too large", not parsed); strict JSON parse; keep only allowlisted fields; drop `description`, command text, prompt text, `confirm` content. |
| Findings output | Counts, category codes and sizes, plus a file's display name only if the maintainer approves showing workspace-relative names (otherwise ordinal numbers). No absolute paths, no text. |
| Safety | Read-only handles; no execution of hooks or commands; no Kiro command; never write a suggestion into `.kiro`; suggestions are a preview only. |

These numbers are proposals; none comes from Kiro documentation, which gives no limits.

### Open questions for design and approval

1. Explicit maintainer approval for reading Kiro configuration text (AGENTS.md "content read" boundary): is stat-size plus a 2 KiB front-matter read acceptable, and are Hook JSON fields acceptable?
2. Are workspace-relative file names displayable, or only counts and ordinals? Hook `name` values are user text.
3. Thresholds: what size counts as "large always-included" Steering, and what sums across always-included files (Unknown: Kiro's own context budget)? The credit effect of Steering size is not documented; a finding must say "adds to context on every interaction", not "costs X credits".
4. Which trigger and matcher combinations count as "broad" (empty matcher, `.*`, `**`, overlap)? Needs a defined, tested rule set against the documented matcher grammar (regex versus glob differences).
5. Surface scope: IDE 1.x format only, or also CLI V3 global hooks? Legacy 0.x `.kiro.hook` unsupported.
6. Handling of documentation inconsistencies (blocking exit code, trigger names) and future schema versions (`version` other than `v1`: report unknown, do not guess).
7. Multi-root workspaces (a documentation page exists at kiro.dev/docs/ide/editor/multi-root-workspaces): which root.
8. Mandatory `security-reviewer`, per path-to-1.0.

### WP10 recommendation: **needs-approval** (go for design)

The formats are documented well enough to design against; no blocker found. Implementation must wait for the design, the explicit content-read approval and `security-reviewer`. The absence of any documented size limit means thresholds will be Cyclegauge heuristics and must be labelled as such.

## WP11 Context/message reminder

Documented:

- Kiro shows a "context usage meter" in the chat panel on every surface (IDE, CLI, Web, Mobile); compaction triggers automatically as context approaches the limit and the meter "resets" (S11). IDE 1.x has no manual compaction; the CLI has `/compact`. The IDE 0.x "Summarization" fired at about 80% context.
- CLI: `/context show` prints the percentage (S12); the CLI percentage is "only calculated when you send your next message", because the backend counts tokens. After compaction, older messages are replaced by a summary, so message counts and context fill are not monotonic.
- The IDE chat export (right-click, Export Chat) is documented to produce `session.json` (agent name, model, timestamps "and other session details") and `messages.jsonl` (the full conversation) (S13). That is a user-triggered export of conversation content, not a documented live local data contract. CLI sessions are stored in a local database under `~/.kiro/` (S14).
- Repo finding, not new: [Kiro data format](kiro-data-format.md) records, from a local observation of 2026-10-08 (IDE 1.2.37), that session metadata includes "request counts, model, durations, token counts, context percentages, and message references". The semantics (cumulative or per turn, effect of compaction, per-session or account-wide) were not established.

Unknown: whether any public page documents the live `~/.kiro/sessions/...` files, their field names or stability; whether a context percentage field is written at all in released versions or whether it only exists in memory; whether a message count survives compaction; whether fields are additive or cumulative.

Conclusion (Inference): a proof is **not** possible from documentation and synthetic fixtures alone. A synthetic fixture only encodes the assumption it is meant to prove. AGENTS.md requires evidence of additive versus cumulative semantics beyond "a field name or single sample", and Kiro offers no contract. A real proof needs repeated, version-pinned observation of real session metadata, which is session-data access requiring separate maintainer approval, and it would still be an observation about specific versions, not a contract. Product value is also doubtful: Kiro already shows a context meter in every surface and compacts automatically, so the reminder would duplicate it unless it reads the same internal value.

### WP11 recommendation: **no-go for 0.13; move to 1.1** by documented decision

Re-open only if Kiro documents a local, versioned field for message count or context fill with its semantics, or the maintainer approves a bounded metadata-only observation study.

## WP13 Model choice hint

### Is the selected model readable from a documented editor setting? (S7, S9, S10, S13)

Documented:

- IDE: the model is chosen with the model dropdown / Model panel in the chat input bar; the selection "applies to all subsequent messages in the conversation" (S7, S9). No IDE settings key or file for the selected model is documented in the pages retrieved. The effort level is also chosen in the panel.
- CLI: `chat.defaultModel` (string, default model) and `chat.modelDefaults` (per-model parameters such as effort) in `~/.kiro/settings/cli.json`, with a workspace override in `.kiro/settings/cli.json` (S10). `--model` and `/model` apply to the current session and are not saved unless set as default. This is a default, not the model of the running conversation, and it is CLI, not the IDE that Cyclegauge extends.
- Web: the choice applies to the current session only (S9).
- Exported `session.json` lists a model (S13), but that is a manual export of conversation data, not a setting.
- Auto routes each task to a model automatically (S7), so the "selected" model can differ from the model that served a request; the docs also describe model fallback within a session (S7). The selected model may therefore be only an upper-level label.

Unknown: any documented IDE setting that stores the current model; whether the IDE writes the selection to a stable, documented file.

### Published per-model credit multipliers (S7, S8, S15)

Documented: Yes. S7 publishes a table of "Cost" per model, "relative to Auto (1.0x baseline)", for example Claude Haiku 4.5 0.4x, Claude Sonnet 5.5 1.3x, Claude Opus 5.5 2.0x, Claude Opus 5 2.2x, Qwen3 Coder Next 0.05x (S7, retrieved 2026-10-18). S8 repeats multipliers per model. Caveats stated by Kiro:

- GPT-5.6 tiers use two-tier context pricing: the listed rate applies up to 272K tokens and doubles above.
- Models with the same multiplier "won't necessarily consume the same number of credits per task"; tokenizer, output length and thinking depth differ. Higher reasoning effort uses more credits at the same multiplier (S7, S9).
- The table changes with each model release (page updated 2026-10-17); some models are Enterprise-preview or region-limited; availability depends on plan.
- The pricing page (S15) says only that "different models consume credits at different rates" and does not repeat the table.

### Assessment (Inference)

The multipliers are documented and citable with date. The first condition of the roadmap ("selected model can be read from a documented editor setting") is **not met** for the IDE: the selection lives in the chat UI, with no documented setting. The only documented setting is the CLI default, which is not the active choice and sits in a Kiro-owned file (`~/.kiro/settings/cli.json`) that Cyclegauge does not read today; reading it would be a new Kiro-owned read needing approval, and a mistaken hint (for example Auto or fallback) would be misleading. A hint based on a user-entered model (Cyclegauge setting) is possible without reading Kiro, but is a different feature than the approved wording and would need its own approval; the multiplier table would need maintenance with each Kiro model release.

### WP13 recommendation: **no-go for 0.13; move to 1.1** by documented decision

Multipliers: documented. Setting: not documented for the IDE. Both conditions of path-to-1.0 are required. Revisit if Kiro documents the IDE model setting, or the maintainer approves a user-entered "usual model" setting with a dated multiplier table.

## Summary

| Item | Evidence | Recommendation |
| --- | --- | --- |
| WP10 Hook and Steering review | Formats and locations documented; no size limits documented; discrepancies on blocking and trigger names | **Needs approval:** proceed to design plus explicit content-read approval and `security-reviewer`; implementation not yet |
| WP11 Context/message reminder | No public local-data contract; semantics unknown; compaction breaks monotonic counts; Kiro already shows a meter | **No-go for 0.13, move to 1.1** |
| WP13 Model choice hint | Multipliers published; IDE model setting not documented | **No-go for 0.13, move to 1.1** |
