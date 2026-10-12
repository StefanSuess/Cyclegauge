# Agent workflow

Use this for nontrivial work alongside [AGENTS.md](../AGENTS.md). Optimize **total engineering cost** (model usage, tokens, tool calls, CI time, and human review) without weakening privacy, correctness or release gates.

## Smallest adequate approach

- **Trivial:** One agent edits directly; no plan document, subagent, or dedicated review.
- **Moderate:** Implement directly or delegate a small, mechanical task only if the handoff saves more than it costs. Use a low-cost capable model for routine edits, tests and documentation.
- **Complex:** Define short acceptance criteria, split only at useful independent boundaries, and parallelize only if it actually reduces total cost or turnaround.
- **High-risk** (storage, source reading, billing, forecasting, packaging, workflows, security): spend more reasoning where necessary and require an independent read-only reviewer before the PR.

Avoid speculative architecture, redundant plans, duplicate reviews, exhaustive repository reads, and subagents created solely for orchestration. Start with one agent. Use at most two concurrent workers unless additional parallelism has a clear benefit.

## Model and context budget

- Choose the **least expensive available model with sufficient ability** for each task, not the most powerful model by default. Model names and prices change; use current capabilities and pricing, not a fixed model-name mapping.
- Escalate to stronger reasoning for ambiguity, repeated bounded failures, architectural decisions, security-sensitive changes or a demonstrably difficult review. A few cheap failed attempts can cost more than one capable pass.
- Supply each delegate only its task, relevant file paths, acceptance criteria and necessary constraints. Read targeted files first; expand scope only when evidence requires it.
- Do not repeat the same analysis or verification without a code change or new evidence. Avoid unbounded agent loops and token-heavy reports; summarize decisions and blockers briefly.
- Never initiate new paid services, paid external calls or substantial optional compute without maintainer approval.

## Work and verification

1. State concise acceptance criteria for nontrivial changes; choose the tests that demonstrate them.
2. Keep one writer per file. Parallel edits require isolated branches/worktrees; never have Claude Code and Codex edit the same files simultaneously.
3. Run `pnpm typecheck` and `pnpm test` for code changes, `python3 tests/fixtures/kiro/validate.py` for fixture changes, and `git diff --check` for fixture/documentation changes. Run release-specific checks when touching release behavior; do not weaken existing CI gates to save cost.
4. Use independent read-only review when risk or complexity justifies it; **always** for high-risk changes. Give the reviewer the diff, criteria and existing check results. The author cannot be the sole reviewer on high-risk changes.
5. Fix a small number of clear, bounded failures; stop and report persistent or ambiguous blockers instead of spawning more agents.
6. Commit only intended files on a feature branch, then open one focused PR. Never merge, tag, release, deploy, publish, change secrets or relax security checks without explicit approval. Work in the cloud by default; native IDE acceptance is the exception.

## Tool-specific delegation

Claude Code can use `.claude/agents/implementer.md` (inexpensive, narrowly scoped edits) and `.claude/agents/reviewer.md` (independent read-only review). Codex does **not** automatically load these Claude-specific definitions: include relevant role instructions in delegated prompts. A fixed model for a role in an agent file is an implementation default, not a reason to use that role on every task.

## PR description

Include a short summary, checks actually run, limitations and decisions requiring maintainer input. Never include private Kiro data, Claude session URLs or links to private threads.
