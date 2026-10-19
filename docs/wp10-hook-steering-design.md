# WP10 Hook and Steering review: design

Status: **approved by the maintainer on 2026-10-18 for questions 1 to 9; security-reviewed including the automatic mode (sections 4.1, 11 and phase 10d); questions 10 and 11 are approved by the maintainer on 2026-10-18.** On 2026-10-18 the maintainer approved the direction: Cyclegauge may read Kiro configuration text in the workspace for this feature (bounded `.kiro/steering/*.md`, `AGENTS.md`, Hook definitions). Where Kiro's documentation gives recommendations or limits for Steering and Hooks they are adopted; where it gives none, Cyclegauge proposes thresholds labelled as **Cyclegauge heuristics**. The maintainer answered the section 15 questions on 2026-10-18 (recorded there); each phase in section 13 still gets its own `security-reviewer` review before its PR. Scope comes from the WP10 paragraph of [path to 1.0](path-to-1.0.md); evidence and the first read-allowlist proposal come from [wp10-13-evidence](wp10-13-evidence.md). Kiro documentation was re-read on 2026-10-18 (pages in section 2); it changes often, so the rule table in section 7 carries a re-check date.

> **Update 2026-10-18 (maintainer decision, "Steering review with the audit").** A manual workspace audit (every user-initiated run: the command, the Audit view's title **Check** button, the dashboard card's Check now link, Run audit in the reminder, `cyclegauge.audit.show` when there is no result yet) unless the user dismisses the multi-root folder picker or cancels the audit (it still starts after an audit failure or refusal) now also runs this review, exactly as `cyclegauge.reviewKiroConfig` would (same guards, same bounded reads, manual-run semantics). The review has no title button and no tree entry of its own any more (later update below); the command stays in the Command Palette. This supersedes "separate from the audit" for manual runs only: silent audit re-runs (reminder-driven, watcher, ignore-file re-check) never start it, `cyclegauge.configReviewAutomatically` remains the only automatic trigger, a failure or refusal of one never hides the other's result, and nothing new is read beyond the allowlist in this document.

> **Update 2026-10-18 (maintainer decision, "Apply Steering and Hooks suggestions").** Section 9 and the "Later option" in question 6 are superseded: the previews described below are replaced by **apply actions that prepare an unsaved edit in the real file** (Load only when needed, Narrow the pattern, Run only manually, Disable, Open file), exactly like the workspace audit's **Exclude from Kiro**. Cyclegauge still never writes: it opens the document and applies one minimal `WorkspaceEdit` that the user reviews and saves; with auto save on, or an unsaved document, it prepares nothing. The edit is computed from the bytes the review may already read (the 2 KiB Steering prefix, the 64 KiB Hook JSON) and only after the file is proven unchanged since the review (size, modification time and a SHA-256 digest of the bytes read, re-checked after the editor loaded the file). If the exact range cannot be determined (duplicate or escaped keys, unusual formatting) the file is opened without an edit and a fixed message says so. No new file is read, nothing new is kept (per-file size, time and digest only, in memory with the review) and nothing is persisted. A read-only **Show suggestion** (section 9 wording) remains only for findings that span several files or hooks (S3, H5). See the ROADMAP paragraph "Apply Steering and Hooks suggestions".

> **Update 2026-10-18 (maintainer decision, "Audit view grouped by action").** The Audit view shows the review's findings in groups by what Cyclegauge suggests doing, together with the filename audit: **Load only when needed** (S1), **Run only manually** (H1-H4) and **Worth a look** (S2, S3, S4, H5; no automatic change), after **Exclude from Kiro** and a status line. The group's check mark and each item's check mark are **Review changes…**: one `WorkspaceEdit` for the item or the whole group, each change annotated (label, why and alternatives, `needsConfirmation`) so the editor shows its native change preview (diff, checkbox per change, Apply/Discard). Cyclegauge never saves; it shows "Changes prepared in M files — review and save." afterwards. **Disable** is in a hook's context menu (same preview), **Narrow the pattern** still only selects the value, and a group skips and counts items whose guard fails. Every guard above is unchanged and nothing new is read, kept or persisted. See the ROADMAP paragraph "Audit view grouped by action".

> **Update 2026-10-20 (proposed to and accepted by the maintainer after native testing, "Audit view follow-up").** Saving a Steering or Hook file that Cyclegauge prepared an edit in starts one manual-equivalent review (approved 2026-10-20): the same guards, reads, allowlist and limits as the manual command, only for a trusted workspace and a checked local root, single-flight (a save during a running review is answered by exactly one more review when it finishes), not counted toward the automatic cap, without moving focus and without the one-time offer. No other save starts it, and no watcher is added. Cyclegauge keeps the paths of the files it prepared an edit in (from the last successful editor edit, at most 500), in memory only, until the file is saved, closed or reverted; they are never stored, shown, logged or sent, and this adds no read. Items whose file holds such an unsaved prepared edit read "prepared — save the file to apply", and the status line counts the files. Nothing else in this design changes.

## 1. Purpose and user-visible value

**Direction.** Cyclegauge should become more of an advisor than a gauge: it notices things for the user and explains them. Every finding is therefore written advisor-style: **what** was found, **why** it matters (with the documented-or-heuristic basis), and a concrete **next step** (a reviewable preview or a plain-language action). Further advisor features are separate work packages and are not part of WP10; this design does not approve them.

Kiro loads Steering into every interaction and can start agent work from Hooks. Both are easy to over-use and invisible once set up. The review turns two folders of configuration into a short list of concrete findings, each with a plain-language reason and a preview of a narrower setting.

Example findings (wording is a draft; see section 8). Hook names are shown only in the sidebar label (section 8.1):

- **Steering, always included.** `.kiro/steering/architecture.md` · 26.4 KiB. "Kiro adds this file to every interaction (Kiro documents this). Large always-included files make each request's context bigger. Load it only when needed: preview a manual-inclusion setting." Basis line: "Behavior documented by Kiro; the 24 KiB threshold is a Cyclegauge heuristic."
- **AGENTS.md.** `AGENTS.md` · 31.0 KiB. "Kiro always includes AGENTS.md and it has no inclusion modes (Kiro documents this). Moving detailed sections into Steering files that load only for matching files keeps it small."
- **Hook, agent work on every agent file save.** `lint-review.json` · hook "Review changes". "This hook sends a prompt to the agent after every file the agent saves. Agent prompt actions use credits because each starts a new agent loop (Kiro documents this). A command action does not use credits; a narrower matcher runs it less often."
- **Hooks that overlap.** "2 hooks on File Save have no matcher and both start agent work for the same event."
- **Steering that is effectively always included.** "`fileMatch` pattern matches every file, so it loads like an always-included file."
- **Not checked.** "3 hook files could not be checked: unknown schema version." Gaps are never read as "fine".

Credit impact is **qualitative only** (section 8.3). The review never shows an estimated credit figure.

## 2. Evidence base (re-checked 2026-10-18)

Pages: Steering (`kiro.dev/docs/steering`), Hooks, Hook types, Hook actions, Hook best practices, Hook management, Hook troubleshooting, Multi-root workspaces, IDE 0.x reference. No public page states a maximum or recommended **size, count or token budget** for Steering, AGENTS.md or Hooks.

Kiro **recommendations adopted** (Documented):

- Steering: "Keep Files Focused" (one domain per file); `fileMatch`, `manual` and `auto` exist to keep context relevant and avoid "overwhelming always-on steering"; never put secrets in Steering.
- Hooks: use specific file patterns instead of "broad patterns that match everything"; use specific tool matchers instead of `*`; keep agent prompts concise; prefer shell command actions for deterministic tasks because they are faster and "don't consume credits"; remove hooks that are no longer needed.

Additional documented facts the rules use: agent prompt actions consume credits because they start a new agent loop; file triggers respond only to changes made by the agent; an absent or empty matcher matches everything; `Stop` hooks do not use matchers; the Prompt Submit prompt is appended to the user prompt; multi-root workspaces read `.kiro` under each root, always-included Steering applies regardless of the active root, conditional Steering only for its own root.

## 3. Non-goals

- No execution of hooks or commands, no Kiro command, no Kiro-owned files. Global `~/.kiro/steering` and `~/.kiro/hooks` are **not read** (stated in the view as not checked).
- No Steering body content (see the prefix rule in section 5), no hook prompt or command text kept, displayed or stored. No `#[[file:...]]` reference resolution.
- No estimated credits, no content-quality or redundancy analysis, no session or usage analysis.
- No writing: nothing is written into `.kiro` or anywhere; previews only (section 9). The only write the feature may cause is the user's own `cyclegauge.configReviewAutomatically` setting, and only when the user clicks "Turn on" (section 4.1).
- No automatic reads outside the allowlist of section 5, and no automatic mode that is on without the user's choice.
- No new runtime dependency (no YAML or glob library), no network.
- Nested `AGENTS.md` files, legacy `.kiro.hook` files, custom agent `resources` and cloud configuration: not checked.

## 4. Trigger, consent and trust

- **Own explicit command**, not part of the filename-only audit: `cyclegauge.reviewKiroConfig` ("Cyclegauge: Review Kiro Steering and Hooks"), also offered as a node in the existing Audit view. A new contributed command needs maintainer approval (question 2 in section 15).
- **Manual by default; automatic only as an opt-in setting** (section 4.1). The existing silent audit, its reminder and its file watcher **never** run this review: they keep the promise "does not read other file contents". The review has its own setting, its own scheduler and its own watcher.
- **Workspace trust required.** `vscode.workspace.isTrusted` false: nothing is read; the view says "Not checked: workspace is not trusted". Only `file:` folders.
- **Same folder guards as the audit.** Each root goes through the existing `folderCheck` / `refusal()` (filesystem root, home folder, Kiro data, Cyclegauge storage, broad roots). A refused root is "not checked" with the existing fixed reason.
- **Multi-root: all trusted `file:` roots, deduplicated by real path, at most 8.** Kiro reads `.kiro` under each root (documented) and always-included Steering applies in all roots, so the always-included total is summed across checked roots; that cross-root sum is labelled **inference** (precedence and de-duplication across roots are not documented). Each root passes its own `folderCheck`; two spellings of the same real folder count once. The audit picks one root; this review differs on purpose. Roots beyond 8 are counted as not checked. Findings carry the root's folder name (escaped), as the audit header does.

### 4.1 Automatic mode (opt-in, off by default)

Maintainer direction (2026-10-18): automate as much as possible. The review mirrors the audit's automatic modes. State is in memory, apart from the approved boolean key for the enable offer (question 11).

- **Setting** `cyclegauge.configReviewAutomatically`: `off` | `onOpen` | `onOpenAndChanges`. Default **`off`**, application scope (read without a folder, so only the user's own settings count and a cloned repository's `.vscode/settings.json` can never turn it on). **An unknown or malformed value counts as `off`.** The name and values follow `cyclegauge.auditAutomatically`; `manual` in place of `off` was rejected as a second vocabulary. Default `off` follows the audit's convention and the fact that this is the first feature that parses file contents. Making `onOpen` the default needs a separate approval after a native macOS check (question 10). The new setting is approved by the maintainer (question 10).
- **Its own guards, not the audit's.** The review has its **own in-flight guard**, its own timers and its own watcher. It does not share the audit's `running` flag or `reminderAbort`: both are bounded, so an audit and a review may run side by side. The automatic open run uses its **own staggered delay constant**, `CONFIG_REVIEW_DELAY_MS` = 45 s (the audit reminder's `REMINDER_DELAY_MS` is 30 s), so the two do not start together.
- **`onOpen`:** one run per window after that delay, only when the workspace is trusted and each root passes its own `folderCheck`. Without a "last reviewed" date there is no one-day age rule: "once per window" is the rule.
- **`onOpenAndChanges`:** as `onOpen`, plus a re-run when an allowlisted file changes (below).
- **Phase 10d decisions (recorded 2026-10-18, security-reviewed).** An automatic run reviews the roots that pass their own `folderCheck` at fire time and lists refused roots as not checked (status partial), as the watcher bullet does; it does not skip the whole run. Changes seen while the open run is still pending are covered by that run. A manual run before the open run replaces it for the window. A result that is discarded (setting off, trust or root change) does not count as the window's open run but counts toward the 20-run cap. If a root's guard answer changes without a folder event, the next watch run reads nothing and rebuilds the watchers.
- **Narrow watcher.** One `createFileSystemWatcher` per root that passes its own `folderCheck` (at most 8; a root that fails is skipped with `root_refused` and the others are still watched) with `RelativePattern(root, '{AGENTS.md,.kiro/steering/*.md,.kiro/hooks/*.json}')`, subscribed to create, change and delete (a size change matters, unlike the audit's create-only watcher).
  - The handler makes **no filesystem call** and keeps **no path**. It checks that the event URI is a `file:` URI whose root-relative path has exactly one of the three allowlisted shapes (no deeper nesting, no `..`), and sets a "dirty" flag. On macOS and Windows the shape check is case-insensitive, matching the reader's case-insensitive `.md` rule. The glob itself stays literal; a file whose letter case differs (`agents.md`, `X.MD`) may not raise an event and is picked up by the next open or manual run (documented limitation).
  - Dirty flags are keyed by **watcher generation and real root**. Every rebuild of the watchers (setting, folders or trust change) increments the generation; events from a disposed watcher, or for another generation or root, are ignored.
  - Created only in `onOpenAndChanges`, in a trusted workspace; disposed and rebuilt like the audit's `syncWatcher`.
  - Residual risk: workspace `files.watcherExclude`, editor watcher limits and network drives can suppress events. The view therefore never claims freshness: its header shows the **relative age** of the check ("checked 3 h ago") and the manual command stays available.
- **Debounce, single-flight, minimum interval, cap.**
  - Trailing debounce 5 s, forced after 60 s of continuous events (the audit's `WATCH_DELAY_MS` and `WATCH_MAX_WAIT_MS`).
  - One review at a time (the review's own guard). A trigger during a run coalesces into one follow-up.
  - **Minimum interval of 30 s** between the end of one automatic run and the start of the next.
  - **At most 20 automatic runs per window.** Then automatic mode pauses for the window; the header says "automatic review paused (many changes)". Manual runs do not count toward the cap and keep working.
- **Re-validation when a run fires.** The debounce and forced timers re-read the setting, workspace trust and `folderCheck` of each root at fire time; a changed answer cancels the run before any read. On setting `off`, trust loss or a root change, all debounce and forced timers are cleared and an **in-flight automatic run is aborted and its result discarded** (never rendered).
- **Manual run wins.** A manual command **aborts or waits for** an automatic run, then runs as a normal manual run, **does not count toward the 20-run cap**, and clears the dirty flags.
- **Same bounds as a manual run:** the section 5 allowlist and limits, the 3 s budget and abort signal. An automatic run reads nothing a manual run could not read. One **per-run byte budget of 3.6 MiB** applies across all roots and covers hook files and Steering prefixes together (about 2 MiB of hook JSON plus 8 roots x 100 files x 2 KiB of prefixes); exhausting it gives `limit_bytes`. Worst case is 20 runs, about 72 MiB read per window.
- **Own refresh path.** Results reach the view through the review's own refresh of its own tree section. The review never calls the audit's `render()`, `onFinding` or the code path that sets `support.valueSeen`, so an automatic review cannot affect the support-prompt schedule or the dashboard's Workspace card.
- **Silent unless there is news.** No progress notification, no focus change, no modal. The first automatic run of a window **updates the view only**. Failures and "not checked" results are shown in the view only.
- **Notification only for a class not yet seen (in memory, exact rules).**
  - A *class* is a finding id (S1, S2, S3, S4, H1, H2, H4, H5; H3 is information and never notifies), not an instance.
  - The window keeps an in-memory `seen` set of classes. The first automatic run puts its classes into `seen` without any message. A **manual run also adds its classes to `seen`**, because the user was shown them.
  - After a later, watcher-triggered run, if the result has a class not in `seen`, **one** non-modal message is shown with a **Show** button: "Cyclegauge found things to review in your Kiro Steering and Hooks." (fixed text; no counts, file names or hook names). Only then are the announced classes added to `seen`.
  - Limits: at most one message per run, 3 per window, and not within 60 s of the previous one. A class **held back by those limits stays out of `seen`**, so a later run announces it. A class that disappears and returns is not announced again once in `seen`.
  - In `onOpen` (no watcher) there is no message at all: the view is updated. This differs from the audit's automatic open message on purpose, because a content-reading feature that the user opted into should not speak unprompted on every open.
  - Instances new to a class already in `seen` are only marked "new this session" in the view. All state is lost on reload; remembering classes across windows would need a new key and separate approval.
- **Enable offer.** After the user's **manual** run, a non-modal message may be offered: "Check Kiro Steering and Hooks automatically in trusted workspaces you open, and when those files change?" with **Turn on** and **Not now**. The wording says what the choice means: it is a **global (user) setting**, not a choice for this workspace.
  - **Turn on** writes `cyclegauge.configReviewAutomatically = onOpenAndChanges` with `ConfigurationTarget.Global` only. "Already set" is detected with `inspect('configReviewAutomatically')?.globalValue` only, never with `get()` or the workspace value (which a repository could set); any defined global value, including `off`, means the user has decided and the offer is not shown.
  - It is not shown when `cyclegauge.supportPrompts` is off. `supportPrompts` already governs Cyclegauge's occasional asks, so its description is extended to say it also covers feature offers (a `package.json` text change in phase 10d). The offer is not shown while a support prompt is open or within 60 s of one, so the two never appear in the same run.
  - **Approved: one boolean `globalState` key `cyclegauge.configReview.offered.v1`, set when the offer is shown or dismissed, so it appears once ever** (no data, not in Settings Sync, cleared by the existing reset command). **This key is approved by the maintainer (question 11).**
- **Does not touch audit state.** The scheduler reads neither the audit's reminder keys nor its snooze or "never remind" flags and writes none of them.

## 5. Read allowlist and limits

Per checked root, exactly these entries; nothing else is opened or listed:

| Item | Operation | Limits |
| --- | --- | --- |
| `<root>/.kiro/steering/` | Non-recursive listing with `opendir`, iterating; names ending `.md` (case-insensitive) are candidates | Iteration stops at **501** entries and the directory handle is always closed; more than 500: folder `too_many_entries`, not checked. The bounded list is sorted by name; at most 100 candidates are examined, the rest are counted. The listing is wrapped in the walker's `intact` check (device and inode of the directory unchanged before and after). |
| each steering candidate | `lstat` size always; then a **prefix read**: the first 5 bytes; only if they are `---\n` or `---\r\n` does the read continue, to at most 2 KiB | Regular file only. A file that does not start with a front-matter opener has mode `always` and **nothing more is read**. Wording: "the first few bytes, and up to 2 KiB only when the file starts with a front-matter block". Bytes after the closing `---` line are never decoded. |
| `<root>/AGENTS.md` | `lstat` size only; **no content read** | Regular file only. A symlinked `AGENTS.md` is not followed (code `link_not_followed`); the S3 total is then a lower bound. |
| `<root>/.kiro/hooks/` | Same bounded `opendir` listing; names ending `.json` | Same 501/500 and 100 limits. |
| each hook file | Whole-file read, strict `JSON.parse` | At most **64 KiB** per file (larger: `file_too_large`, not parsed); at most one **3.6 MiB byte budget per run across all roots**, counting hook files and Steering prefixes together (then `limit_bytes`, remaining files not checked); at most 200 hook entries per file (rest counted). A file with `nlink !== 1` is refused (`file_unsafe`), because a hard link may point outside the folder. Invalid UTF-8 or a BOM: `json_invalid`. |

Run limits: 3 s time budget, `AbortSignal` honoured, a yield to the event loop between files, one review at a time (the review's own in-flight guard; the audit has its own and the two are independent). The numbers are proposals; Kiro documents none.

**Absent versus failed.** Only `ENOENT` means "absent" (nothing to review there). Any other error on `.kiro`, `.kiro/steering`, `.kiro/hooks`, `AGENTS.md` or a file becomes `folder_unreadable` or `file_unreadable`, never "absent". Each ancestor is tested separately.

Shared reader (phase 10a). `read-ignore.ts` keeps its public `readIgnoreFile` as a **thin wrapper whose behavior is byte-identical**; the mechanics move into

`readBounded(root, rel, { maxBytes, mode: 'whole' | 'prefix', allow })` → raw bytes or a fixed code

where `allow` is a mandatory gate (the existing `relOk` plus an exact path-shape check such as `.kiro/steering/<name>.md`) that the helper itself enforces before any `lstat` or `open`. `whole` fails with `oversized` above `maxBytes`; `prefix` reads at most `maxBytes` and never fails on size. The helper returns **bytes only**; it does no decoding and no BOM handling. The caller decodes: the ignore wrapper keeps its fatal UTF-8 decode and BOM strip exactly; the Steering parser decodes only the bytes up to the closing `---` line; the hook parser treats a BOM or invalid UTF-8 as `json_invalid`. Regression tests pin the wrapper to today's codes (`not_allowed`, `unsafe`, `oversized`, `unreadable`) and to BOM and invalid-UTF-8 handling.

Safety rules (same primitives as `read-ignore.ts`):

- The root and every ancestor (`.kiro`, `.kiro/steering`, `.kiro/hooks`) must be real directories (not symlinks) on the root's device; checked before and after the read.
- Files: `lstat` must say regular file, not symlink; opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; the handle's `fstat` must be a regular file with the same device and inode; reads are bounded positional reads. FIFOs, sockets, devices, symlinks and files that change type are "not checked: unsafe entry".
- Entry names with control, format (bidi) or separator characters are skipped as unsafe (the audit's `UNSAFE` class) and counted.
- Hard links: hook files with `nlink !== 1` are refused (above). For Steering and `AGENTS.md` a link count is not a reliable signal on every platform, so the residual risk is accepted: at most 2 KiB of such a file is parsed into fixed codes and never displayed.
- Residuals stated, not solved: opening a cloud-synced placeholder file may make the operating system download it; a stalled network `lstat` can hang until the time budget is checked (the run is cancellable and never blocks the editor's UI thread, but it can outlast its budget).
- Injected `fs` with no write method, so the module cannot write by construction. Tests assert no write call.

## 6. What is parsed, kept and discarded

**Steering front matter.** Recognised only when the file starts at byte 0 with `---` followed by `\n` or `\r\n` (a lone `\r` is rejected) and a closing `---` line occurs within the 2 KiB prefix. The caller decodes only the bytes up to that closing line and owns BOM policy (a BOM makes the mode "not recognised"). A hand-written line parser (no YAML library) accepts: `inclusion` (scalar), `fileMatchPattern` (one quoted or bare scalar, or a flow array of quoted strings), `name`, `description` (presence only). Anything else (tabs, nested structures, anchors, multi-line scalars, a BOM, no closing line within 2 KiB, unknown `inclusion` value, `auto` without `name` and `description`) makes the file's mode **"not recognised"**. Kiro's behavior for malformed front matter is unknown, so such a file is never counted as always-included and is never claimed to be fine.

- Kept: `{ mode: 'always' | 'fileMatch' | 'manual' | 'auto' | 'unrecognised', matchAll: boolean, patternCount (cap 20), size }`. Absent front matter means `always` (documented default).
- `matchAll` comes from a lexical test (section 7.1); patterns are over 256 chars or more than 20 entries: `matchAll` unknown. **Patterns are never compiled, expanded or evaluated** (no `RegExp`, no glob engine).
- Discarded immediately: all other bytes, `name`/`description` text, pattern text.

**Hook files.** `JSON.parse` of at most 64 KiB inside `try`; a thrown `SyntaxError` or `RangeError` (deep nesting) becomes the code `json_invalid`. Catch clauses bind no error (`catch {`), so no parser message, which can echo input, is ever kept. The code never recurses over, `JSON.stringify`s or `structuredClone`s the parsed value. Fields are read only after `Object.hasOwn` and explicit `typeof` checks, into fresh null-prototype structs: `version` must equal `"v1"` (else `schema_unknown`, nothing else read); per hook `trigger` (string, cap 64), `matcher` (string; over 512 chars: "not analysed"), `enabled` (boolean, default true; non-boolean: unrecognised), `action.type` (`command` | `agent`), `name` (string, cap 200, sidebar label only), and **lengths only**: `byteLength` of `action.prompt` and `action.command`.

- Discarded immediately: the parsed object, `description`, `confirm`, `timeout`, command and prompt text. `matcher` is held only until classified (section 7.2), then dropped; only the class and an equality key within one run are kept.
- Unknown triggers: kept as `unrecognised`, never flagged. Hooks with `enabled: false` are not flagged.

**Not displayed, ever:** Steering text or front matter values, patterns, matchers, commands, prompts, descriptions. Only fixed codes, sizes, counts, file names and, in the sidebar label only, hook names (section 8.1).

## 7. Findings catalogue

Each finding records `behaviour` (`documented` | `inferred`) and `threshold` (`none` | `heuristic`), and the view prints them as one fixed sentence (section 8.3). Rules live in one reviewed table (`config-rules.ts`) with the Kiro page and the date checked beside each constant.

### 7.1 Steering and AGENTS.md

| ID | Condition | Behaviour / threshold |
| --- | --- | --- |
| S1 | Steering file with mode `always` (incl. absent front matter) and size at least **8 KiB** ("worth a look") or **24 KiB** ("large") | Always-included: documented. Thresholds: heuristic (about one to two printed pages; Kiro gives no number). |
| S2 | `AGENTS.md` at the root at least 8 KiB / 24 KiB | Always included, no inclusion modes: documented. Thresholds: heuristic. Fix is wording only (move sections into Steering with `fileMatch` or `manual`); Cyclegauge generates no AGENTS.md text. |
| S3 | Sum of sizes of all always-included Steering files (S1 modes plus S4) and root `AGENTS.md` across checked roots at least **32 KiB** | Documented: all of them are loaded for every interaction. Threshold: heuristic. Shown once as a total, with the largest contributors by file. A lower bound when some files are "not recognised" or not checked. |
| S4 | Mode `fileMatch` where every pattern is one of `**`, `**/*`, `**/**` (after trimming and a leading `./`). Forms such as `*` and `*.*` may depend on Kiro's glob semantics and are not flagged as match-all | "Loads like always-included": inference (lexical test only; Kiro documents the pattern semantics only by example). Counts toward S3. Other broad-looking patterns are reported only as "pattern too broad to judge" information with the same inference label. |
| S5 | `auto` mode, `manual` mode | No finding. |
| S6 | Front matter with no closing line inside the 2 KiB window, an unknown mode, or `.md` files in subfolders of `.kiro/steering` | Not a finding: **not checked** (section 10). Whether the IDE reads nested steering folders is unknown. |

File size is the file itself. Files pulled in with `#[[file:...]]` add to the context (documented) and are not counted; every size is worded "at least" in the S3 total.

### 7.2 Hooks

Trigger classes (from Hook types, alias set `AgentSpawn`/`agentSpawn` = `SessionStart`): **file** = `PostFileSave`, `PostFileCreate`, `PostFileDelete`; **tool** = `PreToolUse`, `PostToolUse`; **prompt** = `UserPromptSubmit`; **stop** = `Stop`; **once** = `SessionStart`, `SessionEnd`, `PreTaskExec`, `PostTaskExec`, `Manual`. Exact known names only; anything else is `unrecognised`.

Matcher class (lexical, string tests only, never a regex or glob evaluation): **none** (absent, empty, whitespace; documented as match-all); **broad** (exactly `*`, `**`, `**/*`, `.*`, `.+`, `^.*$`); **specific** (anything else); **not analysed** (over 512 chars). `prompt` and `stop` triggers take no matcher (documented for `Stop`), so they count as **none**.

| ID | Condition (enabled hook) | Behaviour / threshold |
| --- | --- | --- |
| H1 | Action `agent`, trigger class file, matcher none or broad | Agent prompt action consumes credits (documented); file triggers fire only for agent changes (documented, so wording is "every file the agent saves", never "every save"). Kiro recommends specific patterns (documented). No threshold. |
| H2 | Action `agent`, trigger class tool, matcher none or broad | Runs for every tool call. Credit use: documented. Recommendation to use specific matchers: documented. |
| H3 | Action `agent`, trigger class prompt or stop | Runs on every prompt or every agent turn, no matcher possible. Credit use: documented. Reported as **information** (it may be intended). |
| H4 | Action `agent`, any frequent class (H1 to H3), `prompt` length at least **2 KiB** | Kiro says keep prompts concise (documented, no number). Threshold: heuristic. On a prompt-class hook the text is appended to every prompt. |
| H5 | Two or more enabled hooks with the same trigger where at least one has matcher none or broad, or whose matcher strings are identical | All matching hooks run (documented: multiple hooks per file, workspace and global run together). Overlap by string equality only; regex overlap is not decided ("not analysed"). When two or more are agent actions it says "each starts agent work". |
| H6 | Action `command` | **Never a credit finding.** Command actions do not consume credits (documented). |
| H7 | Hook count over 200 per file, files over 100 | Not checked, counted. |

Matcher grammar differs by surface (regex against the file path in the schema, glob wording on the best-practices page, selectors and wildcards for tools). Cyclegauge therefore flags only the match-all forms above and **never generates a matcher** (section 9).

## 8. Presentation

### 8.1 What is shown, and why names are acceptable

The existing audit already shows workspace-relative paths of the user's own files in the sidebar (escaped with `escapeText`) and the folder name in the header, and shows **no** path or name on the credit dashboard, the diagnostics or the clipboard text of the summary. The review stays inside that rule:

- **Sidebar (native tree, in the Audit view): shown.** Workspace-relative path of the Steering or hook file (`.kiro/steering/x.md`, `.kiro/hooks/y.json`), `AGENTS.md`, the root folder name when more than one root is checked, size (`formatSize`), fixed reason text, fixed basis sentence. For a hook, additionally its `name`, **cut to 60 code points first and escaped afterwards** (`escapeText`; never cut after escaping, so an escape sequence is never split), shown **in the sidebar label only**. Hook names are user text in a user's own file, comparable to file names. Names with control or bidi characters are made visible, as the audit does. Fallback if rejected: ordinal "hook 2 of 3" everywhere.
- **Not shown anywhere:** pattern, matcher, command and prompt text; Steering text.
- **Credit dashboard, status bar, diagnostics, recap, CSV, logs:** counts at most, and only if the maintainer later approves a summary (not in v1). The dashboard shows nothing in v1.
- **Tooltips, previews, notifications, clipboard, messages:** fixed strings plus the file's workspace-relative name; hooks are referred to by **ordinal** ("hook 2 of 3 in lint.json"), never by name. Reason: untitled preview documents can persist through the editor's hot exit, tooltips and notifications may render markdown in some editors, and the clipboard leaves the view. No exception text anywhere.

### 8.2 Tree

One header node "Kiro Steering and Hooks" (counts, "checked just now" or "checked automatically · just now", "partial check" and "automatic review paused" when relevant), then groups: "Always-included Steering", "AGENTS.md", "Hooks that start agent work", "Overlapping hooks", "Not checked". Each finding row ends with its advisor-style next step (the preview action or one plain sentence). Findings first seen after the window opened carry an in-memory "new this session" marker. Same icons, group and tooltip structure as `auditTree`; opaque ids (position-based, no path in an id). Pure vscode-free builder next to `audit-model.ts`.

### 8.3 Wording rules

- Every finding has one **basis sentence** from a closed set: "Kiro documents this behavior." / "Kiro documents this behavior; the threshold is a Cyclegauge heuristic." / "Cyclegauge inference from Kiro's documentation."
- **Credit statement** from a closed set, never a number: "Kiro documents that agent prompt actions use credits." / "A larger always-included context is sent with every interaction; Kiro does not publish how this maps to credits." / "Kiro documents that command actions do not use credits." The audit's current "can save credits" phrasing for files is not reused for Steering because the link is undocumented.
- Findings say "may" and "about"; "Being listed does not mean the setting is wrong."
- A tooltip line notes: "Kiro CLI V1/V2 loads only always-included files automatically" for preview text that changes the mode (documented).

## 9. Previews (never written) - superseded for single-file findings by apply actions (update at the top of this document)

Pattern follows the audit: Cyclegauge prepares nothing in the workspace by itself. v1 is **preview-only**: an action opens a new, unsaved, untitled document (`openTextDocument({ content, language })`, the audit's fallback path) with fixed text and a header comment "Suggested by Cyclegauge - review before saving; nothing was changed". No `WorkspaceEdit` on any workspace file in v1. Because untitled documents can persist (hot exit), previews contain only fixed strings and the file's workspace-relative name, never a hook name or any read content.

- **S1/S3 (Steering, always):** the exact front matter `---\ninclusion: manual\n---` (valid per Kiro), plus a plain-language note for the alternatives `fileMatch` ("choose a pattern for the files it applies to") and `auto` ("needs a name and a description you write"). Cyclegauge does not invent a pattern or a description.
- **S4:** a note to replace the match-all pattern; no generated pattern.
- **H1/H2/H3 (agent hooks):** the line `"enabled": false` for the hook (valid per Kiro's schema) with the note that disabling loses the automation; guidance text to use a command action or a more specific matcher. **No generated matcher**, because the matcher grammar is inconsistent across Kiro pages (section 10).
- **H5:** text only, naming the overlapping hooks by file and ordinal ("hook 1 and hook 3 in lint.json"), never by name.
- **S2 (AGENTS.md):** text only.
- Preview text contains no read content; the header holds only the escaped workspace-relative file name. File names with unsafe characters get no preview, as in the audit's `suggestion`.
- **Later option, needs approval (question 6 in section 15):** a prepared unsaved edit through the audit's `prepare` pattern (open document, `applyEdit` insertion at offset 0 when a Steering file has no front matter, never when `autoSave` is on, saved-edit hook to mark the finding done). It reads the document through the editor, so it is not in v1.

## 10. Failure, unknown and inconsistent-documentation cases

Closed list of codes, each with a fixed sentence and a count, grouped under "Not checked". Nothing is silently dropped and no unknown is shown as OK.

| Code | Meaning |
| --- | --- |
| `untrusted`, `root_refused`, `root_not_local` | Whole root not checked. |
| `no_kiro_config` | Neither `.kiro/steering`, `.kiro/hooks` nor `AGENTS.md` found: "Nothing to review." |
| `folder_symlink`, `folder_unreadable`, `too_many_entries` | One folder not checked. Only `ENOENT` counts as absent; every other error is `folder_unreadable`. |
| `file_unsafe`, `link_not_followed`, `file_too_large`, `file_unreadable`, `name_unsafe` | File not checked. `link_not_followed` (a symlinked file, for example a linked `AGENTS.md`) is distinct from `file_unsafe` (special file, type change, `nlink !== 1`); a not-followed `AGENTS.md` makes the S3 total a lower bound. |
| `fm_unrecognised`, `json_invalid`, `schema_unknown`, `trigger_unknown`, `field_unrecognised` | File or hook recognised as present but not understood; not guessed. |
| `limit_files`, `limit_hooks`, `limit_roots`, `limit_bytes` (3.6 MiB per-run budget), `limit_time`, `cancelled` | Run limits; result is "partial". |

Fixed notes always shown: "Global Steering and Hooks in your home folder, AGENTS.md in subfolders, legacy hook files, custom agent resources and cloud configuration are not checked." If a **later** Kiro page contradicts one of the points below, the rule table in `config-rules.ts` (single source) is the only place to change.

Inconsistencies in Kiro's documentation and the decision for each:

1. **Matcher grammar** (file events: regex in the schema; best practices recommend glob-style `src/**/*.ts`; tool matchers: selectors, wildcards, regex). Decision: lexical match-all detection only; no matcher generated; wording does not state which syntax is right.
2. **Blocking exit codes** (older pages: any non-zero blocks; newer: only 2, and CLI V3 prompt hooks cannot block). Not relevant to credit findings; Cyclegauge does not interpret exit codes or `confirm`.
3. **Trigger names** (display names versus PascalCase JSON names, aliases). Exact known set; unknown names are reported `trigger_unknown`, never an error, never flagged.
4. **Agent action semantics** (Hooks page: "inject a prompt into the current conversation"; Actions page: "trigger a new agent loop" and use credits). Decision: use only the sentence "Kiro documents that agent prompt actions use credits" and no per-run claim.
5. **Schema/location versions** (v1 JSON in IDE 1.0 and CLI V3; legacy `.kiro.hook` in IDE 0.x; CLI V1/V2 loads only `always`). Only `version: "v1"` in `.kiro/hooks/*.json` is reviewed; others are `schema_unknown` or ignored legacy names (counted in a fixed "other files ignored" line, never read).
6. **Unknowns** that stay unknown: size limits, truncation, nested steering folders, AGENTS.md precedence, malformed front matter. Each leads to "not recognised" or a note, not a guess.

## 11. Threat model

- **Hostile repository contents** (the file set comes from a cloned, possibly untrusted repo): mitigated by workspace trust, no execution of anything, content parsed into fixed codes in memory and dropped, no display of content, the size and count limits above, and read-only injected `fs`.
- **Prompt-injection text inside Steering/hook files.** It is never sent to a model by Cyclegauge, never executed, never rendered, never placed in a preview, clipboard, diagnostic or log. The only user-controlled strings that reach the UI are file names (tree labels, tooltips, preview headers) and hook names (sidebar label only), made visible with `escapeText` and length-capped (cap by code points first, then escape), in a native tree (plain text, no markdown or command links in labels or tooltips). Hook names are never in previews, tooltips, notifications or the clipboard.
- **ReDoS and pathological patterns.** No user-supplied pattern is ever compiled or matched; only fixed lexical comparisons on strings capped at 256 or 512 characters. A static test asserts that no `config-*.ts` file contains `RegExp(` or `new RegExp`, and that every fixed regex literal (for example the unsafe-name class) has no nested quantifiers or alternation overlap. Test with 1 MiB-class and long repeated-group inputs to prove linear time.
- **Huge, special and racing files.** 2 KiB and 64 KiB caps enforced on the handle, 3.6 MiB per-run budget, `O_NOFOLLOW`/`O_NONBLOCK`, regular-file check, before/after ancestor checks. The residual ABA race of the audit applies (Node lacks `openat`); impact is bounded because nothing read is displayed.
- **Deep or huge JSON.** 64 KiB cap, `try/catch` including `RangeError`, no recursion, `JSON.stringify` or `structuredClone` over the parsed value; prototype-pollution keys are harmless because only explicit own fields are read into fresh structs.
- **Symlink escapes and Kiro data.** Ancestor and file symlinks refused; `refusal()` keeps Kiro data and Cyclegauge storage out; `~/.kiro` is not read.
- **Misleading output.** A hook name cannot imitate Cyclegauge text because it is only a suffix on a sidebar label, capped and escaped. A finding never claims an outcome ("saves N credits").
- **Consent drift.** Because the content-read is a new boundary, every place that says the audit "never reads other file contents" is updated in the phase 10c PR: `docs/usage.md` (line 53), `docs/privacy-and-storage.md` (line 23), `README.md` (line 75) and the trust-boundary entry in `ARCHITECTURE.md`. The wording must say: the review is a separate command from the audit; it runs when you click it, or automatically only if you turn on `cyclegauge.configReviewAutomatically` (off by default, a user setting): then on workspace open and when `AGENTS.md`, `.kiro/steering/*.md` or `.kiro/hooks/*.json` change, reading nothing else; it reads the first few bytes of each Steering file (and up to 2 KiB only when a front-matter block follows) and parses Hook JSON files up to 64 KiB; hook names are read and shown in the sidebar; only the size of `AGENTS.md` is read; nothing else from those files is kept or shown.
- **State separation.** The review result is held apart from the audit result. A review never changes `AuditSummary` (the dashboard's Workspace card), the `support.valueSeen` flag, the audit's reminder state or the Copy-suggestions clipboard text.
- **Denial of service.** Time budget, one run at a time.
- **Automatic mode: watcher event storms** (a build, checkout or formatter touching thousands of files, or a hostile repository toggling an allowlisted file in a loop). The watcher pattern is narrow and its handler stores no path, only a per-root flag; events outside the three allowlisted shapes are dropped before any work. Trailing debounce (5 s, forced after 60 s), single-flight, a 30 s minimum interval and a hard cap of 20 automatic runs per window bound the work. The worst case is 20 runs times the 3.6 MiB per-run budget across all roots, about 72 MiB read per window; the cap pauses automatic mode afterwards. The event handler itself makes no filesystem call.
- **Automatic mode: hostile repository toggling files to nag.** The notification is limited to new finding classes, 1 per run, 3 per window, 60 s apart, with fixed text; repeated toggling cannot produce more. A hostile repo cannot enable the mode (application-scope setting) and cannot make it read outside the allowlist (the path shape check runs on watcher events and again in the reader).
- **Automatic mode: cost of repeated reads.** Reads are bounded prefixes and capped hook files on the user's own machine; the run yields between files and honours the abort signal, so the editor stays responsive. Cloud-placeholder download and slow network drives (section 5) matter more in automatic mode: the 3 s budget and the 20-run cap apply, and a run still outstanding blocks the next. Setting `off`, trust loss or a root change aborts an in-flight run and discards its result; stale-generation watcher events are ignored.
- **Automatic mode: consent.** Opt-in, off by default, user-scope, unknown value means off. The offer says the choice is global, writes only that user setting with `ConfigurationTarget.Global` after a click, and detects "already set" from the global value only, so a repository setting can neither enable the mode nor suppress or fake the offer.

## 12. Persistence, diagnostics, data model, code layout

**Persistence: none in v1, except the approved enable-offer boolean.** No `workspaceState` keys, no files, no cache. Results, the automatic mode's `seen` class set, run counters and "new this session" markers live in memory only and are cleared on window reload. **Approved by the maintainer (question 11):** one boolean `globalState` key `cyclegauge.configReview.offered.v1`, set when the enable offer is shown or dismissed, holding no data, not registered for Settings Sync, cleared by the existing reset command; a value of an unknown shape counts as "offered" and is never overwritten. The one new configuration item is the user setting `cyclegauge.configReviewAutomatically`, which Cyclegauge writes only when the user clicks "Turn on". A hide/dismiss action, "last reviewed" date or summary counts on the dashboard would each need a new key and separate approval (question 8 in section 15). Dismissals of the existing audit are unaffected.

**Diagnostics: no change to the output contract in v1.** Failure codes appear only in the view. If later desired, at most fixed counters (`configReview: available|unavailable`, number of not-checked codes) with no names, as the audit already does; that would be a contract change needing approval.

**Data model** (illustrative):

```ts
type SteeringMode = 'always' | 'fileMatch' | 'manual' | 'auto' | 'unrecognised';
interface SteeringEntry { rel: string; size: number; mode: SteeringMode; matchAll: boolean | 'unknown' }
interface HookEntry { rel: string; index: number; name: string; trigger: HookTrigger | 'unrecognised';
  action: 'agent' | 'command' | 'unrecognised'; matcher: 'none' | 'broad' | 'specific' | 'not_analysed'; matcherKey?: string;
  enabled: boolean; promptBytes: number }
interface ConfigReview { status: 'complete' | 'partial' | 'unavailable'; roots: RootReview[]; notChecked: Record<NotCheckedCode, number> }
interface ConfigFinding { id: 'S1'|'S2'|'S3'|'S4'|'H1'|'H2'|'H3'|'H4'|'H5'; root: number; rel: string; hook?: number;
  severity: 'info' | 'notice'; behaviour: 'documented' | 'inferred'; threshold: 'none' | 'heuristic'; size?: number }
```

`matcherKey` exists only in memory during a run for H5 equality and is dropped before the result is returned.

**Code layout** (new files, existing audit modules unchanged except where noted):

- `src/audit/config-read.ts`: allowlisted listing and bounded reads with injected `fs`; shares `readBounded`/`chainOk` with `read-ignore.ts` (phase 10a extracts them without behavior change).
- `src/audit/config-parse.ts`: pure front matter and hook parsers (string in, minimal struct out).
- `src/audit/config-rules.ts`: constants, trigger table, thresholds with source and date, and the pure finding functions.
- `src/audit/config-review.ts`: orchestrates one review (roots, limits, abort, yields).
- `src/extension/config-model.ts`: vscode-free tree and preview text builders (reuses `escapeText`, `formatSize`).
- `src/extension/config-schedule.ts` (phase 10d): vscode-free decision logic for the automatic mode (when to run, debounce, minimum interval, run cap, which classes are new, notification limits) with an injected clock, tested like `audit-schedule.ts`.
- Glue: a registration function beside `registerAudit` for the command, the tree nodes appended to the Audit view provider, and the preview document; `folderCheck` is shared with the audit (small refactor). `package.json` gets one command (10c) and one setting (10d). The watcher and scheduler wiring lives in the same registration function and is separate from `registerAudit`'s watcher.

## 13. Phases and reviews

Every phase gets a mandatory `security-reviewer` review before its PR; implementation by `implementer-senior`; at most one re-review.

| Phase | Content | Sections it must satisfy | Approvals (section 15; 1 to 9 answered 2026-10-18) |
| --- | --- | --- | --- |
| 10a | `config-read.ts` and `config-parse.ts` with all limits, plus extraction of `readBounded` with `readIgnoreFile` as a byte-identical wrapper (existing audit tests unchanged and green). No UI. | 5, 6, 11 | 5 (read boundary) |
| 10b | `config-rules.ts` and `config-review.ts`: findings, codes, orchestration (pure, no UI). | 7, 10 | 3 (thresholds), 4 (multi-root) |
| 10c | Command, tree nodes, preview documents, trust/multi-root/folder guards, the four documentation updates in section 11, `package.json` command. | 4, 8, 9, 11, 12 | 1, 2, 6, 8 |
| 10d | **Automatic mode:** the setting, `config-schedule.ts`, the review's own guard and staggered delay, narrow watcher with generations, debounce, minimum interval and run cap, re-validation and abort, new-class notification, the enable offer (and its key if approved), the `cyclegauge.supportPrompts` description change, documentation wording for the opt-in. Mandatory `security-reviewer` review (scoped to 4.1 and the automatic-mode threat model). | 4.1, 8, 11, 12 | 2 (answered), 10, 11 (key) |
| 10e (optional, formerly 10d) | Prepared unsaved edit for Steering without front matter; persistence or dashboard summary, if wanted. | separate design update | 6, 8, new approvals |

## 14. Tests plan (synthetic only)

Fixtures are built in memory or under a per-test temporary directory by the test itself; names such as `synthetic-steering.md`, `synthetic-hook.json`, invented dates and sizes. No Kiro data, no copied examples with real project content. Checks: `pnpm typecheck`, `pnpm test`, `git diff --check`; no fixture-validator change is expected (`tests/fixtures/kiro/validate.py` only if that folder changes).

- **Parsers (table-driven):** front matter happy paths for each mode; BOM, leading blank line, tab indent, anchors, missing closing line within 2 KiB, lone `\r` after the opener (rejected) versus `\r\n` and `\n` (accepted), unknown mode, `auto` without name/description, array patterns over 20, patterns over 256 chars; hook JSON with every trigger and its alias, unknown trigger, `version` other than `v1`, non-boolean `enabled`, prompt and command lengths without keeping text, 200+ hooks, `__proto__`/`constructor` keys, 10,000-deep nesting (asserts only that no throw escapes and the result is `json_invalid` or no fields were read), truncated JSON, a hook file with a BOM or invalid UTF-8 (`json_invalid`).
- **Hostile text:** a prompt-injection sentinel (for example `SYNTHETIC-INJECT-IGNORE-PREVIOUS`) in a Steering body, a pattern, a hook name, prompt and command, and inside **invalid JSON** (so a parser error message would echo it); assert it appears in no output, tree, preview, tooltip, notification, clipboard text or error, except as an escaped hook name capped at 60 code points in the sidebar label only. Assert hook names are absent from tooltips, previews and messages (ordinals only).
- **Prefix read:** a Steering file with no front matter has exactly 5 bytes requested and no further read (spy on the handle); with an opener it reads at most 2 KiB; a sentinel placed after byte 2 KiB or after the closing line is never decoded.
- **ReDoS:** long repeated-group matcher and pattern strings finish within a fixed time bound; a static test fails if any `config-*.ts` file contains `RegExp(` or `new RegExp`, and the fixed regex literals are reviewed for nested quantifiers. Static checks also forbid `console.` and catch clauses that bind the error; every promise is awaited or handled.
- **Reader safety:** symlinked `.kiro`, `steering`, `hooks`, symlinked file, FIFO or device through an injected `fs` and, where supported, a real temp dir; type change between `lstat` and `open`; oversized file; file growing between stat and read; more than 500 or 100 entries (listing stops at 501 and the directory handle is closed, also on error); a directory swapped during listing (`intact` check); only `ENOENT` is "absent" and `EACCES`/`EIO` on each ancestor (`.kiro`, `steering`, `hooks`) give `folder_unreadable`; hook file with `nlink !== 1`; symlinked `AGENTS.md` gives `link_not_followed` and a lower-bound S3; the 3.6 MiB per-run budget; unsafe names; the injected `fs` has no write method and a spy asserts zero writes; only the allowlisted paths are touched (record all paths).
- **Rules:** each finding at, below and above its threshold; both severities; S3 across roots; H1 to H5 matrix over trigger class by matcher class by action type; command hooks never produce a credit finding; disabled hooks skipped; unknown values produce `not checked` and a lower-bound total, not a finding; wording tests that no output contains a number followed by "credit".
- **Model/presentation:** tree structure, opaque ids, escaping of bidi and control characters in names, basis and credit sentences from the closed sets, preview text exact match, unsafe names get no preview.
- **Regression of the shared reader:** `readIgnoreFile` returns exactly today's results for `not_allowed`, `unsafe`, `oversized` and `unreadable`, a BOM-prefixed file and an invalid-UTF-8 file; `readBounded` refuses a path that fails `allow` before any `lstat` or `open`.
- **State separation:** after a review, `AuditSummary` (dashboard Workspace card), `cyclegauge.support.valueSeen.v1` and the Copy-suggestions clipboard text are byte-identical to before; no storage key is written (the approved offer key excepted).
- **Extension glue (mock `vscode`):** untrusted workspace reads nothing; two spellings of one real root are reviewed once; the cross-root sum is labelled inference; refused root; multi-root cap of 8; with `off` (default) nothing runs by itself and no watcher is created; the silent audit, its reminder and its watcher never start a review; no `WorkspaceEdit` call and no write API in v1; no new storage key written.
- **Automatic mode (phase 10d, pure `config-schedule` tests with a fake clock, plus glue with a mock watcher):**
  - Setting values `off`, `onOpen`, `onOpenAndChanges`, unknown or workspace-scoped values (treated as `off`); the setting is read at application scope.
  - `onOpen` runs once per window after `CONFIG_REVIEW_DELAY_MS` and not in an untrusted or refused root; trust granted later starts it. **An audit reminder run and an `onOpen` review both run in one window**, independently (separate guards, staggered start).
  - Watcher: created only in `onOpenAndChanges`, one per root that passes its own `folderCheck` (up to 8; a failing root is skipped, the others watched), exact pattern; events with other shapes (nested, `..`, other names, non-`file:`) are ignored; the shape check is case-insensitive on darwin and win32; the handler makes no filesystem call (spy) and retains no path.
  - Generations: after a rebuild, an event from the disposed watcher or a stale generation or another root is ignored.
  - **Off during the debounce = zero reads**; trust loss or a root change during a debounce or an in-flight run clears the timers, aborts the run and discards its result; the setting, trust and `folderCheck` are re-read when a run fires.
  - Event storm: 10,000 events produce one run after the debounce; a continuous stream is forced to run at 60 s; a trigger during a run yields exactly one follow-up; the 30 s minimum interval; the 20-run cap pauses automatic mode and shows the paused header.
  - Manual run during an automatic run: the automatic run is aborted or awaited, the manual run proceeds as manual, does not count toward the cap, clears the dirty flags, and still works after the cap.
  - Per-run byte budget: Steering prefixes and hook files across several roots share 3.6 MiB and give `limit_bytes` when exceeded.
  - Notification: the first automatic run notifies nothing and seeds `seen`; a manual run adds its classes to `seen`; a later watcher run with a new class notifies once; the same classes later stay silent; H3-only and "not checked" results are silent; a class held back by the 3-per-window or 60 s limit is announced by a later run; a class that disappears and returns is silent once seen; fixed text with no name or count; `onOpen` mode never notifies.
  - **Own refresh path:** a test starts with `support.valueSeen` unset and an audit result containing findings, runs automatic reviews, and asserts `valueSeen`, `AuditSummary`, the audit's `render()`/`onFinding` and the dashboard card are untouched.
  - Offer: only after a manual run; never when `cyclegauge.supportPrompts` is off, when `inspect().globalValue` is defined (including `off`), or while or just after a support prompt; a workspace-scoped value does not suppress it; **Turn on** calls the update with `ConfigurationTarget.Global` only (assert the target) and writes only that setting; **Not now** writes only the approved key (if approved); with the key, the offer appears once ever.
  - No other storage key is written by any automatic path; the audit's reminder keys and `AuditSummary` are unchanged; the sentinel tests of the manual run also run through the automatic path.
- **Packaged/release:** the VSIX allowlist is unchanged (no new packaged file types); `pnpm test:release` only if release scripts are touched (not expected).
- **Native check before release:** Kiro on macOS with synthetic workspaces; Windows and Ubuntu are separate claims, not implied.

## 15. Questions for the maintainer

**Answered by the maintainer 2026-10-18.** Questions 1 and 3 to 9 were approved as the security reviewer recommended; question 2 was changed. Questions 10 and 11 were also approved on 2026-10-18.

1. **Hook names displayed** in the sidebar (escaped, 60 characters), or ordinal only (section 8.1)? Answered by the maintainer 2026-10-18: names in the sidebar label only; ordinals everywhere else.
2. **New command** `cyclegauge.reviewKiroConfig` and its entry in the Audit view. Answered by the maintainer 2026-10-18, **changed from the recommendation**: approved, and an opt-in automatic mode is designed now (section 4.1, phase 10d) instead of being deferred, because Cyclegauge should automate as much as possible and act as an advisor.
3. **Thresholds** (8 KiB / 24 KiB per always-included file, 32 KiB total, 2 KiB hook prompt, section 7). Answered by the maintainer 2026-10-18: acceptable as labelled heuristics in one table.
4. **Multi-root:** all trusted roots up to 8. Answered by the maintainer 2026-10-18: yes, with real-path de-duplication, the inference label on the cross-root sum and a per-root `folderCheck`.
5. **Reads:** the first few bytes of each Steering file (up to 2 KiB only when a front-matter block follows), Hook JSON up to 64 KiB, size-only for `AGENTS.md`. Answered by the maintainer 2026-10-18: approved, with the documentation wording of section 11.
6. **Preview only in v1.** Answered by the maintainer 2026-10-18: preview-only; a prepared edit (phase 10e) is deferred.
7. **Nested `AGENTS.md`.** Answered by the maintainer 2026-10-18: not checked in v1; no audit contract change.
8. **Persistence and surfacing.** Answered by the maintainer 2026-10-18: none in v1, including no `support.valueSeen` effect. (The automatic mode keeps its state in memory only.)
9. **Global `~/.kiro` steering and hooks and CLI V3.** Answered by the maintainer 2026-10-18: out of scope.
10. **Setting for the automatic mode (decided 2026-10-18):** `cyclegauge.configReviewAutomatically` with `off` (default) | `onOpen` | `onOpenAndChanges`, application scope, unknown value = `off`; bounds: 45 s open delay, 5 s debounce, 60 s forced run, 30 s minimum interval, 20 runs, 3 notifications per window, 3.6 MiB per run. Approved by the maintainer: accept; keep the default `off`; making `onOpen` the default needs a separate approval after a native macOS check.
11. **Enable offer and its key (decided 2026-10-18):** the offer after a manual run is global, written with `ConfigurationTarget.Global` only. Approved by the maintainer: **one boolean `globalState` key `cyclegauge.configReview.offered.v1`** (set when the offer is shown or dismissed; no data; shown once ever). The boolean key is explicitly approved; no other persistence is approved. Recorded in phase 10d: the key `cyclegauge.configReview.offered.v1` was approved on 2026-10-18 by the maintainer's instruction and is the only key 10d adds; it is cleared by **Reset Support Prompts and Summary**.
