# Cyclegauge agent instructions

## Authority and scope

- Follow [SPEC.md](SPEC.md) for behavior, [ARCHITECTURE.md](ARCHITECTURE.md) for trust boundaries and [ROADMAP.md](ROADMAP.md) for scope. Dated milestone approvals are historical evidence, **not** blanket authorization for new features.
- For nontrivial changes, read [the agent workflow](docs/agent-workflow.md) before working. Keep shared rules here; `CLAUDE.md` imports this file for Claude Code, while Codex loads `AGENTS.md` directly.
- Make only the requested, approved change. Never merge, tag, release, deploy, publish, change secrets, or weaken security checks without explicit maintainer approval.
- Keep agent work cost-aware: smallest useful task, least expensive capable model, targeted context and tests, no unnecessary delegation or review loops. The main session orchestrates and delegates implementation to subagents sized to the task only when the brief is clearly shorter than the work; a delegated agent does not delegate further. Never trade away mandatory security/correctness gates to save cost; see [agent workflow](docs/agent-workflow.md).
- Preserve collector, Store, projection, billing, forecast and established data-format contracts unless the change is explicitly approved. Keep the collector independent of VS Code APIs.
- Session aggregation, Crew integration, Kiro-owned SQLite access, usage-efficiency/content analysis, purchases, authenticated calls, new platform enablement and answer persistence require separate approval. Do not treat an implementation plan as approval.

## Privacy (non-negotiable)

- Never commit, print, upload, attach to issues/PRs, or expose in diagnostics real Kiro logs, databases, sessions, transcripts, prompts, source code encountered in Kiro data, tool inputs/outputs, conversations, credentials, authentication material, raw or derived account/user/session/request identifiers, or private workspace paths.
- Never copy production Kiro data (including backups or exports) into the repository, temporary fixtures, review packages or CI. Redacting real records does **not** make acceptable fixtures.
- Create every fixture from scratch with obviously invented `synthetic-*` identifiers and fixed invented dates/numbers. Use inert invented sentinels rather than realistic secrets.
- Extract only explicitly allowlisted billing fields in memory; discard unknown fields. Diagnostics may show fixed codes, counts, schema field names, versions and platform metadata, **not** rejected values, full records, data-bearing exceptions, dynamic filenames or absolute paths.
- Never read auth stores, keychains, cookies, credential files or authentication table values. Do not run Kiro commands, call authenticated Kiro services, or enable verbose logging to obtain data. Native IDE installation/activation testing is permitted only within these boundaries.
- Never send locally read data to external services or tools; public documentation queries must contain no private values.
- If continuity needs identity, use a narrow in-memory projection and device-local opaque partition key. Raw and derived identifiers remain private; never expose even opaque keys in diagnostics.

## Source and storage safety

- Kiro-owned files/databases are **strictly read-only**: no writes, repairs, migrations, checkpoints, permission/settings changes, journal changes, exports or SQLite sidecar creation.
- Use explicit read-only handles and allowlisted roots. Do not recursively import source trees or unrelated directories; reject symlink escapes.
- SQLite `query_only` is not enough to prove non-mutation; `immutable=1` is not a generally safe reader for a live database/WAL. If safety or freshness cannot be proved, return unavailable, not fabricated observations.
- Write only to Cyclegauge-owned storage outside Kiro and the repository; never put real billing observations in git or automated tests.
- Package only the extension bundle, manifest and public documentation. Never include source logs, stores, tests or dependency caches in VSIX artifacts.

## Data correctness and evidence

- Account snapshots, with explicit as-of time and freshness, are authoritative for **observed account usage**, not live balances. Local session metering, if separately approved, is at most observed local attribution, never the account total.
- Gaps are unknown, not zero: do not invent daily allocations or add account snapshot totals to session totals. Before any future CLI/session aggregation, verify additive versus cumulative semantics with evidence; a field name or single sample is insufficient.
- Keep credits, tokens, context percentages and money distinct. Preserve decimal precision, timestamp offsets and the distinction between local calendar days and UTC billing boundaries.
- Label observations, documentation, inference and unknowns accurately; macOS verification does not imply Windows, Ubuntu or RHEL support.

## Checks and public collaboration

- Run `pnpm typecheck` and `pnpm test` for code changes. Run `python3 tests/fixtures/kiro/validate.py` for fixture changes; for fixture or documentation changes also run `git diff --check`. Follow task-specific release checks in [development guidance](docs/development.md).
- Inspect the staged files before committing; stage explicit intended paths only. Never stage real data or blanket-add unrelated files.
- Do not include Claude Code session URLs (`claude.ai/code/session_...`) or private thread links in commits, issues or PRs. Normal AI attribution, including `Co-Authored-By`, is allowed; `.claude/settings.json` disables session URL attribution.
