# WP6 interactive dashboard: design

Status: **draft for maintainer approval (2026-10-17), revised after a `security-reviewer` review and one re-review; no privacy or read-only violations were found.** This document proposes how the credit view becomes an interactive dashboard for 0.11.0, including WP12 (results summary) and WP14 (cycle recap to share). It approves nothing by itself. Implementation starts only after the maintainer approves this design, and each phase in section 9 lands as its own PR with a mandatory `security-reviewer` review. Scope comes from [path to 1.0](path-to-1.0.md) and the ROADMAP entry "1.0 killer features".

## 1. Goals

- **Explore, don't just read.** Hover or focus the usage chart to see each plotted update; compare this cycle with the last one; see today's pace.
- **Act in place.** Answer the Cost Advisor questions in the view; export your own history; share a cycle recap.
- **Feel alive.** The view updates in place when new data arrives, keeping scroll position, open sections and focus.
- **Show results honestly** (WP12): what you excluded and how your observed use changed, from known facts only.
- **Make it shareable** (WP14): a good-looking recap card at the end of each cycle, previewed before anything leaves the editor.

## 2. Non-goals

- No network access from the view, no remote fonts, images or analytics.
- No new data sources: only what the extension already reads (account snapshots through `history()`, forecast, Cost Advisor answers, the audit summary). Nothing scans raw store data outside `history()`.
- No estimated "saved credits" figure.
- No writing of workspace or settings files, and no writes among Kiro-owned files (section 5.4).
- No framework dependency.

## 3. Where we start

- `present()` in `src/extension/presentation.ts` renders the whole view as static HTML. The CSP is `default-src 'none'; style-src 'unsafe-inline'`, and the webview is created with `enableScripts: false`.
- Actions are command links limited by `enableCommandUris` to four commands (`costAdvisor`, `auditWorkspace`, `audit.show`, `share`).
- Each render replaces `webview.html` when it changed, which resets scroll and focus. The controller refreshes every minute.
- The chart (`src/extension/chart.ts`) is static SVG with `role="img"`. A table with the same data sits in "Advanced details". Both thin out points when there are many.
- The Cost Advisor asks up to four native questions (`reviewAdvisor` in `advisor-inputs.ts`). Answers live only in memory (`AdvisorInputs`, with an epoch ticket).

## 4. Architecture

### 4.1 Static first, script as enhancement

- **`present()` stays script-free.** It renders every figure, including the new comparison, pace and results lines (section 6), as static HTML.
- **A separate shell function** wraps that output with the CSP, the nonce'd style block and the nonce'd script. Most existing static tests keep testing `present()`. The tests that assert "no `<script>`", the old CSP or `enableScripts: false` change on purpose, in phase 6a.
  - Those tests are listed in the review: presentation.test.ts, chart.test.ts, advisor-bundle.test.ts, cost-extension.test.ts and cost-advisor.test.ts.
- **Command links stay.** `enableCommandUris` keeps exactly the four commands, so "Open Cost Advisor", "Check now", "Show" and "Share" work with or without the script. There is no `run` message.
- **The four command handlers themselves** run one at a time with a 2 s cooldown, whatever triggers them. This holds even if a script could fire links by synthetic clicks.
- **No stale static view.**
  - The extension keeps replacing `webview.html` on every changed render **until the script of the current document has sent `ready`**. Each assigned document carries a load counter (a plain number, not secret), and only `ready { load }` with the current counter counts.
  - After that, the script acknowledges each model version with `ack { version }`. Without an acknowledgement within 5 seconds, the extension falls back to replacing the HTML.
  - From then on it sends live updates by message.
  - On reveal, and whenever a message cannot be delivered, it sets the HTML again.
  - The "Fresh"/"Stale" label is computed in the static HTML, so a page without a running script is never older than the last render.

### 4.2 Script delivery and CSP

- **Inline, not a file.** The dashboard script is built by a second, deterministic esbuild stage with a pinned version and no `sourceMappingURL`. It is embedded as a string in `dist/extension.cjs` and injected as one inline `<script nonce>`. Nothing new is packaged, so the VSIX allowlist and its verifier stay exactly as they are.
  - The webview code gets its own DOM-lib tsconfig covered by `pnpm typecheck`.
  - Optionally, the release verifier also rejects `fetch`, `XMLHttpRequest`, `WebSocket`, `eval` and `Function(` in that string.
- **Nonce per document load, not per render.**
  - A 128-bit nonce from `crypto.randomBytes` is created when HTML is actually assigned to the webview.
  - The "identical HTML is not set again" check compares the HTML with the nonce removed. This keeps the every-minute refresh from rebuilding the page.
- **CSP:** `default-src 'none'; script-src 'nonce-N'; style-src 'nonce-N'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; require-trusted-types-for 'script'; trusted-types 'none'`.
  - **No `style=` attributes anywhere.** Nonces do not apply to them, so the usage bar becomes an SVG `<rect>` with a `width` attribute; other widths use fixed classes.
  - A test asserts the output contains no `style=`.
- **Webview options:**
  - `enableScripts: true`, `localResourceRoots: []`, `enableCommandUris` with the same four commands.
  - **`retainContextWhenHidden: false`**, and **no `WebviewPanelSerializer`**.
  - `ready` always gets the current model, because messages to a hidden panel are lost.
- **Script rules.**
  - No `eval`, `new Function`, `innerHTML` or `insertAdjacentHTML`; Trusted Types enforce this.
  - The script never creates anchors and never sets `href`, `xlink:href`, `src` or `on*` from data, and never uses `<a download>`.
  - It keeps the `acquireVsCodeApi()` result in a closure.
  - It validates the model's shape before using it.
- **`vscode.setState`** may hold UI state only: open sections, scroll, the selected chart point. Never view-model values and never Cost Advisor answers or half-filled form values; persisting answers needs separate approval.

### 4.3 Data to the view

- **One typed view model.** A pure function next to `present()` builds a single JSON object. It contains only billing-derived numbers, fixed codes, ISO timestamps with their as-of labels, pre-formatted labels, and the user's own in-memory Cost Advisor answers for this session (including add-on credits they typed). It never contains paths, identifiers, partition keys or raw log text.
- **The model is delivered only by message.** The script sends `ready`, and the extension answers `{ type: 'model', version: 1, model }`. There is no embedded JSON block, which removes one injection surface.
- **Updates only when the model changes.** The model is sent only when it differs from the last one sent, not every minute.
- **Schema version.** An old script ignores a model version it does not know and leaves the static content in place.

### 4.4 Messages from the view

The webview is untrusted. One function, `acceptMessage(raw)`, dispatches through a `Map` of handlers, so prototype keys can never match. Every field is checked with `typeof` before anything happens:

| Type | Payload | Effect |
| --- | --- | --- |
| `ready` | `{ load }` | Accepted only for the current document load; sends the current model. |
| `ack` | `{ version }` | Confirms the script rendered that model version; otherwise HTML replacement resumes. |
| `advisorSubmit` | `{ ticket, plan, billing, addOns, addOnCredits }` | See section 5.3. Answers with `advisorResult` (`ok`, `stale` or `invalid`). |
| `exportCsv` | none | Section 5.5. |
| `saveRecapImage` | `{ png }`: base64, at most 2 MB | Section 5.4. |
| `copyRecapText` | none | The extension builds the fixed recap text and puts it on the clipboard. |

Limits:
- Plain objects only, a known `type`, no extra keys, string length caps (4 KB, except the PNG).
- **One of each type in flight:** a new one is ignored while the previous one runs or its save dialog is open.
- **A cooldown of 2 s per type** after completion.
- **Overall at most 10 messages per second.** The size caps apply after deserialisation, so a small amount of memory pressure from a hostile script remains.
- The script sends action messages only from trusted user events (`event.isTrusted`). This is defence in depth, not a security boundary.
- Unknown or invalid messages are ignored.
- Diagnostics gain one fixed counter of rejected messages, never their content. **This changes the diagnostics output contract** and is listed in the phase 6a PR.

### 4.5 Threat model

- **Data injection.** Log values could contain markup. Mitigations:
  - a model of billing-derived typed values only;
  - `textContent` only, enforced by Trusted Types;
  - nonce-only `script-src` and `style-src`;
  - no inline handlers, and no anchors or URLs built from data.
- **A buggy or compromised script.**
  - It can trigger only the four commands it already has as links, whose handlers are themselves one-at-a-time with a cooldown, plus the messages above, with in-flight and cooldown limits.
  - File writes need a save dialog the user confirms, and they pass the guards in 5.4.
  - The clipboard text is built by the extension.
- **Exfiltration.**
  - `connect-src`, remote images, `form-action` and `frame-src` are blocked by the CSP.
  - The CSP does not govern the editor's own handling of clicked links. Because no anchors or URLs are built from data, there is nothing to carry data out.
  - Whether Kiro and VS Code act on synthetic clicks is checked natively.
  - Nothing in the model is secret.
- **Denial of service.** Rate and in-flight limits, size caps, the existing 750 ms change debounce, and updates only on change.

## 5. Interactive parts

### 5.1 Chart with hover and keyboard (WP6)
- **Accessible structure.** The chart becomes a group (`role="group"` with a label) instead of `role="img"`, so its points are exposed. It is one tab stop with a roving tabindex: arrow keys move between **plotted** updates; the chart still thins points.
- **Tooltip.** Focus or hover shows the date and time, the usage, and the change since the previous update.
  - The change follows the interval status: across an adjustment, a limit change or a cycle boundary it says "not comparable" instead of subtracting.
  - The tooltip stays while hovered and closes with Escape (WCAG 1.4.13).
- **Static alternative.** The existing table stays the screen-reader alternative, referenced with `aria-describedby`.

### 5.2 Live headline
- One polite `aria-live` region announces only the headline figure when it changes.

### 5.3 Inline Cost Advisor form (WP6)
- **One shared validator.** A pure function serves both the native pickers and the form. It covers the plan, billing and add-on sets, `parseAmount`, the Enterprise+Free rule, and "Clear my answers".
- **Ticket.**
  - `AdvisorInputs` gains a read-only epoch getter for the model.
  - On submit, the extension refreshes, checks the ticket against the current epoch, commits, and bumps the epoch on commit, so a replayed submit is stale.
  - The ticket guards against stale submits only; it is not authentication.
  - The form keeps the ticket from when editing started. A model with a new epoch while the form has unsaved edits shows "These answers changed or were reopened elsewhere; review and submit again". A cancelled native picker also makes the ticket stale; that is safe, and the wording covers it.
- **Replies.**
  - `stale` makes the form say "Your answers changed elsewhere; review and submit again".
  - `invalid` marks the fields with `aria-invalid` and `aria-describedby`.
  - A status live region reports the result.
- **Other effects.** Submitting counts as a completed Cost Advisor review, exactly like the native path (`onAdvisorUsed`, support signal).
- **Markup.** The form uses `fieldset` and `legend`. The native pickers stay available through the status bar item for anyone who prefers them.

### 5.4 File writes (recap image, CSV)
- **Save dialog only.**
  - The default is a fixed filename in the user's Downloads folder, falling back to the home folder when Downloads does not exist (for example with localised folder names on Linux). Never the workspace.
  - Only `file:` targets are accepted.
- **Refused targets:**
  - any path whose real location (the parent resolved, with the final name checked) is inside the Cyclegauge storage folder, the configured or default Kiro source roots, or Kiro's data folders (reusing `inside()` from `paths.ts`);
  - existing non-regular files;
  - symlinks.
- **Writing.** The data goes to a temporary file created exclusively (`wx`) in the realpath-checked target folder, which is then renamed over the target. On every platform the rename replaces a link or junction without following it. The temporary file is removed on failure.
- **Path comparison** uses `realpathSync.native` on both sides, because `inside()` is case-sensitive on macOS.
- **The Kiro folder list** per platform is written out in the 6e PR, taken from the existing source-root defaults in `paths.ts`.
- **PNG check.** The image is parsed strictly before writing:
  - the signature;
  - `IHDR` first, with exactly the fixed card size and colour type;
  - then only `IDAT` and `IEND`, with no ancillary or text chunks, so there is no metadata;
  - every CRC verified;
  - fixed bit depth, compression, filter and interlace fields;
  - exactly one `IEND` and no bytes after it, so there are no polyglot files;
  - inflation with `zlib`'s `maxOutputLength` set to the card's exact raw size, so the size cap can't become a decompression bomb.
  This guarantees only that the file is a plain image of the fixed size with no other payload. A buggy or compromised script could still send a different image of the same size.

### 5.5 CSV export (WP6, optional for 0.11.0)
- **Same account rules as the view.**
  - Export only when `history()` accepts the data: one associated account partition, not `multiple_accounts` or `unknown_account`.
  - Otherwise a fixed message explains why there is no export.
- **Columns (allowlist):** the observed time with its stored offset (and a UTC column), usage, limit, reset, and fixed flag codes including `assumed_source_timezone`.
- **Values.**
  - Decimal strings are copied exactly, never through `Number()`.
  - Unknown values are written as `unknown`, never as 0.
- **No formula injection** by construction: only regex-validated numbers, ISO times and fixed codes, never free text.
- **Conflicts.** Same-time conflicting snapshots are exported with a conflict flag rather than dropped or picked.
- **No identifiers.** No partition keys.
- **Format:** UTF-8 with a header row.

## 6. Data definitions (rendered in the static HTML too)

All values come from `history()` evidence. Each is labelled with its as-of time and shown as "not observed" or "not comparable" when the evidence does not support it. Nothing is interpolated or invented.

### 6.1 Cycle comparison (WP6)
- **Shown only when both cycles have an evidence-backed start.**
- **Offset.** It is measured from the last observation of the current cycle, not from the wall clock: "at 12 d 4 h into the cycle".
- **Previous-cycle value.** The last observed usage at or before the same offset, accepted only if it was observed within 2 hours of that offset. Otherwise the line shows the two bracketing observations with their times.
- **Labels.** Both values carry as-of labels.
- **"Not comparable"** when either cycle has a counter adjustment, a limit change or a conflict. The history's evidence window (85 days) stops at limit changes, reset unknowns and extra-credit flags, so the line is often unavailable, and says so.

### 6.2 Today's pace (WP6)
- Always labelled as the **UTC day**, with the start observation's time: "UTC day so far, since 00:40 UTC: 45 credits".
- Requires the same `resetAt` and comparable intervals.
- **Elapsed time always shown:** "over 2 h 10 min".
- **Allocation as context only.** "The 24-hour allocation as of the last update (328.7 credits)" is shown only when the observed window covers at least 18 hours of the UTC day, with no verdict and no proration. It is not a calendar-day amount.
- Never extrapolated.

### 6.3 Your Cyclegauge summary (WP12)
- **Excluded**
  - The size and number of findings excluded from Kiro, and how many were possible secrets.
  - Counted when a prepared Exclude edit is saved; a re-addition can be counted twice, so it is labelled "exclusions you saved".
  - It is not a current-exposure figure.
  - Sizes of pruned folders are unknown and show as "at least" or as a count with unknown size, never as zero.
- **Observed use trend**
  - The net change per observed day over the last 28 days, compared with the 28 days before.
  - Both windows come from evidence intervals within the 85-day evidence window, and each needs at least 70 % of its time covered by comparable intervals.
  - Worded as an observation whose cause is open.
  - Replaces the infeasible "first 14 days with Cyclegauge" baseline.
- **Plan change: not in 0.11.0.** `history()` stops its evidence at a limit change and does not keep the old limit, so a plan change cannot be shown without a change to the history core, and §2 rules out reading raw store data instead. A small reviewed `history()` extension (for example `evidence.limitChange: { at, from, to }`) is a possible later step and would need its own approval as a core contract change.
- **Heading.** The summary is headed "Your Cyclegauge summary", not "results", so nothing claims that Cyclegauge caused a change.
- **Which cycle.** Exclusions are counted under the current observed cycle. When no cycle is observed (outside Kiro or before any data), they are not counted. The summary covers at most the current and previous cycle and says so.

### 6.4 Cycle recap to share (WP14)
- **When.** The first time a new cycle is observed and the previous cycle has an evidence-backed start and end, a dismissible **"Your Kiro cycle"** card appears.
- **Contents:**
  - credits used of the limit;
  - **lasted until the reset: yes, no or unknown**. *No* means usage at or above the limit was observed in that cycle. *Yes* means usage below the limit was observed within 6 hours before the reset. *Unknown* covers everything else;
  - the observed use trend against the cycle before (or "not comparable");
  - exclusions saved in that cycle (from 6.3's per-cycle values);
  - the busiest UTC day, labelled "busiest observed day (partial observation)";
  - the Open VSX link as text, which can be switched off.
- **Never included:** no identifiers, paths or workspace names.
- **Rendering.**
  - The script draws the card on a `<canvas>` in brand colours that meet 4.5:1 contrast, and shows the image as a preview first.
  - Buttons: **Save image…** (`saveRecapImage`) and **Copy text** (`copyRecapText`). The text is also the image's full text alternative.
  - Direct image-to-clipboard is not used, because support differs between editors.

## 7. New persisted state (needs approval)

Each item is its own versioned globalState key. A value with an unknown or newer shape is treated as unknown and never overwritten. None is registered for Settings Sync (`setKeysForSync` is not used). Nothing contains paths or identifiers.

- **`cyclegauge.results.v1`:** per-cycle exclusion aggregates for at most the current and previous cycle, `{ cycle, bytes, bytesLowerBound, items, secrets }[]`.
- Both keys are cleared by an explicit reset command (like `support.reset`), so a malformed value can't disable a feature for good.
- **`cyclegauge.recap.v1`:** `{ cycle, state: 'shown' | 'dismissed' }` for the last recap. It is kept separate from `cyclegauge.budgetWarning.v1`, because that key's writer rebuilds only `{ cycle, done }` and would drop a folded-in flag.

## 8. Accessibility (targets, verified natively)

- Everything works by keyboard, with a visible `--vscode-focusBorder` outline and a logical tab order. The chart is one tab stop with arrow-key navigation.
- Hover content is also available on focus, stays while hovered and closes with Escape.
- The form has fieldsets and legends, field errors tied with `aria-invalid` and `aria-describedby`, and a status live region.
- `prefers-reduced-motion` disables transitions, and `forced-colors` uses system colours.
- The native check of the 0.11.0 candidate covers keyboard use plus VoiceOver (macOS) and NVDA (Windows) on the chart, the form and the recap.

## 9. Testing

- **Pure functions in Node unit tests:** the view-model builder, `acceptMessage` (hostile inputs for every type, including prototype keys, in-flight and cooldown), the nonce and CSP shell, HTML comparison without the nonce, the shared Advisor validator and ticket semantics, the cycle comparison, the pace, results and recap definitions (including every "not observed" and "not comparable" case), CSV formatting and the account rules, the PNG validator, and the file-target guards.
- **The script** is split into pure render helpers, testable in Node with a minimal DOM stub, and a thin wiring layer.
- **Packaged tests** with a webview mock extended by `postMessage` and `onDidReceiveMessage`:
  - the CSP and nonce are present, and the nonce is stable across unchanged renders and new per document load;
  - there is no `style=` attribute;
  - the four command links still work;
  - the HTML is replaced until `ready` and on reveal;
  - each allowed message works and each invalid one is ignored;
  - export and save write only after a dialog and refuse guarded targets.
- **Native check before 0.11.0** in Kiro on macOS, Windows and Ubuntu:
  - scripts and the CSP, including Trusted Types. If the two Trusted Types directives break the editor's own injected code, dropping only them does not reopen approval; the `textContent`-only rule and its tests remain;
  - the editor's default styles and theme variables under nonce-only `style-src`;
  - synthetic clicks;
  - keyboard and screen readers (section 8).

## 10. Phases and reviews

Every phase has a mandatory `security-reviewer` review. Implementation is by `implementer-senior` (Sonnet); mechanical docs by `implementer` (Haiku).

| Phase | Content | Blocking items it must satisfy |
| --- | --- | --- |
| 6a | Shell with nonce CSP and Trusted Types, no `style=` attributes, the model by message, `acceptMessage` with `ready` only, live updates with "HTML until ready", HTML comparison without the nonce, the diagnostics counter. No visible new feature. | 4.1, 4.2, 4.3, 4.4 |
| 6b | Chart hover and keyboard, live headline, cycle comparison, today's pace (also static). | 5.1, 5.2, 6.1, 6.2, 8 |
| 6c | Inline Cost Advisor form with the shared validator and ticket. | 5.3 |
| 6d | Results summary, with `cyclegauge.results.v1` hooked into the saved-Exclude path. | 6.3, 7 |
| 6e | Cycle recap card, image save, copy text, CSV export, with `cyclegauge.recap.v1`. | 5.4, 5.5, 6.4, 7 |

## 11. Questions for the maintainer

1. **Enable scripts in the credit view** with the CSP, message protocol and limits above? This is the new trust boundary.
2. **Approve the two new keys** in section 7.
3. **CSV export** in 0.11.0, or later?
4. **Recap sharing** as "Save image…" plus "Copy text", without direct image copy? This changes WP14's "Copy as image".
5. **Changed WP12 definitions:** the 28-day observed comparison replaces "first two weeks with Cyclegauge", and the plan-change line is dropped for 0.11.0 (§6.3). After approval, `docs/path-to-1.0.md` is updated to match.
