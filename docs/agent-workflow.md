# Agent workflow

Read with [AGENTS.md](../AGENTS.md). Minimize **total cost** (model tokens, agent/tool calls, CI and human time) without weakening safety, correctness or release gates.

## Choose the least costly sufficient approach

- **Trivial:** One agent, direct edit; no plan document, subagent or separate reviewer.
- **Moderate:** Work directly, or delegate narrowly scoped mechanical edits to a cheap capable implementer **only** if the handoff pays off.
- **Complex:** Define short acceptance criteria; split/parallelize only when independent tasks justify the overhead.
- **High-risk** (storage, data reading, billing, forecasts, packaging, CI/release, security): use stronger reasoning as needed and always obtain independent read-only review before a PR.

Choose the least expensive *currently available* model that can reliably complete each task; avoid hard-coded model maps that become stale. Escalate on real ambiguity, repeated bounded failure or high stakes. Several failed cheap attempts may cost more than one strong pass.

**Orchestration.** The main session orchestrates: it plans, briefs, reviews and integrates. It delegates implementation only when the brief is clearly shorter than the work (searching many files, many similar edits, independent parallel parts); when it already knows the exact change, it makes the change itself. Review is delegated as set out below. Match model and effort to difficulty and risk: a small, cheap model at low effort for mechanical edits and docs; a mid-tier model for ordinary code and reviews; the most capable model at high effort only for hard design, storage, security or release questions. A delegate starts without context, so dictating a known edit to one costs more than making it. The orchestrator gives each delegate the exact files, acceptance criteria and checks to run, forbids commit and push in the brief, reviews the resulting diff itself before committing, and keeps git, PRs, CI triage and maintainer decisions to itself. A delegated agent does its assigned task and does not delegate further.

Start with one worker, at most two concurrent unless more clearly saves time/cost. Don't spawn agents just to demonstrate orchestration. Read relevant files instead of the entire repo; pass delegates only the brief, necessary context and criteria. Avoid speculative refactors, oversized plans, duplicate reviews, repeated analysis, unbounded retries and verbose reports. Ask approval before new paid services, external API charges or substantial optional compute.

## Working rules

1. Define concise acceptance criteria and relevant tests for nontrivial changes. One writer per file; simultaneous edits need isolated branches/worktrees. Claude Code and Codex must not edit the same files together.
2. For code, run `pnpm typecheck` and `pnpm test`. For fixtures run `python3 tests/fixtures/kiro/validate.py`; for fixture/docs changes run `git diff --check`. Add checks when relevant, especially for release changes. **Never bypass existing CI/security gates for savings.**
3. Use read-only `reviewer` for risk/complexity when worthwhile and **always** for high-risk changes. Provide the diff as a file the reviewer can read (it cannot run commands), the criteria and check results; the author cannot be sole high-risk reviewer.
4. Resolve a few clear bounded failures, then report blockers instead of escalating cost indefinitely.
5. Commit explicit intended files on a branch and open a focused PR. Never merge, tag, release, deploy, publish, change secrets or weaken security checks without explicit approval. Prefer cloud-based work; native IDE acceptance is the exception.

## Agent-specific integration

Claude Code uses `.claude/agents/implementer.md` for inexpensive scoped changes and `.claude/agents/reviewer.md` for independent review. Codex does **not** load Claude-specific role files automatically: include the applicable instructions in delegated prompts. Fixed model names in role files are defaults, not a requirement to invoke those agents.

Keep PR text short: summary, checks **actually** run, limitations and decisions. No private Kiro data, Claude session URLs or private thread links.
