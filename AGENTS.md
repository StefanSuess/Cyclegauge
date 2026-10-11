# Cyclegauge contributor rules

## Scope and authority

- Follow [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ROADMAP.md](ROADMAP.md).
- **Implemented (0.5.1, UI-only simplification of the 0.5.0 view):** Milestones 1–3 (collector, extension, history/forecasts), 4A–4B (independent exact cost engine and the cost engine behind the Cost Advisor in the script-disabled detail view (the standalone Cost Optimizer UI was removed in favour of the Advisor); exhaustive exact break-even is engine-only and never invoked during extension interactions), 4C (0.4.1 pooled history forecasting) and 5 (script-free inline-SVG usage chart). Evidence: the `docs/milestone-*-validation.md` files.
- **Deferred / unauthorized:** session aggregation, Crew integration, Kiro SQLite access, usage-efficiency insights, content analysis, purchases and authenticated calls. Each needs separate explicit approval and does not alter the privacy and read-only rules below.
- No automatic Git commits. Preserve collector, Store, projection, billing and forecast algorithms unless a new approval says otherwise.
- Keep the collector independent of VS Code APIs. Package only the extension bundle, manifest and public documentation; exclude source logs, stores, tests and local dependency caches from VSIX artifacts.
- Account snapshots are authoritative for current **observed account usage**, with an explicit as-of time and freshness status. Session metering provides **observed local daily attribution**, never a replacement account balance.
- Unknown consumption across observation gaps is unknown, not zero. Do not invent daily allocations or sum account snapshots with session totals.
- CLI metering entries must be checked for additive versus cumulative semantics before aggregation. Do not infer semantics from a field name, increasing values, or one sample.

## Public GitHub content

- Do not put Claude Code session URLs (`claude.ai/code/session_...`) or links to private project threads in PR descriptions, PR or issue comments, or commit messages. `.claude/settings.json` sets `attribution.sessionUrl` to `false` to stop Claude Code adding them automatically.
- Normal attribution stays: the "Generated with Claude Code" line and `Co-Authored-By` trailers are fine. AI-assisted development is not hidden.

## Strict privacy rules

- Never commit, print, upload, attach, or expose in diagnostics any real raw session data, credentials, authentication material, account/user/session/request identifiers, prompts, source code encountered in Kiro data, tool arguments/results, conversation text, or private workspace paths. This does not prohibit future EasyKiroGauge application code itself.
- Never copy real Kiro logs, databases, transcripts, database backups, or exports into this repository, temporary fixture folders, bug reports, or review packages. Redaction of a copied real session is not an acceptable fixture-generation strategy.
- All fixtures must be invented from scratch. Use obvious `synthetic-*` identifiers and fixed invented dates/numbers. Sensitive-content test markers must be inert invented sentinels, not realistic credentials or copied text.
- Extract only explicitly allowlisted billing fields in memory. Drop every unrecognized field by default. Do not log rejected values, full records, exception representations containing data, dynamic filenames, or local absolute paths. Diagnostics may contain fixed error codes, counts, schema field names, and version/platform metadata only.
- Do not read authentication stores, keychains, cookies, credential files, or authentication table values. Do not invoke Kiro commands, call authenticated Kiro services, or enable verbose logging to obtain more data. IDE extension installation and activation for Milestone 2 validation are authorized; they must not trigger authenticated usage requests.
- Do not send locally read data to external services or tools. Public documentation lookups must use generic queries without local identifiers or contents.
- If account continuity requires identifiers, design a narrow in-memory projection and device-local opaque partition key. Never persist raw identifiers or expose opaque identity/deduplication keys in diagnostics. Treat derived identifiers as private too.

## Read-only access

- Kiro-owned files and databases must remain strictly read-only: no migrations, repairs, checkpoints, journal-mode changes, permission changes, sidecar creation, settings changes, session exports, or writes of any kind.
- Use explicit read-only handles and allowlisted paths. Do not recursively import snapshots, source trees, or unrelated directories; reject symlink escapes from configured source roots.
- SQLite `query_only` alone is insufficient. A future reader must prove it cannot create or modify sidecars. `immutable=1` is not a generally correct reader for live databases or WAL content. Unsupported/concurrently changing database states must produce a safe unavailable status, never fabricated current data.
- Write only to Cyclegauge-owned storage. Do not put extracted real billing data in the repository. Never use production Kiro data for automated tests or CI.

## Evidence and validation

- Distinguish locally observed, officially documented, inferred, and unverified claims. macOS observations for Kiro 1.2.37 do not verify Windows, Ubuntu, or RHEL.
- Keep monetary amounts, credits, tokens, and context percentages separate. Preserve decimal precision and timestamp offsets; daily timezone and UTC billing boundaries are different concepts.
- Run `python3 tests/fixtures/kiro/validate.py` and `git diff --check` after fixture/documentation changes. The validator checks fixture contracts, not production parser behavior.
- Before committing, inspect the staged file list and verify it contains only intended application code, tests, dependency manifests, documents, wholly synthetic fixtures, and validation tooling. Do not stage unrelated files with a blanket add.

## Milestone 4C approval — 2026-10-10 (historical)

Long-term history and robust forecasting (0.4.1) was approved with refinements: never infer zero usage from missing snapshots, require independent comparable observations, enable heuristics only on walk-forward evidence, report availability/error/underprediction/stability separately with held-out scenarios, and reserve 0.5.0 for the dashboard. The three original forecast methods and the collector, Store, projection and billing semantics stay preserved. No charts in that milestone (0.5.0 later delivered the chart under its own approval), no automatic Git commits. This extends, and does not remove, the earlier boundaries.

## Cost Advisor approval — 2026-10-11

An automatic Cost Advisor was approved in phases (see [docs/cost-advisor-spec.md](docs/cost-advisor-spec.md)): plan inference is an unconfirmed hint with a confidence label and never a unique identification; an explicit user selection wins and a changed reported limit alone does not invalidate it; unknown add-on balances, billing system or plan are never treated as zero; "no action needed" and "potential savings" require explicit answers and a supported comparison; no automatic purchases, telemetry, authenticated access or online price requests. The reported limit is not verified to be base-only. Phase A stays script-free and session-only. Persisting explicit inputs is approved in principle as an account-bound local storage class but is **not implemented** and **SC5 is not complete** until its specification, implementation and an independent security review are approved. Milestone 6, PR #1, SC1 and the Windows fail-closed behaviour are unchanged. The token-only `scripts/verify-limit-contract.mjs` (which keeps `userInfo.userId` in memory only to count accounts and never prints it) is run by the owner on their own data; it must never be run by an agent on real logs and the extraction allowlist is unchanged.
