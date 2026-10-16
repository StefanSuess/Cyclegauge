# Path to Cyclegauge 1.0

Status: **proposal for maintainer decision (2026-10-17).** This document grants no implementation, contract-change, outreach, merge, tag, release or publication approval. Each work package (WP) below needs its own explicit scope approval, as [AGENTS.md](../AGENTS.md) requires. It complements [#74](https://github.com/StefanSuess/Cyclegauge/issues/74) and [#71](https://github.com/StefanSuess/Cyclegauge/issues/71) and takes a different position on one question: **ship a stable 1.0 of the existing gauge first, then grow the Efficiency Analyzer as a post-1.0 opt-in feature.**

## 1. Where Cyclegauge stands

Observed on 2026-10-16/17 (recheck before acting):

| Area | State | 1.0 gap |
| --- | --- | --- |
| Product | Status bar, detail view, qualified forecasts, trajectory chart, Cost Advisor, CLI. Over 200 synthetic unit tests, an 80 % line-coverage gate, three-OS extension-host CI. | Feature-complete for a credit gauge. |
| Distribution | 0.7.0 on Open VSX as **pre-release only** (`preview: true`); about 830 downloads, 0 GitHub stars. | No stable channel exists. |
| Release pipeline | Build-once candidate, payload reproducibility, SLSA attestation, protected manual promotion. | Hard-wired to pre-release: `VSIX_NOT_PRERELEASE`, `ovsx publish --pre-release`, GitHub `prerelease: true`, odd-minor test. |
| Storage | `meta.version` must equal `1`, otherwise `STORAGE_UNAVAILABLE`. No migration path. One `imports` evidence row is appended on every collection (minute poll). `Store.snapshots()` reads all rows on each refresh. 0.7.0 moved the default location and history restarted. | No upgrade/migration promise, no retention, long-history cost unmeasured. |
| Runtime | `src/store.ts` statically imports `node:sqlite`; bundle targets Node 24; `engines.vscode: ^1.90.0` is not a tested minimum. CI host is pinned to VS Code 1.141.0. | No declared, tested oldest Kiro version; a runtime without `node:sqlite` fails at activation instead of showing a clear state. |
| Source format | Kiro's log format is undocumented and can change with any Kiro release. Unsupported formats produce "unavailable". | No per-Kiro-version fixture matrix, no user-facing diagnostics to triage drift. |
| Platforms | macOS beta (Kiro 1.2.56); Windows 11 and Ubuntu 26 smoke-tested; RHEL, macOS Intel unverified. | Itemised acceptance (#61) outstanding. |
| Docs | `SPEC.md` still says "0.5.2 candidate", `ROADMAP.md` "Current release 0.5.1"; `release-process.md` says the Open VSX namespace is unverified but the registry now reports it verified; the bug-report template asks for "Show Diagnostics" output that no command produces. | Drift undermines the precision the project sells. |
| Advisor catalog | `verifiedOn: 2026-10-10`; `catalog_review_due` triggers after 30 days (from 2026-11-09). | Needs a standing review before every release. |

## 2. Feature first or stabilisation first?

**Stabilise first, and make 1.0 the stable release of today's scope.** Run cheap demand discovery for #71 in parallel, but do not put the Efficiency Analyzer on the 1.0 critical path.

Reasons:

1. **1.0 is a promise, not a feature count.** [Semantic Versioning](https://semver.org/#spec-item-5) defines 1.0.0 as the point where the public interface is declared; the project's own [versioning policy](release-process.md#versioning) says the same ("the first release with a compatibility promise"). Cyclegauge cannot make that promise yet: it has no storage migration path, no declared minimum runtime and no stable channel. More features enlarge the surface the promise must cover.
2. **#71 changes the trust boundary.** Today's strongest selling point is narrow and verifiable: "reads billing fields from Kiro's logs, writes only its own store, sends nothing". The Analyzer needs workspace enumeration and, later, configuration-text reads. Shipping that inside the first stable release mixes a new, still-unvalidated permission surface into the version that is supposed to signal "safe and settled". As a 1.x opt-in command it can be judged on its own.
3. **Pre-release status caps both goals.** For credibility and donations, the useful artifact is a stable listing plus a write-up showing how the tool earns trust (attested builds, unknowns kept unknown, privacy boundaries). A `0.x` pre-release signals "not ready" to every potential user and reviewer. Every month spent building the Analyzer first is a month at that ceiling.
4. **The gauge is the habitual product; the audit is episodic.** A status-bar gauge is seen daily, which is what builds familiarity and goodwill. A workspace audit runs occasionally. #74 makes the same observation. Get the habitual product to stable first.
5. **Precedent.** Successful single-purpose extensions such as GitLens started as a narrow utility and grew after it was trusted (see #74 for sources and their survivorship bias). Mature open-source practice ([Open Source Guide](https://opensource.guide/finding-users/)) is to make the existing thing easy to install, understand and trust before widening it.
6. **The work is already known and bounded.** Every stabilisation item below comes from code or docs read in this repository. The Analyzer's value is still a hypothesis (#74 Stage 0).

What this does **not** mean: no endless hardening. 1.0 ships when the exit criteria in section 5 are met, not when every edge case in #59–#64 is fixed. Issues that no user hits stay in the backlog with honest platform claims.

## 3. Goals: credibility and donations, honestly

- **Credibility** is the realistic goal: a stable, attested, cross-platform extension with a clear privacy contract and a public technical write-up is a strong portfolio piece regardless of download numbers.
- **Donations** to small developer tools are typically modest (#74 cites Prettier and ESLint figures). Keep the existing Ko-fi links; add no pop-ups, gated features or telemetry. Stable 1.0 and a visible listing are the only donation levers worth pulling now.
- Measure with public aggregates only: Open VSX downloads, GitHub stars, issues from real users, voluntary feedback. No embedded analytics.

## 4. Ordered work packages

Risk follows [the agent workflow](agent-workflow.md): **high-risk** WPs (storage, source reading, release/CI, security) need the `security-reviewer` before a PR. "Gated" means the WP changes a contract that AGENTS.md says requires separate maintainer approval.

### Phase 0 — Decide (maintainer, no code)

**WP0 Scope decision.** Record in `ROADMAP.md`: 1.0 = current features (gauge, forecasts, chart, Cost Advisor, CLI) on the platforms that pass acceptance; #71 is post-1.0 (1.1.x beta). Name the 1.0 platforms (proposal: macOS ARM64, Windows 11 x64, Ubuntu x64; RHEL and macOS Intel explicitly unsupported unless #62 evidence arrives). Freeze features for 0.8/1.0.

### Phase 1 — Truthful baseline (low risk, cheap)

**WP1 Fix documentation drift.** `SPEC.md` and `ROADMAP.md` status lines; `release-process.md` namespace verification status (recheck the registry first); #71's stale "0.7.0 candidate freeze" note; remove or correct the bug template's reference to a non-existent diagnostics command (WP4b may add one). Agent: `implementer` (Haiku). Checks: `git diff --check`.

### Phase 2 — Compatibility contract (moderate risk, gated)

**WP2 Declare the public surface.** Add `docs/compatibility.md` listing what 1.0 promises to keep: extension ID, command IDs, setting keys and scopes, CLI flags and `--json` field names, storage location rules, the data-authority semantics in SPEC. Define the deprecation policy (for example: a setting or JSON field is deprecated for at least one minor before removal). Add a unit test that pins command IDs, setting keys and CLI JSON keys so accidental changes fail CI. Do not change the CLI output itself without separate approval. Agents: `implementer-senior` (Sonnet), `reviewer`.

### Phase 3 — Storage durability (high risk, gated)

**WP3a Measure long history.** Synthetic store with 12 months at the minute poll (snapshots plus `imports` rows), generated in a temp dir. Record DB size and refresh latency of `collect` + `snapshots()` + `history()`. Report numbers; change nothing. Agent: `implementer-senior`.

**WP3b Bounded import evidence (only if WP3a justifies it).** For example, keep evidence rows only when codes change, or cap by age/count. Snapshot rows and forecast inputs are untouched. Agent: `implementer-senior`; review: `security-reviewer`.

**WP3c Schema version ladder.** Replace "`version !== 1` → unavailable" with an explicit ordered migration list (initially empty), transactional upgrade, and a store written by a *newer* version reported as a fixed unsupported code without modification or deletion. Synthetic tests for v1 open, simulated v1→v2, newer-version refusal, failure rollback. Agent: `implementer-senior`; review: `security-reviewer`.

**WP3d Recovery path.** Corrupt, locked or unsafe-permission store yields a clear status and a documented manual recovery (no automatic deletion). Document upgrade from 0.5.x/0.7.x in `docs/usage.md`.

### Phase 4 — Runtime and source-format resilience (high risk)

**WP4a Minimum supported Kiro.** Decide the oldest Kiro to claim, record its Electron/Node, and verify the exact candidate there. Load `node:sqlite` so that its absence produces a fixed "unsupported runtime" status instead of an activation failure. Set `engines.vscode` to the verified floor. Agent: `implementer-senior`; review: `security-reviewer`; native check: maintainer.

**WP4b Format-drift readiness.** Synthetic fixture per observed Kiro log variant (invented values only), and a **Cyclegauge: Copy Diagnostics** command (plus CLI `--diagnostics`) that outputs only fixed codes, counts, versions and platform metadata, never values, paths or identifiers. This makes "Kiro changed its logs" a one-issue, one-patch event instead of guesswork, and makes the bug template truthful. Agent: `implementer-senior`; review: `security-reviewer` (diagnostics are a privacy boundary).

### Phase 5 — Platform acceptance (maintainer, manual)

**WP5** Complete #61 itemised acceptance on Windows and Ubuntu with the exact candidate SHA-256, Kiro version, OS and architecture. Reproduce #59, #60, #63, #64 against that candidate; fix only what reproduces on a claimed platform. Close or relabel #62 as "unsupported for 1.0" unless evidence arrives. Reconcile #21 against the implemented SC1 controls.

### Phase 6 — Stable release channel (high risk, gated, maintainer approval)

**WP6a Stable channel.** Derive "pre-release" from minor parity (odd = pre-release, even and `>= 1.0` per policy) in one place and use it consistently in `package.json` `preview`, `ci.yml` build/verify flags, `promotion-policy.ts` (`VSIX_NOT_PRERELEASE` → expected-flag check), `release-state.ts` (`ovsx publish` flag, GitHub `prerelease`), `promotion-state.ts`, and `version-consistency.test.ts`. Extend the versioning table for 1.x (proposal: odd minor = beta, even minor = stable, unchanged rule). Keep attestation, build-once, reproducibility and protected approval unchanged. Agent: `implementer-senior`; review: `security-reviewer` (mandatory).

**WP6b Candidate filename (#72).** Coupled references move together; bytes unchanged. Can ride with WP6a only if the reviewer agrees; otherwise separate.

**WP6c Dress rehearsal: 0.8.0 stable.** Publish 0.8.0 (0.7 plus WP1–WP4 fixes, no new features) through the new stable path. This exercises the channel change on a version that is not 1.0.

### Phase 7 — Listing and support readiness (low risk)

**WP7** Short above-the-fold README for the Open VSX listing (what, why, privacy in three lines, one synthetic GIF), clear "Support Cyclegauge" section (unchanged links), `SUPPORT.md` with response expectations, pricing-catalog review checklist added to `release-runbook.md` (review before every release; first due 2026-11-09). Draft the 1.0 technical write-up (attested builds, unknowns stay unknown, privacy design) using synthetic data only. Agent: `implementer` (Haiku) for edits; maintainer approves any outreach.

### Phase 8 — 1.0.0

Promote when all exit criteria hold (section 5). Publish with the same pipeline; then follow the outreach steps in #74 Stage 4 with explicit maintainer approval.

### Phase 9 — After 1.0: the Efficiency Analyzer

Run #74 Stages 0–3 for #71 Capability A. Start Stage 0 (user conversations, no code) **now, in parallel**, so evidence exists when 1.0 ships. Implementation lands as a **1.1.x beta**, as an explicit, opt-in command that does nothing until invoked, with its own threat model and review. 1.0's privacy contract stays unchanged for users who never run it.

## 5. 1.0 exit criteria

- [ ] WP0 scope recorded; no features added after the freeze.
- [ ] `docs/compatibility.md` published and pinned by tests.
- [ ] Storage: migration ladder in place; newer-store refusal and recovery tested; long-history cost measured and bounded.
- [ ] Oldest supported Kiro declared and verified on the exact candidate; unsupported runtime shows a clear state.
- [ ] Copy Diagnostics exists and leaks nothing (reviewed).
- [ ] Itemised native acceptance on every platform 1.0 names; others listed as unsupported.
- [ ] Stable channel exercised by 0.8.x on Open VSX and GitHub.
- [ ] At least 14 days on 0.8.x stable with no open P0/P1 issues, and an upgrade from 0.7.x verified (history kept or the loss explicitly documented).
- [ ] Pricing catalog reviewed within 30 days of the 1.0 candidate.
- [ ] All existing gates green: `pnpm typecheck`, `pnpm test`, coverage, `pnpm test:release`, three-OS host tests, attestation, exact-candidate macOS acceptance A/B/D/E.

## 6. Execution model

Use the agents in `.claude/agents/` with an orchestrator, implementer, reviewer loop:

| Role | Agent | Model / effort | Used for |
| --- | --- | --- | --- |
| Orchestrator | `release-orchestrator` (main thread: `claude --agent release-orchestrator`) | Opus, high | Picks the next approved WP, writes the brief, delegates, reviews the diff, runs checks, commits, opens the PR. Never merges, tags or publishes. |
| Mechanical implementer | `implementer` | Haiku, medium | WP1, WP7 and other docs/mechanical edits. |
| Code implementer | `implementer-senior` | Sonnet, high | WP2–WP4, WP6. |
| Reviewer | `reviewer` | Sonnet, high | Moderate-risk diffs (WP2, WP7 if needed). |
| High-risk reviewer | `security-reviewer` | Opus, high | Mandatory for WP3, WP4, WP6 (storage, source reading, diagnostics, release). |

One implementer at a time per file set; one review per diff, plus at most one re-review after fixes. Delegates never commit, push or delegate further.
