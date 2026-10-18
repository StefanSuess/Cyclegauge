# WP10 Hook and Steering review: design

Status: **proposed; not yet reviewed.** On 2026-10-18 the maintainer approved the direction: Cyclegauge may read Kiro configuration text in the workspace for this feature (bounded `.kiro/steering/*.md`, `AGENTS.md`, Hook definitions). Where Kiro's documentation gives recommendations or limits for Steering and Hooks they are adopted; where it gives none, Cyclegauge proposes thresholds labelled as **Cyclegauge heuristics**. This document is a design, not an approval to implement: it needs a `security-reviewer` review, and the items in section 13 need maintainer answers. Scope comes from the WP10 paragraph of [path to 1.0](path-to-1.0.md); evidence and the first read-allowlist proposal come from [wp10-13-evidence](wp10-13-evidence.md). Kiro documentation was re-read on 2026-10-18 (pages in section 2); it changes often, so the rule table in section 7 carries a re-check date.

## 1. Purpose and user-visible value

Kiro loads Steering into every interaction and can start agent work from Hooks. Both are easy to over-use and invisible once set up. The review turns two folders of configuration into a short list of concrete findings, each with a plain-language reason and a preview of a narrower setting.

Example findings (wording is a draft; see section 8):

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
- No Steering body content, no hook prompt or command text kept, displayed or stored. No `#[[file:...]]` reference resolution.
- No estimated credits, no content-quality or redundancy analysis, no session or usage analysis.
- No writing: nothing is written into `.kiro` or anywhere; previews only (section 9).
- No new runtime dependency (no YAML or glob library), no network.
- Nested `AGENTS.md` files, legacy `.kiro.hook` files, custom agent `resources` and cloud configuration: not checked.

## 4. Trigger, consent and trust

- **Own explicit command**, not part of the filename-only audit: `cyclegauge.reviewKiroConfig` ("Cyclegauge: Review Kiro Steering and Hooks"), also offered as a node in the existing Audit view. A new contributed command needs maintainer approval (section 13).
- **Never automatic in v1.** The silent audit, the reminder and the file watcher never run it, because the audit's published promise is "does not read other file contents".
- **Workspace trust required.** `vscode.workspace.isTrusted` false: nothing is read; the view says "Not checked: workspace is not trusted". Only `file:` folders.
- **Same folder guards as the audit.** Each root goes through the existing `folderCheck` / `refusal()` (filesystem root, home folder, Kiro data, Cyclegauge storage, broad roots). A refused root is "not checked" with the existing fixed reason.
- **Multi-root: all trusted `file:` roots, at most 8.** Kiro reads `.kiro` under each root (documented) and always-included Steering applies in all roots, so the always-included total is summed across checked roots. The audit picks one root; this review differs on purpose. Roots beyond 8 are counted as not checked. Findings carry the root's folder name (escaped), as the audit header does.

## 5. Read allowlist and limits

Per checked root, exactly these entries; nothing else is opened or listed:

| Item | Operation | Limits |
| --- | --- | --- |
| `<root>/.kiro/steering/` | Non-recursive listing; names ending `.md` (case-insensitive) are candidates | Listing stops at 500 entries (more: folder "not checked, too many entries"). At most 100 candidates per root are examined in name order; the rest are counted. |
| each steering candidate | `lstat` size always; bounded read of the **first 2 KiB only** | Regular file only. Never the body. No second read. |
| `<root>/AGENTS.md` | `lstat` size only; **no content read** | Regular file only. |
| `<root>/.kiro/hooks/` | Non-recursive listing; names ending `.json` | Same 500 and 100 limits. |
| each hook file | Whole-file read, strict `JSON.parse` | At most **64 KiB** per file (larger: counted "too large", not parsed); at most 2 MiB read per run; at most 200 hook entries per file (rest counted). |

Run limits: 3 s time budget, `AbortSignal` honoured, a yield to the event loop between files, one run at a time (shared in-flight guard with the audit). The numbers are proposals; Kiro documents none.

Safety rules (same primitives as `src/audit/read-ignore.ts`, reused or extracted into a shared `readBounded`, phase 10a):

- The root and every ancestor (`.kiro`, `.kiro/steering`, `.kiro/hooks`) must be real directories (not symlinks) on the root's device; checked before and after the read.
- Files: `lstat` must say regular file, not symlink; opened with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; the handle's `fstat` must be a regular file with the same device and inode; reads are bounded positional reads. FIFOs, sockets, devices, symlinks and files that change type are "not checked: unsafe entry".
- Entry names with control, format (bidi) or separator characters are skipped as unsafe (the audit's `UNSAFE` class) and counted.
- Hard links cannot be detected portably. Residual risk is low: content is parsed into fixed codes and never displayed (section 7).
- Injected `fs` with no write method, so the module cannot write by construction. Tests assert no write call.

## 6. What is parsed, kept and discarded

**Steering front matter.** Recognised only when the file starts at byte 0 with `---` + line break and a closing `---` line occurs within the 2 KiB read. A hand-written line parser (no YAML library) accepts: `inclusion` (scalar), `fileMatchPattern` (one quoted or bare scalar, or a flow array of quoted strings), `name`, `description` (presence only). Anything else (tabs, nested structures, anchors, multi-line scalars, a BOM, no closing line within 2 KiB, unknown `inclusion` value, `auto` without `name` and `description`) makes the file's mode **"not recognised"**. Kiro's behavior for malformed front matter is unknown, so such a file is never counted as always-included and is never claimed to be fine.

- Kept: `{ mode: 'always' | 'fileMatch' | 'manual' | 'auto' | 'unrecognised', matchAll: boolean, patternCount (cap 20), size }`. Absent front matter means `always` (documented default).
- `matchAll` comes from a lexical test (section 7.1); patterns are over 256 chars or more than 20 entries: `matchAll` unknown. **Patterns are never compiled, expanded or evaluated** (no `RegExp`, no glob engine).
- Discarded immediately: all other bytes, `name`/`description` text, pattern text.

**Hook files.** `JSON.parse` of at most 64 KiB inside `try`; a thrown `SyntaxError` or `RangeError` (deep nesting) becomes the code `json_invalid`. The result is read only through explicit `typeof` checks into fresh null-prototype structs: `version` must equal `"v1"` (else `schema_unknown`, nothing else read); per hook `trigger` (string, cap 64), `matcher` (string; over 512 chars: "not analysed"), `enabled` (boolean, default true; non-boolean: unrecognised), `action.type` (`command` | `agent`), `name` (string, cap 200, for display only), and **lengths only**: `byteLength` of `action.prompt` and `action.command`.

- Discarded immediately: the parsed object, `description`, `confirm`, `timeout`, command and prompt text. `matcher` is held only until classified (section 7.2), then dropped; only the class and an equality key within one run are kept.
- Unknown triggers: kept as `unrecognised`, never flagged. Hooks with `enabled: false` are not flagged.

**Not displayed, ever:** Steering text or front matter values, patterns, matchers, commands, prompts, descriptions. Only fixed codes, sizes, counts and the names in section 8.1.

## 7. Findings catalogue

Each finding records `behaviour` (`documented` | `inferred`) and `threshold` (`none` | `heuristic`), and the view prints them as one fixed sentence (section 8.3). Rules live in one reviewed table (`config-rules.ts`) with the Kiro page and the date checked beside each constant.

### 7.1 Steering and AGENTS.md

| ID | Condition | Behaviour / threshold |
| --- | --- | --- |
| S1 | Steering file with mode `always` (incl. absent front matter) and size at least **8 KiB** ("worth a look") or **24 KiB** ("large") | Always-included: documented. Thresholds: heuristic (about one to two printed pages; Kiro gives no number). |
| S2 | `AGENTS.md` at the root at least 8 KiB / 24 KiB | Always included, no inclusion modes: documented. Thresholds: heuristic. Fix is wording only (move sections into Steering with `fileMatch` or `manual`); Cyclegauge generates no AGENTS.md text. |
| S3 | Sum of sizes of all always-included Steering files (S1 modes plus S4) and root `AGENTS.md` across checked roots at least **32 KiB** | Documented: all of them are loaded for every interaction. Threshold: heuristic. Shown once as a total, with the largest contributors by file. A lower bound when some files are "not recognised" or not checked. |
| S4 | Mode `fileMatch` where every pattern is a match-all form: `*`, `**`, `**/*`, `**/**`, `*.*`, `**/*.*` (after trimming and a leading `./`) | "Loads like always-included": inference (lexical test only; Kiro documents the pattern semantics only by example). Counts toward S3. |
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

- **Sidebar (native tree, in the Audit view): shown.** Workspace-relative path of the Steering or hook file (`.kiro/steering/x.md`, `.kiro/hooks/y.json`), `AGENTS.md`, the root folder name when more than one root is checked, size (`formatSize`), fixed reason text, fixed basis sentence. For a hook, additionally its `name`, passed through `escapeText`, cut to 60 characters, shown as a label suffix only. Hook names are user text in a user's own file, comparable to file names. Fallback if rejected: "hook 2 of 3". Names with control or bidi characters are made visible, as the audit does.
- **Not shown anywhere:** pattern, matcher, command and prompt text; Steering text.
- **Credit dashboard, status bar, diagnostics, recap, CSV, logs:** counts at most, and only if the maintainer later approves a summary (not in v1). The dashboard shows nothing in v1.
- **Messages and tooltips:** fixed strings plus the same escaped names; no exception text.

### 8.2 Tree

One header node "Kiro Steering and Hooks" (counts, "checked just now", "partial check" when relevant), then groups: "Always-included Steering", "AGENTS.md", "Hooks that start agent work", "Overlapping hooks", "Not checked". Same icons, group and tooltip structure as `auditTree`; opaque ids (position-based, no path in an id). Pure vscode-free builder next to `audit-model.ts`.

### 8.3 Wording rules

- Every finding has one **basis sentence** from a closed set: "Kiro documents this behavior." / "Kiro documents this behavior; the threshold is a Cyclegauge heuristic." / "Cyclegauge inference from Kiro's documentation."
- **Credit statement** from a closed set, never a number: "Kiro documents that agent prompt actions use credits." / "A larger always-included context is sent with every interaction; Kiro does not publish how this maps to credits." / "Kiro documents that command actions do not use credits." The audit's current "can save credits" phrasing for files is not reused for Steering because the link is undocumented.
- Findings say "may" and "about"; "Being listed does not mean the setting is wrong."
- A tooltip line notes: "Kiro CLI V1/V2 loads only always-included files automatically" for preview text that changes the mode (documented).

## 9. Previews (never written)

Pattern follows the audit: Cyclegauge prepares nothing in the workspace by itself. v1 is **preview-only**: an action opens a new, unsaved, untitled document (`openTextDocument({ content, language })`, the audit's fallback path) with fixed text and a header comment "Suggested by Cyclegauge - review before saving; nothing was changed". No `WorkspaceEdit` on any workspace file in v1.

- **S1/S3 (Steering, always):** the exact front matter `---\ninclusion: manual\n---` (valid per Kiro), plus a plain-language note for the alternatives `fileMatch` ("choose a pattern for the files it applies to") and `auto` ("needs a name and a description you write"). Cyclegauge does not invent a pattern or a description.
- **S4:** a note to replace the match-all pattern; no generated pattern.
- **H1/H2/H3 (agent hooks):** the line `"enabled": false` for the hook (valid per Kiro's schema) with the note that disabling loses the automation; guidance text to use a command action or a more specific matcher. **No generated matcher**, because the matcher grammar is inconsistent across Kiro pages (section 10).
- **H5:** text only, naming the overlapping hooks.
- **S2 (AGENTS.md):** text only.
- Preview text contains no read content except the escaped file name in the header. File names with unsafe characters get no preview, as in the audit's `suggestion`.
- **Later option, needs approval (section 13):** a prepared unsaved edit through the audit's `prepare` pattern (open document, `applyEdit` insertion at offset 0 when a Steering file has no front matter, never when `autoSave` is on, saved-edit hook to mark the finding done). It reads the document through the editor, so it is not in v1.

## 10. Failure, unknown and inconsistent-documentation cases

Closed list of codes, each with a fixed sentence and a count, grouped under "Not checked". Nothing is silently dropped and no unknown is shown as OK.

| Code | Meaning |
| --- | --- |
| `untrusted`, `root_refused`, `root_not_local` | Whole root not checked. |
| `no_kiro_config` | Neither `.kiro/steering`, `.kiro/hooks` nor `AGENTS.md` found: "Nothing to review." |
| `folder_symlink`, `folder_unreadable`, `too_many_entries` | One folder not checked. |
| `file_unsafe`, `file_too_large`, `file_unreadable`, `name_unsafe` | File not checked. |
| `fm_unrecognised`, `json_invalid`, `schema_unknown`, `trigger_unknown`, `field_unrecognised` | File or hook recognised as present but not understood; not guessed. |
| `limit_files`, `limit_hooks`, `limit_roots`, `limit_time`, `cancelled` | Run limits; result is "partial". |

Fixed notes always shown: "Global Steering and Hooks in your home folder, AGENTS.md in subfolders, legacy hook files, custom agent resources and cloud configuration are not checked." If a **later** Kiro page contradicts one of the points below, the rule table (single source) is the only place to change.

Inconsistencies in Kiro's documentation and the decision for each:

1. **Matcher grammar** (file events: regex in the schema; best practices recommend glob-style `src/**/*.ts`; tool matchers: selectors, wildcards, regex). Decision: lexical match-all detection only; no matcher generated; wording does not state which syntax is right.
2. **Blocking exit codes** (older pages: any non-zero blocks; newer: only 2, and CLI V3 prompt hooks cannot block). Not relevant to credit findings; Cyclegauge does not interpret exit codes or `confirm`.
3. **Trigger names** (display names versus PascalCase JSON names, aliases). Exact known set; unknown names are reported `trigger_unknown`, never an error, never flagged.
4. **Agent action semantics** (Hooks page: "inject a prompt into the current conversation"; Actions page: "trigger a new agent loop" and use credits). Decision: use only the sentence "Kiro documents that agent prompt actions use credits" and no per-run claim.
5. **Schema/location versions** (v1 JSON in IDE 1.0 and CLI V3; legacy `.kiro.hook` in IDE 0.x; CLI V1/V2 loads only `always`). Only `version: "v1"` in `.kiro/hooks/*.json` is reviewed; others are `schema_unknown` or ignored legacy names (counted in a fixed "other files ignored" line, never read).
6. **Unknowns** that stay unknown: size limits, truncation, nested steering folders, AGENTS.md precedence, malformed front matter. Each leads to "not recognised" or a note, not a guess.

## 11. Threat model

- **Hostile repository contents** (the file set comes from a cloned, possibly untrusted repo): mitigated by workspace trust, no execution of anything, content parsed into fixed codes in memory and dropped, no display of content, the size and count limits above, and read-only injected `fs`.
- **Prompt-injection text inside Steering/hook files.** It is never sent to a model by Cyclegauge, never executed, never rendered, never placed in a preview, clipboard, diagnostic or log. The only user-controlled strings that reach the UI are file names and hook names, made visible with `escapeText` and length-capped, in a native tree (plain text, no markdown or command links in labels or tooltips).
- **ReDoS and pathological patterns.** No user-supplied pattern is ever compiled or matched; only fixed lexical comparisons on strings capped at 256 or 512 characters. Test with 1 MiB-class and long repeated-group inputs to prove linear time.
- **Huge, special and racing files.** 2 KiB and 64 KiB caps enforced on the handle, 2 MiB run cap, `O_NOFOLLOW`/`O_NONBLOCK`, regular-file check, before/after ancestor checks. The residual ABA race of the audit applies (Node lacks `openat`); impact is bounded because nothing read is displayed.
- **Deep or huge JSON.** 64 KiB cap, `try/catch` including `RangeError`, no recursion of our own; prototype-pollution keys are harmless because only explicit own fields are read into fresh structs.
- **Symlink escapes and Kiro data.** Ancestor and file symlinks refused; `refusal()` keeps Kiro data and Cyclegauge storage out; `~/.kiro` is not read.
- **Misleading output.** A hook name cannot imitate Cyclegauge text because it is only a suffix on a label, capped and escaped. A finding never claims an outcome ("saves N credits").
- **Consent drift.** Because the content-read is a new boundary, the privacy page and README sentence "does not read other file contents" are updated in the implementation PR to say exactly what this command reads (first 2 KiB of Steering files, Hook JSON, size of AGENTS.md) and that it runs only on explicit command.
- **Denial of service.** Time budget, one run at a time, no watcher.

## 12. Persistence, diagnostics, data model, code layout

**Persistence: none in v1.** No new `globalState` or `workspaceState` keys, no files, no cache. Results live in memory like the audit result and are cleared on the next run or window reload. A hide/dismiss action, "last reviewed" date or summary counts on the dashboard would each need a new key and separate approval (section 13). Dismissals of the existing audit are unaffected.

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
- Glue: a registration function beside `registerAudit` for the command, the tree nodes appended to the Audit view provider, and the preview document; `folderCheck` is shared with the audit (small refactor). `package.json` gets one command.

## 13. Phases and reviews

Every phase gets a mandatory `security-reviewer` review before its PR; implementation by `implementer-senior`; at most one re-review.

| Phase | Content | Blocking items |
| --- | --- | --- |
| 10a | `config-read.ts` and `config-parse.ts` with all limits, plus extraction of the shared bounded reader (existing audit tests unchanged and green). No UI. | 5, 6, 11 |
| 10b | `config-rules.ts` and `config-review.ts`: findings, codes, orchestration (pure, no UI). | 7, 10 |
| 10c | Command, tree nodes, preview documents, trust/multi-root/folder guards, privacy page and README wording, `package.json` command. | 4, 8, 9, 11 |
| 10d (optional, needs approval) | Prepared unsaved edit for Steering without front matter; persistence or dashboard summary, if wanted. | separate design update |

## 14. Tests plan (synthetic only)

Fixtures are built in memory or under a per-test temporary directory by the test itself; names such as `synthetic-steering.md`, `synthetic-hook.json`, invented dates and sizes. No Kiro data, no copied examples with real project content. Checks: `pnpm typecheck`, `pnpm test`, `git diff --check`; no fixture-validator change is expected (`tests/fixtures/kiro/validate.py` only if that folder changes).

- **Parsers (table-driven):** front matter happy paths for each mode; BOM, leading blank line, tab indent, anchors, missing closing line within 2 KiB, unknown mode, `auto` without name/description, array patterns over 20, patterns over 256 chars; hook JSON with every trigger and its alias, unknown trigger, `version` other than `v1`, non-boolean `enabled`, prompt and command lengths without keeping text, 200+ hooks, `__proto__`/`constructor` keys, 10,000-deep nesting, truncated JSON.
- **Hostile text:** a prompt-injection sentinel (for example `SYNTHETIC-INJECT-IGNORE-PREVIOUS`) in a Steering body, a pattern, a hook name, prompt and command; assert it appears in no output, tree, preview, tooltip or error, except an escaped, capped hook name.
- **ReDoS:** long repeated-group matcher and pattern strings finish within a fixed time bound; assert no `RegExp` is constructed from input.
- **Reader safety:** symlinked `.kiro`, `steering`, `hooks`, symlinked file, FIFO or device through an injected `fs` and, where supported, a real temp dir; type change between `lstat` and `open`; oversized file; file growing between stat and read; more than 500 or 100 entries; unsafe names; the injected `fs` has no write method and a spy asserts zero writes; only the allowlisted paths are touched (record all paths).
- **Rules:** each finding at, below and above its threshold; both severities; S3 across roots; H1 to H5 matrix over trigger class by matcher class by action type; command hooks never produce a credit finding; disabled hooks skipped; unknown values produce `not checked` and a lower-bound total, not a finding; wording tests that no output contains a number followed by "credit".
- **Model/presentation:** tree structure, opaque ids, escaping of bidi and control characters in names, basis and credit sentences from the closed sets, preview text exact match, unsafe names get no preview.
- **Extension glue (mock `vscode`):** untrusted workspace reads nothing; refused root; multi-root cap of 8; no automatic run from the watcher, reminder or silent audit; no `WorkspaceEdit` call and no write API in v1; no new storage key written.
- **Packaged/release:** the VSIX allowlist is unchanged (no new packaged file types); `pnpm test:release` only if release scripts are touched (not expected).
- **Native check before release:** Kiro on macOS with synthetic workspaces; Windows and Ubuntu are separate claims, not implied.

## 15. Questions for the maintainer

1. **Hook names displayed** in the sidebar (escaped, 60 characters), or ordinal "hook 2 of 3" only (section 8.1)?
2. **New command** `cyclegauge.reviewKiroConfig` and its entry in the Audit view, run only on explicit click, never automatically in v1 (section 4)? Should a later opt-in automatic mode ever exist?
3. **Thresholds:** 8 KiB / 24 KiB per always-included file and 32 KiB total, 2 KiB hook prompt (section 7), accepted as Cyclegauge heuristics? They are guesses; Kiro publishes none.
4. **Multi-root:** all trusted roots up to 8 (summed always-included total) instead of the audit's one picked folder?
5. **Reads:** first 2 KiB of Steering files (front matter) and whole Hook JSON files up to 64 KiB, size-only for `AGENTS.md`: acceptable as the exact content-read boundary, and the privacy page wording to be updated with it?
6. **Preview only in v1** (new untitled document, nothing applied to workspace files)? Is a later prepared-unsaved-edit for Steering files (phase 10d) wanted, given it makes the editor load the file body?
7. **Nested `AGENTS.md`:** accept "not checked" in v1, or approve a small change so the audit's existing file walk also reports their sizes (touches `audit.ts` result contract)?
8. **Persistence and surfacing:** none in v1 (no hide, no last-reviewed date, nothing on the credit dashboard). Is that right, or should a dismiss key or dashboard count be designed now?
9. **Global `~/.kiro` steering and hooks and CLI V3:** keep out of scope (the view says so), or schedule a separate approval?
