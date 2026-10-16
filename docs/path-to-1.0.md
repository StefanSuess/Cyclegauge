# Path to Cyclegauge 1.0

Status: **proposal for maintainer decision (2026-10-17).** This document grants no implementation, contract-change, outreach, merge, tag, release or publication approval. Each work package (WP) below needs its own explicit scope approval, as [AGENTS.md](../AGENTS.md) requires. It builds on [#74](https://github.com/StefanSuess/Cyclegauge/issues/74) and [#71](https://github.com/StefanSuess/Cyclegauge/issues/71).

**Direction:** value first, shipped fast. Build the credit-saving workspace/ignore audit (#71 Capability A) **first**, test it quietly with a few users in a 0.9.x beta, and announce publicly only with **1.0.0**, the first stable release (no stable 0.8). Stabilisation work is limited to what keeps the extension *working* for users: no lost history on upgrade, no crash on an unsupported runtime, a quick fix when Kiro changes its logs, and a stable release channel.

**Launch strategy:** one strong public launch, not several weak ones. Before 1.0, feedback comes only from a small invited group (no public posts). The public announcement, write-up and demo come with 1.0, when the extension both counts *and* helps save credits.

**Speed:** the audit has a time limit of about four weeks of focused work from WP0 approval to the 0.9.0 beta. If it is not solid by the end of the beta, 1.0 ships without it and the audit moves to 1.1. Heavy review (`security-reviewer`) is reserved for storage, workspace/source reading and release changes; docs and UI changes go straight to a PR after the normal checks.

## 1. Where Cyclegauge stands

Observed on 2026-10-16/17 (recheck before acting):

| Area | State | Gap for 1.0 |
| --- | --- | --- |
| Product | Status bar, detail view, qualified forecasts, trajectory chart, Cost Advisor, CLI. Over 200 synthetic unit tests, an 80 % line-coverage gate, three-OS extension-host CI. | A good credit gauge, but Kiro already sends its own usage notifications. Nothing helps users *spend fewer* credits yet. |
| Distribution | 0.7.0 on Open VSX as **pre-release only** (`preview: true`); about 830 downloads, 0 GitHub stars. | No stable channel. |
| Release pipeline | Build-once candidate, payload reproducibility, SLSA attestation, protected manual promotion. | Hard-wired to pre-release: `VSIX_NOT_PRERELEASE`, `ovsx publish --pre-release`, GitHub `prerelease: true`, odd-minor test. |
| Storage | `meta.version` must equal `1`, otherwise `STORAGE_UNAVAILABLE`. No migration path. One `imports` evidence row is appended on every collection (minute poll) and never pruned. 0.7.0 moved the default location and history restarted. | The first schema change would make every user's store unavailable; the store grows without bound. |
| Runtime | `src/store.ts` statically imports `node:sqlite`; bundle targets Node 24; `engines.vscode: ^1.90.0` is not a tested minimum. | An older Kiro without `node:sqlite` fails at activation instead of showing a clear message. |
| Source format | Kiro's log format is undocumented and can change with any Kiro release. | No per-Kiro-version fixtures; the bug template asks for a "Show Diagnostics" output that no command produces. |
| Platforms | macOS beta (Kiro 1.2.56); Windows 11 and Ubuntu 26 smoke-tested; RHEL, macOS Intel unverified. | Smoke tests on the 1.0 candidate are enough; full itemised acceptance (#61) is optional. |
| Docs | `SPEC.md` still says "0.5.2 candidate", `ROADMAP.md` "Current release 0.5.1"; `release-process.md` says the Open VSX namespace is unverified, but the registry now reports it verified. | Outdated status text. |
| Advisor catalog | `verifiedOn: 2026-10-10`; `catalog_review_due` triggers after 30 days (from 2026-11-09). | Review before each release so prices shown are current. |

## 2. Why features in 1.0, and which stabilisation still matters

**Usefulness drives adoption.** A plugin that tells users something they can act on gets installed, recommended and supported. A gauge alone overlaps with Kiro's own usage alerts. The workspace audit gives Cyclegauge a result on day one (no forecast history needed): "these large files are not ignored and may end up in the agent's context; here is a `.kiroignore` snippet". That is the most tangible step from a *credit gauge* to a *credit saver*.

**Why Capability A and not more of #71:** it is the smallest slice that reads no file contents except ignore configuration, needs no session parsing and gives an immediate result. Hook/Steering review (Capability B) and session attribution (Capability C) follow in 1.x.

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
- **Donations:** keep the existing Ko-fi links; no pop-ups, paywalls or telemetry. Donations follow usefulness; expect modest amounts (#74 cites Prettier and ESLint figures).
- **Measure** with public numbers only: Open VSX downloads, GitHub stars, issues and feedback from real users.

## 4. Ordered work packages

Risk follows [the agent workflow](agent-workflow.md): **high-risk** WPs (storage, workspace or source reading, release/CI) need the `security-reviewer` before a PR. "Gated" means the WP changes a contract that AGENTS.md says requires separate maintainer approval.

### Phase 0 — Decide (maintainer, no code)

**WP0 Scope.** Record in `ROADMAP.md`: 1.0 = current features + workspace/ignore audit (#71 A) on macOS, Windows and Ubuntu; first stable version is 1.0.0; Capabilities B–D are 1.x. Approve the audit's read allowlist (ignore files and the `kiroAgent.agentIgnoreFiles` setting only) and limits (entries, depth, time) as #71 and #74 Stage 2 describe.

### Phase 1 — The credit-saving feature first (high risk, gated)

**WP1 Audit Kiro Workspace.** One explicit command; nothing runs until invoked. Pick one trusted local root; enumerate bounded path/type/size metadata; evaluate `.kiroignore` and enabled ignore files with unknown states where rules cannot be established; flag large dumps, archives, logs and build output that are not ignored; show a script-free report with a copyable `.kiroignore` snippet. No auto-edit, no persistence, no network. New code lives in `src/audit/` plus a presenter; it must not depend on billing data, and billing must not depend on it. Build on the WP0 limits and #74's synthetic test list. Split into reviewable PRs: (a) bounded metadata walker, (b) ignore evaluation, (c) findings and report UI. Agent: `implementer-senior`; review: `security-reviewer`. Time limit: about four weeks to the 0.9.0 beta.

### Phase 2 — Keep it working (in parallel with Phase 1, disjoint files; high risk, gated)

**WP2a Storage version ladder and pruning.** Ordered migration list (initially empty) with a transactional upgrade; a store from a newer version is refused with a fixed code, without changes. Prune `imports` evidence (for example: write only when codes change, or keep 30 days). Snapshot rows untouched. Synthetic tests for each case. Agent: `implementer-senior`; review: `security-reviewer`.

**WP2b Runtime guard.** Load `node:sqlite` so its absence shows "unsupported Kiro version" instead of an activation error; set `engines.vscode` to the oldest Kiro actually checked. Agent: `implementer-senior`; review: `security-reviewer`.

**WP2c Format drift.** One synthetic fixture per observed Kiro log variant, and **Cyclegauge: Copy Diagnostics** (plus CLI `--diagnostics`) printing fixed codes, counts and versions only. This also makes the bug template accurate. Agent: `implementer-senior`; review: `security-reviewer`.

**WP2d Outdated docs.** `SPEC.md` and `ROADMAP.md` status lines, namespace status in `release-process.md` (recheck the registry), #71's stale "0.7.0 freeze" note. Agent: `implementer` (Haiku). Check: `git diff --check`.

### Phase 3 — 0.9.0 beta, quiet (maintainer)

**WP3** Publish 0.9.0 (pre-release) with WP1 and WP2. Invite 5–10 Kiro users personally (outreach approved by the maintainer); no public announcement yet. Record installs, first useful result, findings acted on and confusing results. Fix what they hit in 0.9.x patches. At the end of the beta decide: keep, simplify or drop the audit for 1.0. Smoke-test the candidate on macOS, Windows and Ubuntu.

### Phase 4 — Listing and launch material (low risk, during the beta)

**WP4** Short README top for the Open VSX listing (what it does, the audit, privacy in one line, a synthetic GIF); pricing-catalog review step in `release-runbook.md`; a short upgrade section in `docs/usage.md` listing what 1.x keeps stable (command IDs, setting keys, CLI JSON fields, storage location). Draft the launch write-up with synthetic data. Agent: `implementer` (Haiku).

### Phase 5 — Stable channel (high risk, gated, maintainer approval; can start during the beta)

**WP5a** Derive "pre-release" from the minor version in one place (odd = beta, even = stable, so 1.0.x is stable) and use it in `package.json` `preview`, `ci.yml` build and verify flags, `promotion-policy.ts`, `release-state.ts` (`ovsx publish` flag, GitHub `prerelease`), `promotion-state.ts` and `version-consistency.test.ts`. Keep attestation, build-once, reproducibility and protected approval unchanged. Prove it with tests and a release-workflow dry run. Agent: `implementer-senior`; review: `security-reviewer` (mandatory).

**WP5b** Candidate filename (#72) if the reviewer agrees it fits; otherwise later.

### Phase 6 — 1.0.0 public launch

Promote when the exit criteria hold. This is the first public announcement: the write-up, the demo and posts in Kiro communities (#74 Stage 4), with outreach approved.

### After 1.0

1.1.x beta: Hook/Steering review (#71 B), then 1.2 stable. Session attribution (#71 C) stays research until its data semantics are proven.

## 5. 1.0 exit criteria

- [ ] WP0 scope recorded.
- [ ] Storage upgrade ladder, newer-store refusal and evidence pruning tested.
- [ ] Unsupported runtime shows a clear message; oldest checked Kiro recorded.
- [ ] Copy Diagnostics exists and prints no values, paths or identifiers.
- [ ] Workspace audit shipped in 0.9.x within its time limit, used by the invited testers, and kept, simplified or dropped based on their results.
- [ ] Stable channel proven by tests and a release dry run.
- [ ] At least one 0.9.x beta with no open crash or data-loss bug for 14 days; upgrade from 0.7.x keeps history.
- [ ] Smoke test of the exact 1.0 candidate on macOS, Windows and Ubuntu; pricing catalog reviewed within 30 days.
- [ ] Existing gates green: `pnpm typecheck`, `pnpm test`, coverage, `pnpm test:release`, three-OS host tests, attestation, macOS acceptance A/B/D/E.

## 6. Execution model

Use the agents in `.claude/agents/` with an orchestrator, implementer, reviewer loop:

| Role | Agent | Model / effort | Used for |
| --- | --- | --- | --- |
| Orchestrator | `release-orchestrator` (main thread: `claude --agent release-orchestrator`) | Opus, high | Picks the next approved WP, writes the brief, delegates, reviews the diff, runs checks, commits, opens the PR. Never merges, tags or publishes. |
| Mechanical implementer | `implementer` | Haiku, medium | WP2d, WP4 and other docs or mechanical edits. |
| Code implementer | `implementer-senior` | Sonnet, high | WP1, WP2a–c, WP5. |
| Reviewer | `reviewer` | Sonnet, high | Moderate-risk diffs. |
| High-risk reviewer | `security-reviewer` | Opus, high | Mandatory for WP1, WP2a–c, WP5 (workspace reading, storage, diagnostics, release). |

One implementer at a time per file set; one review per diff, plus at most one re-review after fixes. Delegates never commit, push or delegate further.
