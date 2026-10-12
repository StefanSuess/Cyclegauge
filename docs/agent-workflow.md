# Agent workflow

The orchestrator plans, delegates only when useful, integrates and opens the PR.
Priorities: correctness and security, minimal supervision, low token use, small focused PRs.

## Pick the lightest strategy

| Task | Strategy |
| --- | --- |
| Trivial (typo, one-line fix) | One agent, no orchestration, no review agent. |
| Moderate | the orchestrator implements directly, or hands well-scoped mechanical work to `implementer` (cheap tier). |
| Complex | Split into independently testable tasks, delegate suitable ones, integrate, then `reviewer`. |
| High-risk (storage, source reading, billing, forecasts, packaging, workflows, security) | Stronger reasoning for design, mandatory independent `reviewer` pass. |

Do not spawn subagents to demonstrate orchestration. At most two concurrent workers unless more parallelism clearly pays off.

## Rules

1. For nontrivial work, write acceptance criteria first (what must be true, which tests prove it).
2. One writer per file at a time. Parallel write tasks use separate git worktrees on separate branches.
3. Run `pnpm typecheck`, `pnpm test`, and `python3 tests/fixtures/kiro/validate.py` plus `git diff --check` when fixtures or docs change.
4. Review nontrivial changes with `reviewer` (read-only) before the PR; the author does not self-review high-risk work.
5. Fix clear, bounded failures (a few attempts). Stop and report persistent or ambiguous blockers.
6. Work on a feature branch and commit there; stage explicit files only (see AGENTS.md). One small PR per task.

## PR contents

Short summary, test results, known limitations, and decisions needing the maintainer's input.
Public text never includes Claude Code session URLs or private thread links.

## Never without explicit maintainer approval

Merge, tag, release, deploy, publish, change secrets, or relax security checks. Preserve data formats, billing semantics and privacy; no real Kiro data; work in the cloud by default (native Kiro UI tests are the exception).

## Tools and model tiers

Roles are tool-neutral; only the model per role differs. Codex reads this file through AGENTS.md.

| Role | Claude Code | Codex |
| --- | --- | --- |
| Orchestrator, reviewer | Sonnet (high effort for review) | mid/strong tier, TBD by maintainer |
| Implementer | Haiku (medium effort) | cheapest tier, TBD by maintainer |

Codex has no `.claude/agents/` files: give its implementer or reviewer the matching file's text as the task prompt and keep the same read-only reviewer rule. Never run both tools on the same files at once.

Claude Code subagents live in `.claude/agents/`: `implementer` (cheap tier, medium effort) and `reviewer` (Sonnet, high effort, read-only).
