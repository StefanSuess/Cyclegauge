# Path to Cyclegauge 1.0

Status: **approved by the maintainer on 2026-10-17 (WP0); release sequence updated 2026-10-17: 0.9.0 beta → 0.11.0 beta → 0.13.0 beta → 1.0.0 stable; 1.0 scope extended to a feature-complete vertical slice on 2026-10-17 (see ROADMAP "1.0 killer features").** Beyond the recorded [ROADMAP](../ROADMAP.md) decisions, this document grants no implementation, contract-change, outreach, merge, tag, release or publication approval. Each work package (WP) below needs its own explicit scope approval, as [AGENTS.md](../AGENTS.md) requires. It builds on [#74](https://github.com/StefanSuess/Cyclegauge/issues/74) and [#71](https://github.com/StefanSuess/Cyclegauge/issues/71).

**Direction:** value first, shipped fast. Build the credit-saving workspace/ignore audit (#71 Capability A) **first**, test it quietly with a few users in a 0.9.x beta, add the interactive dashboard in a **0.11.0** beta (the last feature beta), and announce publicly only with **1.0.0**, the first stable release (no stable 0.8 or 0.10). 1.0.0 adds no new features. Stabilisation work is limited to what keeps the extension *working* for users: no lost history on upgrade, no crash on an unsupported runtime, a quick fix when Kiro changes its logs, and a stable release channel.

**Launch strategy:** one strong public launch, not several weak ones. Before 1.0, feedback comes only from a small invited group (no public posts). The public announcement, write-up and demo come with 1.0, when the extension both counts *and* helps save credits.

**Speed:** the audit has a time limit of about four weeks of focused work from WP0 approval to the 0.9.0 beta. If it is not solid by the end of the beta, 1.0 ships without it and the audit moves to 1.1. Heavy review (`security-reviewer`) is reserved for storage, workspace/source reading and release changes; docs and UI changes go straight to a PR after the normal checks.

## 1. Where Cyclegauge stands

Status refreshed on 2026-10-18 from `main` (merge history) and `gh release list` (recheck before acting). **No release has been cut since 0.7.0**: it is still the last published release (pre-release only on Open VSX and GitHub). Everything below marked "merged" is on `main` but unreleased; the 0.9.0, 0.11.0 and 0.13.0 betas have not been published.

| Area | State | Gap for 1.0 |
| --- | --- | --- |
| Product (merged) | Status bar, detail view, qualified forecasts, trajectory chart, Cost Advisor, CLI. Added since 0.7.0: workspace audit with native view, Accept/Ignore, reminders, automatic modes and name patterns (WP1a–h: #76, #77, #78, #85, #86, #87, #89, #90, plus #94–#96), audit size total (WP1i, #101), budget warning and modelled overage cost (WP7, WP8: #98), plan right-sizing hint and next-plan list prices (WP8b: #99), first-minute walkthrough (WP15: #100), interactive dashboard in five phases with cycle recap, results summary, CSV export and guarded image save (WP6a–e, including WP12 and WP14: #104–#108), session hints, i.e. context reminder and model hint (WP11, WP13: #116). | Hook and Steering review (WP10) is in progress: reader and parsers merged (WP10a, #117), findings evaluation merged (WP10b, #118); the remaining parts are in progress. Nothing in this column has had a release, security-review sign-off for WP11/13 or native acceptance unless a PR says so. |
| Distribution | 0.7.0 on Open VSX and GitHub as **pre-release only** (`preview: true`); about 830 downloads, 0 GitHub stars at the last check. | No stable channel published yet; WP5a derives the channel from the version (see Release pipeline). No 0.9.0, 0.11.0 or 0.13.0 beta has been published. |
| Release pipeline | Build-once candidate, payload reproducibility, SLSA attestation, protected manual promotion. | No longer hard-wired (WP5a): the channel is derived from the minor number in `scripts/release/channel.ts` (odd = pre-release, even = stable) and used by CI, verification, promotion and publishing. The stable path still awaits a dry run on an even version. |
| Storage | Schema version ladder with refusal of newer stores, and bounded evidence pruning (WP2a, #80). | None known; upgrades from 0.7.x, 0.9.x and 0.11.x still need the native upgrade test from the exit criteria. |
| Runtime | `node:sqlite` is loaded lazily and an unsupported runtime shows "update needed" instead of an activation error (WP2b, #81). `engines.vscode` is still `^1.90.0`. | The oldest actually checked Kiro is not yet recorded; `engines.vscode` is not a tested minimum. |
| Source format | Kiro's log format is undocumented and can change with any Kiro release. **Cyclegauge: Copy Diagnostics** and CLI `--diagnostics` have merged (WP2c, #82) and the bug template points to them. | Only one Kiro log variant has been observed so far, so there are no per-Kiro-version fixtures yet. |
| Platforms | macOS beta (Kiro 1.2.56); Windows 11 and Ubuntu 26 smoke-tested for 0.7.0; RHEL, macOS Intel unverified. | Smoke tests on the 1.0 candidate are enough; full itemised acceptance (#61) is optional. Native tests of the new features are still open. |
| Docs | Status lines were refreshed in WP2d (#79) and again on 2026-10-18; the Open VSX namespace is reported verified. README top and the `docs/usage.md` upgrade section (WP4) are deliberately left until WP10 lands; launch drafts live in `docs/launch/` and are unpublished. | WP4 listing text and the launch itself need maintainer approval. |
| Advisor catalog | `verifiedOn: 2026-10-18` (re-reviewed, values unchanged); `catalog_review_due` triggers after 30 days (from 2026-11-17). | Review before each release so prices shown (WP8, WP8b) are current. |

## 2. Why features in 1.0, and which stabilisation still matters

**Usefulness drives adoption.** A plugin that tells users something they can act on gets installed, recommended and supported. A gauge alone overlaps with Kiro's own usage alerts. The workspace audit gives Cyclegauge a result on day one (no forecast history needed): "these large files are not ignored and may end up in the agent's context; here is a `.kiroignore` snippet". That is the most tangible step from a *credit gauge* to a *credit saver*.

**1.0 is a vertical slice with a "wow" factor (maintainer decision, 2026-10-17).** Not everything has to be perfect, but 1.0 should show the whole idea: Cyclegauge warns before credits run out, shows what overages would cost in dollars, shows the pace and the trend against the last cycle, finds files Kiro does not need (with their total size), and reviews Hooks and Steering for avoidable credit use. The workspace audit (Capability A) came first because it reads no file contents except ignore configuration and gives an immediate result. Hook/Steering review (Capability B, plus the Steering part of Capability A) is now part of 1.0. Session attribution (Capability C) stays research until its data semantics are proven.

**Stabilisation that stays on the 1.0 path** is about the plugin delivering, not about ceremony:

1. **Storage upgrade path.** Without it, the first post-1.0 schema change locks every user out of their history.
2. **Bounded store growth.** A minute-by-minute evidence row with no pruning eventually slows refreshes.
3. **Clear runtime message.** A crash at activation looks like "the plugin is broken".
4. **Format-drift readiness.** When Kiro changes its logs, the gauge goes blank; fixtures and a diagnostics command turn that into a fast patch.
5. **Stable channel.** Without it, there is no 1.0.

**Dropped from the critical path:** a stable 0.8 dress rehearsal (replaced by release-workflow dry runs and tests), a separate compatibility document (a short section in `docs/usage.md` is enough), full itemised platform acceptance, and #59, #60, #62, #63, #64 unless a user hits them.

**Remaining risk:** the audit's value is not yet validated with users. The 0.9.x beta handles this: ship it, ask a handful of users, then cut, simplify or keep it before 1.0. The project rules in AGENTS.md still apply to the audit (no file contents beyond ignore configuration, nothing sent anywhere, Kiro files read-only). They are a scope boundary, not a reason to delay.

## 3. Goals: credibility and donations

- **Credibility:** a stable 1.0 that saves users credits, plus a short public write-up with a synthetic demo, is the portfolio piece.
- **Donations:** Ko-fi links plus the approved community prompts (ROADMAP "Community prompts", 2026-10-17: a quiet footer and an occasional support prompt that is easy to turn off); no paywalls or telemetry. Donations follow usefulness; expect modest amounts (#74 cites Prettier and ESLint figures).
- **Measure** with public numbers only: Open VSX downloads, GitHub stars, issues and feedback from real users.

## Release sequence (agreed 2026-10-17)

| Release | Channel | Content | Gate |
| --- | --- | --- | --- |
| **0.9.0** | Pre-release (beta) | Workspace audit (WP1a–e) with plain-language sidebar and detail-view card (WP1f), community prompts (WP1g), storage ladder, runtime guard, diagnostics (WP2). | Native macOS test of the exact candidate, then the maintainer runs the release workflow (dry run, then live). |
| **0.11.0** | Pre-release (beta) | Budget warning (WP7), overage cost projection with upgrade comparison (WP8), plan right-sizing hint (WP8b), audit size total (WP1i), results summary (WP12), shareable cycle recap (WP14), first-minute walkthrough (WP15), and the interactive dashboard (WP6) with the cycle comparison and today's pace: scripts with a nonce CSP, a validated message protocol and accessibility; chart hovers, inline Cost Advisor form, live updates. Fixes from 0.9 feedback. | WP6 design [#102](https://github.com/StefanSuess/Cyclegauge/pull/102) is approved; phases 6a–6e each need a separate PR and `security-reviewer` review. CSV export is included in 0.11.0. |
| **0.13.0** | Pre-release (beta), last feature beta | Hook and Steering review (WP10); the context/message reminder (WP11) and the model choice hint (WP13) if their evidence checks succeed. | WP10 needs its own design, explicit content-read approval and `security-reviewer` review. |
| **1.0.0** | Stable | No new features beyond 0.13.x: stable channel in the release pipeline (WP5a), native tests on macOS, Windows and Ubuntu, then the public launch (write-up, demo, community posts). | Exit criteria in section 5. |

Not in 1.0: session attribution (#71 C) and analysis of prompt or conversation content.

## 4. Ordered work packages

Risk follows [the agent workflow](agent-workflow.md): **high-risk** WPs (storage, workspace or source reading, release/CI) need the `security-reviewer` before a PR. "Gated" means the WP changes a contract that AGENTS.md says requires separate maintainer approval.

### Phase 0 — Decide (maintainer, no code)

**WP0 Scope.** Record in `ROADMAP.md`: 1.0 = current features + workspace/ignore audit (#71 A) on macOS, Windows and Ubuntu; first stable version is 1.0.0; Capabilities B–D are 1.x. Approve the audit's read allowlist (ignore files and the `kiroAgent.agentIgnoreFiles` setting only) and limits (entries, depth, time) as #71 and #74 Stage 2 describe.

### Phase 1 — The credit-saving feature first (high risk, gated)

**WP1 Audit Kiro Workspace.** One explicit command; nothing runs until invoked. Pick one trusted local root; enumerate bounded path/type/size metadata; evaluate `.kiroignore` and enabled ignore files with unknown states where rules cannot be established; flag large dumps, archives, logs and build output that are not ignored; show a script-free report with a copyable `.kiroignore` snippet. No auto-edit, no persistence, no network. New code lives in `src/audit/` plus a presenter; it must not depend on billing data, and billing must not depend on it. Build on the WP0 limits and #74's synthetic test list. Split into reviewable PRs: (a) bounded metadata walker, (b) ignore evaluation, (c) findings and report UI. Agent: `implementer-senior`; review: `security-reviewer`. Time limit: about four weeks to the 0.9.0 beta.

### Phase 2 — Keep it working (in parallel with Phase 1, disjoint files; high risk, gated)

**WP2a Storage version ladder and pruning.** Ordered migration list (initially empty) with a transactional upgrade; a store from a newer version is refused with a fixed code, without changes. Prune `imports` evidence (for example: write only when codes change, or keep 30 days). Snapshot rows untouched. Synthetic tests for each case. Agent: `implementer-senior`; review: `security-reviewer`.

**WP2b Runtime guard.** Load `node:sqlite` so its absence shows "unsupported Kiro version" instead of an activation error; set `engines.vscode` to the oldest Kiro actually checked. Agent: `implementer-senior`; review: `security-reviewer`.

**WP2c Format drift.** **Cyclegauge: Copy Diagnostics** (plus CLI `--diagnostics`) printing fixed codes, counts and versions only has shipped, which also makes the bug template accurate. A synthetic fixture per Kiro log variant is added when a new variant is actually observed; only one variant has been observed so far. Agent: `implementer-senior`; review: `security-reviewer`.

**WP2d Outdated docs.** `SPEC.md` and `ROADMAP.md` status lines, namespace status in `release-process.md` (recheck the registry), #71's stale "0.7.0 freeze" note. Agent: `implementer` (Haiku). Check: `git diff --check`.

### Phase 3 — 0.9.0 beta, quiet (maintainer)

**WP3** Publish 0.9.0 (pre-release) with WP1 and WP2. Invite 5–10 Kiro users personally (outreach approved by the maintainer); no public announcement yet. Record installs, first useful result, findings acted on and confusing results. Fix what they hit in 0.9.x patches. At the end of the beta decide: keep, simplify or drop the audit for 1.0. Smoke-test the candidate on macOS, Windows and Ubuntu.

### Phase 3b — 0.11.0 beta: interactive dashboard (high risk, gated)

**WP6** Turn the credit detail view into an interactive dashboard: scripts with a per-load nonce CSP, a validated, allowlisted message protocol between webview and extension, and keyboard and screen-reader accessibility. Features: chart hovers, an inline Cost Advisor form and live updates. Also fold in fixes from 0.9 feedback. The maintainer approved [the design](wp6-dashboard-design.md) and its five section 11 decisions on 2026-10-17: scripts, two versioned unsynced keys, CSV in 0.11.0, Save image plus Copy text, and the revised WP12 definitions. Implement phases 6a–6e as separate PRs, starting with the approved 6a shell and message transport. Agent: `implementer-senior`; review: `security-reviewer` for every phase (mandatory, webview scripts are a new trust boundary). Later dashboard features remain assigned to their respective phases. 0.13.0 remains the last feature beta before 1.0.

### Phase 3c — 1.0 killer features (scope approved 2026-10-17; each WP still needs its implementation go-ahead)

**WP7 Budget warning.** Cyclegauge speaks up before credits run out: one notice per billing cycle when the forecast says the reported limit will be reached before the reset ("At this pace your credits run out on 24 Oct, 8 days before the reset"), and when usage passes 80 % and 100 % of the reported limit; the status bar turns to a warning, then an error colour. User-level settings turn it off and set the thresholds. Uses only the existing forecast and snapshots; observations are labelled with their as-of time. Agent: `implementer-senior`; review: `reviewer`.

**WP8 Overage cost projection.** When the forecast exceeds the reported limit: "If you continue at this pace: about N credits over the limit ≈ $X at $0.04 per credit". Uses the reviewed pricing catalog (price per credit, catalog version and review date shown); labelled as a modelled scenario, not an invoice; credits and money stay distinct with decimal precision; unknown overage settings stay unknown. Shown in the detail view and, with WP7, in the warning. **Upgrade vs. overage:** next to the overage cost, the Cost Advisor's existing plan comparison shows whether a larger plan would cost less and last until the reset ("switching to Pro+ costs $20 more and lasts until the reset"), as a modelled comparison. Agent: `implementer-senior`; review: `reviewer`.

**WP8b Plan right-sizing hint.** Near the end of a cycle, when the forecast leaves a large part of the reported limit unused, and only after the same pattern in two consecutive cycles: "you will leave about 2,000 credits unused; a smaller plan would cost about $20 a month less", from the Cost Advisor's existing comparison and the reviewed catalog. Once per cycle, easy to turn off. The size threshold is deliberate: the smaller plan must cover the projected usage, so the unused part is at least the gap between the two plans. Agent: `implementer-senior`; review: `reviewer`.

**WP1i Audit size total.** The audit view and Workspace check card show the total size of the files Kiro may read but probably does not need ("about 240 MB"), as an exposure figure, never as a credit saving. Agent: `implementer`; review: `reviewer`.

**WP6 additions.** Compare cycles only with evidence-backed starts, at the elapsed offset of the current cycle's last observation. The previous value must be within two hours of that offset; otherwise show bracketing observations. Adjustments, limit changes and conflicts make the comparison unavailable. Today's pace is the observed net change within the **UTC day**, with its start time and elapsed time, never extrapolated. Show the last update's 24-hour allocation as context only after at least 18 observed hours, without a verdict or proration. CSV export of the user's own accepted `history()` evidence is included in **0.11.0**, phase 6e, with a save dialog and guarded targets. See [design sections 5.5 and 6](wp6-dashboard-design.md).

**WP12 Your Cyclegauge summary.** Count **exclusions you saved** in the observed current cycle: items, possible secrets and known bytes, with unknown pruned-folder sizes shown as a lower bound or unknown, never zero. Re-adding an exclusion may count twice; this is not current exposure. Retain at most current and previous cycle aggregates in the approved versioned, unsynced key; do not count exclusions when no cycle is observed. Compare net change per observed day over the last 28 days with the preceding 28 days, using only `history()` evidence and at least 70 % comparable time coverage in each window. Label unsupported evidence "not observed" or "not comparable", and leave the cause open. This replaces the first-two-weeks baseline. **No plan-change line in 0.11.0:** `history()` does not retain the old limit; a future core-contract extension requires separate approval. No estimated or "saved" credits. Implement in phase 6d. Agent: `implementer-senior`; review: `security-reviewer`.

**WP14 Cycle recap to share ("Your Kiro cycle").** When a new cycle is first observed, show a dismissible recap only if the previous cycle has evidence-backed start and end. Include observed credits used of the limit, comparable trend, exclusions saved in that cycle and the busiest observed UTC day labelled as partial observation. "Lasted until reset" is **no** if usage at or above the limit was observed, **yes** if below-limit usage was observed within six hours before reset, otherwise **unknown**. Preview the locally rendered card before **Save image…** (save dialog and guarded target) or **Copy text** (text built by the extension). The optional Open VSX link can be switched off. No identifiers, paths or workspace names. Use the separate approved versioned, unsynced recap key and explicit reset command; unknown/newer state shapes are not overwritten. Implement in phase 6e with CSV export. Agent: `implementer-senior`; review: `security-reviewer`.

**WP15 First-minute experience.** A short walkthrough after installation that offers the workspace check right away (a result without any history) and says when the forecast will appear, so new users see value in the first minute. Uses the editor's walkthrough contribution; nothing runs without the user's click. Agent: `implementer-senior`; review: `reviewer`.

**WP10 Hook and Steering review (#71 B and the Steering part of #71 A).** With explicit permission to read Kiro configuration text in the workspace, inspect bounded `.kiro/steering/*.md` and `AGENTS.md` (size, inclusion mode such as always vs. fileMatch vs. manual) and Kiro Hook definitions (trigger type and patterns, prompt size) without executing hooks or triggering Kiro. Flag always-included large Steering, broad or overlapping Hook triggers and hooks that start agent work on every save; suggest narrower inclusion or triggers as a reviewable preview, never written automatically. Needs its own design (exact read allowlist and limits), explicit maintainer approval for the content read, and `security-reviewer`. Agent: `implementer-senior`.

**WP11 Context/message reminder (conditional).** A reminder when a session has sent many messages or its context is nearly full. First a data proof: establish from synthetic fixtures and documentation, under AGENTS.md rules, whether Kiro's local data exposes message counts or context fill, with additive vs. cumulative semantics. Ships in 0.13.0 only if that proof succeeds and the maintainer approves the session-data access; otherwise it moves to 1.1 by documented decision. No prompt or conversation content is read or analysed.

**WP13 Model choice hint (conditional).** If the selected Kiro model can be read from a documented editor setting and Kiro publishes per-model credit multipliers, show a hint such as "your selected model uses about twice the credits of Auto per request", citing the published source and its date. First an evidence check of the setting and the multipliers; ships in 0.13.0 only if both are documented, otherwise it moves to 1.1 by documented decision.

**WP11 and WP13 combined as "session hints" (decided and implemented 2026-10-18).** Maintainer decisions: the narrow runtime read of IDE session metadata (allowlisted `modelId`, `lastModifiedAt`, `workspacePaths` and `contextUsage` events; metadata only, no aggregation, no persistence) is approved for this feature only, not as blanket authorisation for session aggregation or CLI sessions; the feature is on by default (D1) with a release-notes entry, the model table includes pattern-derived rows for models Kiro documents (D2), and the one-time in-product notice is a walkthrough step instead of a notice (D3, no new persisted key). Design, hardening criteria and evidence: [data proof](wp11-13-data-proof.md). Still open before release: `security-reviewer` review of the reader, boundary and documents, and native macOS acceptance (an Auto session, a Sonnet 4.5 session and a model switch, a multi-root workspace, the `workspacePaths` match on the real folder). If either fails, both parts move to 1.1 together.

**Order (agreed 2026-10-17).** (1) Native test of everything still open (ignore re-check, new name patterns, watcher, support prompt) and the quiet 0.9.0 beta, which the maintainer releases, so real feedback arrives while 0.11 is built. (2) In parallel, the evidence checks behind WP10, WP11 and WP13 (Kiro's documented Steering and Hook formats, local message or context data, the model setting and published multipliers), because they decide early whether those features are possible. (3) WP7 and WP8: most value, low risk, no webview; WP7 must warn *before* the limit, from the forecast, to stand apart from Kiro's own usage notifications. (4) WP15 and WP1i. (5) WP6 design including WP12 and WP14, then its implementation. (6) WP10 design, for 0.13. (7) WP5a no later than in parallel with 0.13. (8) WP4 shortly before the launch. Before 0.11 ships, review the pricing catalog against Kiro's official prices (its review falls due on 2026-11-09), because WP8 and WP8b show dollar amounts (the WP12 plan-change line is excluded from 0.11.0).

### Phase 4 — Listing and launch material (low risk, during the beta)

**WP4** Short README top for the Open VSX listing that leads with value (warnings, overage costs, the audit, Hook/Steering review; a synthetic GIF). Privacy and security are a baseline, not a selling point: at most one line; pricing-catalog review step in `release-runbook.md`; a short upgrade section in `docs/usage.md` listing what 1.x keeps stable (command IDs, setting keys, CLI JSON fields, storage location). Draft the launch write-up with synthetic data. Agent: `implementer` (Haiku).

### Phase 5 — Stable channel (high risk, gated, maintainer approval; can start during the beta)

**WP5a** Derive "pre-release" from the minor version in one place (odd = beta, even = stable, so 1.0.x is stable) and use it in `package.json` `preview`, `ci.yml` build and verify flags, `promotion-policy.ts`, `release-state.ts` (`ovsx publish` flag, GitHub `prerelease`), `promotion-state.ts` and `version-consistency.test.ts`. Keep attestation, build-once, reproducibility and protected approval unchanged. Prove it with tests and a release-workflow dry run. Agent: `implementer-senior`; review: `security-reviewer` (mandatory).

**WP5b** Candidate filename (#72) if the reviewer agrees it fits; otherwise later.

### Phase 6 — 1.0.0 public launch

1.0.0 adds no features beyond 0.13.x. Promote when the exit criteria hold, after native tests of the exact candidate on macOS, Windows and Ubuntu. This is the first public announcement: the write-up, the demo and posts in Kiro communities (#74 Stage 4), with outreach approved.

### After 1.0

A terminal status line (an opt-in status file in Cyclegauge's own storage that shell prompts can read, or a published CLI) is a candidate for 1.x and needs its own approval. Session attribution (#71 C) stays research until its data semantics are proven; the context/message reminder moves here if its data proof did not succeed before 1.0.

## 5. 1.0 exit criteria

- [x] WP0 scope recorded (ROADMAP "Path to 1.0 — scope decision" and later dated decisions, #75, #93, #97).
- [x] Storage upgrade ladder, newer-store refusal and evidence pruning tested (merged in #80 with `tests/unit/store-version.test.ts`).
- [ ] Unsupported runtime shows a clear message (merged, #81); oldest checked Kiro recorded (still open).
- [x] Copy Diagnostics exists and prints no values, paths or identifiers (merged in #82 with `tests/unit/diagnostics.test.ts`).
- [ ] Interactive dashboard (with cycle comparison and pace) shipped in 0.11.x with its security review, or deferred to 1.1 by maintainer decision.
- [ ] Budget warning, overage cost projection with upgrade comparison, plan right-sizing hint, audit size total, results summary, shareable cycle recap and first-minute walkthrough shipped in a 0.11.x beta.
- [ ] Hook and Steering review shipped in 0.13.x with its security review; context/message reminder and model choice hint each shipped or moved to 1.1 by documented decision.
- [ ] Workspace audit shipped in 0.9.x within its time limit, used by the invited testers, and kept, simplified or dropped based on their results.
- [ ] Stable channel proven by tests and a release dry run.
- [ ] At least one 0.13.x beta with no open crash or data-loss bug for 14 days; upgrade from 0.7.x, 0.9.x and 0.11.x keeps history.
- [ ] Native test of the exact 1.0 candidate on macOS, Windows and Ubuntu; pricing catalog reviewed within 30 days.
- [ ] Existing gates green: `pnpm typecheck`, `pnpm test`, coverage, `pnpm test:release`, three-OS host tests, attestation, macOS acceptance A/B/D/E.

## 6. Execution model

Use the agents in `.claude/agents/` with an orchestrator, implementer, reviewer loop:

| Role | Agent | Model / effort | Used for |
| --- | --- | --- | --- |
| Orchestrator | `release-orchestrator` (main thread: `claude --agent release-orchestrator`) | Opus, high | Picks the next approved WP, writes the brief, delegates, reviews the diff, runs checks, commits, opens the PR. Never merges, tags or publishes. |
| Mechanical implementer | `implementer` | Haiku, medium | WP2d, WP4, WP1i and other docs or mechanical edits. |
| Code implementer | `implementer-senior` | Sonnet, high | WP1, WP2a–c, WP5, WP6, WP7, WP8, WP8b, WP10–WP15. |
| Reviewer | `reviewer` | Sonnet, high | Moderate-risk diffs. |
| High-risk reviewer | `security-reviewer` | Opus, high | Mandatory for WP1, WP2a–c, WP5, WP6, WP10, WP11 (workspace or configuration reading, session data, storage, diagnostics, release, webview scripts). |

One implementer at a time per file set; one review per diff, plus at most one re-review after fixes. Delegates never commit, push or delegate further.
