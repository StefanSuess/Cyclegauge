# Proposal: Kiro Efficiency Analyzer

**Status:** Product/design proposal only — **not approval to implement**.  
**Date:** 2026-10-13  
**Scope:** Future, opt-in capabilities for the existing Cyclegauge extension. No change to the 0.7.0 release candidate.

## Product objective

Cyclegauge currently answers: *How many Kiro credits remain, and will they last until reset?* The next product question is: **Which Kiro-specific configuration and workflow choices may be adding unnecessary context, agent work, or credit use — and what can a user safely do about them?**

Keep this a **single extension initially**, with isolated opt-in analyzers and a common, evidence-qualified recommendations layer. Reconsider a second extension only if the functionality becomes useful independently of credit analytics or the permission/maintenance boundaries make separation materially better.

Do not build a generic token counter, intercept or rewrite user prompts, route requests to models, or create a paid AI-dependent advisor. Cyclegauge remains free/open source, local-first, read-only by default, and usable without these features.

## Distinguish observations, risks, and measured savings

- **Workspace risk:** A large, unignored `backup/production.sql` could be read by Kiro. Merely existing on disk **does not prove** Kiro read it or that it consumed tokens/credits.
- **Static context:** An always-included Steering file or `AGENTS.md` may add persistent context. File bytes are **not** a reliable token count; referenced files and effective Kiro inclusion rules matter.
- **Dynamic context:** A long session may accumulate context. Neither session duration nor turn count alone proves waste or justifies an unconditional “start a new session” warning.
- **Local attribution:** Observed account balance snapshots are authoritative for account use *as of their timestamp*. Local IDE/CLI turn summaries may support partial session/project attribution **only after** schema, duplicate, account association and additive/cumulative semantics are validated.
- **Pricing boundary:** Published model-specific long-context multipliers may justify a warning **only** when the model, effective threshold, pricing version and contextual token measure are evidenced. For example, Kiro's 2026-09-14 GPT-5.6 1M-context announcement describes a 272K short/long threshold and doubled multipliers above it; this is **not** a universal Kiro/Claude rule. Never claim “4x” or a precise saving without a verified basis.

Every displayed insight should distinguish **observed**, **potential risk**, **modelled scenario**, and **unavailable/unknown**. Recommendations must explain the supporting evidence and possible trade-offs. Do not convert absence of usage records into zero usage or treat a correlation as causation.

## Capability A — Workspace context and ignore audit (first user-facing milestone)

**Entry point:** An explicit `Cyclegauge: Audit Kiro Workspace` command. No automatic workspace crawl at activation and no background file indexing. Require a selected, trusted workspace root; honor VS Code/Kiro workspace trust when available.

Read only the minimum needed to identify potentially costly or inappropriate Kiro context:

1. Enumerate bounded **file metadata** (workspace-relative paths, type and size) under opened workspace roots; do not read dump contents. Candidate classes include database exports (`*.sql`, `*.dump`), archives, generated code, large logs, build outputs, dependency folders and likely secrets. Findings are **heuristic risks**, not proof that Kiro accesses these files.
2. Evaluate **effective Kiro ignore configuration** for the current Kiro surface/version: `.kiroignore`, enabled `kiroAgent.agentIgnoreFiles` filenames (possibly `.gitignore`), subdirectory ignore files and relevant global rules where supported. If settings or effective behavior cannot be established, show *ignore status unknown* rather than “not ignored.” Respect negations, hierarchy and multi-root behavior; never imply `.kiroignore` blocks all tools/surfaces universally.
3. With **separate explicit permission for reading Kiro configuration text**, inspect bounded `.kiro/steering/*.md`, `AGENTS.md`, relevant custom-agent resource declarations and skill metadata/entry points. Identify large always-included rules, broad globs, unexpected transitive references and *candidate* duplication. Semantic contradiction/deduplication findings are **not** supported by size or keywords alone; any deeper content analysis requires its own opt-in design review.
4. Offer clear user-reviewable suggestions: narrower `fileMatch`/manual inclusion where suitable, a Kiro Skill for on-demand instructions, safer `.kiroignore` patterns, or a narrower workspace root. Warn that narrowing context can reduce answer quality and ignoring files may break legitimate tasks.
5. Show an **editable preview/copyable snippet**, never silently write `.kiroignore`, Steering, agent configuration, `AGENTS.md` or editor settings. No auto-fix in the first milestone.

**Scan bounds/safety:** No traversal beyond the selected roots; no symlink or junction traversal/escape; avoid Kiro stores, `.git` internals, credentials and other sensitive or unsafe roots. Apply strict entry/time/depth/byte-read limits, cancellation, non-blocking traversal, and clear “partial scan” results. Do not traverse huge trees merely to find every possible issue. Use content reads *only* for explicitly consented, bounded Kiro configuration files; never read suspected dumps/secret contents. No uploads or telemetry. Display relative paths only in the user's local UI; never log/export them or put them in CI fixtures.

**Acceptance examples (entirely synthetic):** A 1 GiB `backups/production.sql` is flagged as *potential* exposure if not demonstrably excluded; the same file is treated as ignored when effective patterns prove it; disabling `.kiroignore` via settings prevents a false “protected” claim; nested negations, symlinks, missing config, unreadable config, untrusted workspaces and scan limits fail safely. One workspace with a large `always` Steering file receives a *review inclusion* suggestion, not an invented token estimate.

## Capability B — Kiro Hook Efficiency audit (second milestone)

Inspect bounded, explicitly authorized Kiro Hook definitions **without executing hooks** or triggering Kiro. Detect broad matching patterns, repeated agent-prompt triggers, potentially overlapping triggers, oversized static prompt instructions and deterministic work that might be better implemented with a shell command.

Kiro documents both agent-prompt and shell-command Hook actions. Prefer shell for deterministic tasks **only when safe and behaviorally equivalent**; shell stdout/stderr can itself enter agent context, so do not call it universally free of context cost. Present evidence, risk, trade-off and a reviewable suggestion. No automatic modifications, installs or invocation of arbitrary hook commands. Any dynamic invocation counts require separate evidence.

Synthetic tests: overlapping triggers, unsupported schema versions, disabled hooks, glob edge cases, potentially dangerous shell substitutions and hooks containing sensitive text. Never print arbitrary config values into diagnostics.

## Capability C — Local usage / session / project attribution (research before implementation)

The repository's `docs/kiro-data-format.md` already records **observed** IDE `usage_summary` events, CLI turn metering metadata, model and context-related fields. This is a *research lead*, **not** an approved ingestion contract or proven credit accounting.

**Discovery gates:**
- Validate the current Kiro IDE/CLI versions and actual format variants using controlled local experiments; commit only fresh, invented synthetic fixtures. Never copy, redact or upload real Kiro sessions/logs/DBs.
- Demonstrate idempotent turn identity, proper handling of partial/in-progress/repeated/retried events, cross-format duplicate avoidance, version drift, clock/timezone and account/workspace association. Specifically resolve the currently **unverified** additive-versus-cumulative CLI metering semantics **before** showing totals.
- If project attribution is supported, display **observed local project usage** separately from account totals and a prominent unattributed/unknown component. Do not allocate the account's whole usage to visible repos. Stable local pseudonymous IDs only; do not publish raw identifiers or private paths.
- Verify whether model name, reasoning effort, contextual token counts, compaction markers and per-turn credits can be jointly, accurately attributed. Mark each unsupported dimension unavailable. Never infer model/effort solely from surrounding text.
- Decide whether any session metadata can be persisted at all; require a specific privacy/security review, short retention, opt-in, deletion control, bounded import and owned storage. By default preserve **none** of the prompt, source, conversation, tool input/output, workspace path or provider credentials.

Potential user views **only after the above gates**: credits by observed project/session; per-model costs if model/credit linkage is demonstrated; context pressure trends; inferred task boundaries only with defensible evidence. Cross-device and missing-session usage remains unknown.

## Capability D — Evidence-based recommendations and budget alerts (later milestone)

Join only validated signals from A–C with the existing qualified budget/forecast engine, preserving all forecast quality gates. Examples:

- “This workspace contains a large backup outside proven ignore coverage; consider excluding it if not needed by Kiro.” *(risk, not measured savings)*
- “This Hook runs an agent prompt on every save; a narrower trigger or deterministic shell step **may** reduce credit use.” *(configuration recommendation, not a numeric estimate)*
- “A verified GPT-5.6 session is near the applicable 272K pricing tier; for the **next independent task**, consider a fresh focused session.” *(only with reliable context meter, correct version/model and documented pricing)*
- “High reasoning effort is frequently observed for routine work.” *(only if actual effort and comparable workload measurements exist; model quality/throughput trade-off disclosed)*
- “Forecast rate exceeds remaining per-day budget.” *(use existing trustworthy budget data; user-configurable notification and anti-spam limits)*

Never create universal session-length thresholds, assert that shorter sessions always save credits, or automatically switch models/effort. A future local recommendation engine should work deterministically without paid LLM calls, remote analytics, tool execution or automatic configuration edits.

## Privacy and permissions boundary

The current `AGENTS.md`, `SPEC.md` and `ARCHITECTURE.md` strictly limit collection to billing fields and prohibit session aggregation, content analysis and workspace access without explicit approval. **This proposal grants none of those permissions.** Each implementation milestone needs its own reviewed scope, threat model and specific approval before changing those contracts.

Safeguards for future work:
- Independent opt-in switches for metadata-only workspace audit, reading configuration *text*, and local session analytics. Usage/forecast must keep working with all disabled.
- Never read source code or suspected secret/dump payloads as an optimization shortcut; never send data to external services; no extension-owned paid AI requests.
- No network access, prompt interception, hidden agent hooks, Kiro command execution, Kiro-owned file writes, automatic corrections or modification of Kiro permissions.
- All Kiro-owned data strictly read-only; failures report fixed codes and sanitized counts, not raw records, private paths or exception strings. Real logs never appear in CI, fixtures, PRs, issues or diagnostics.
- Cross-platform, multi-root, performance/cancellation, storage, hostile-file and privacy tests are required before each activation.

## Delivery order and success criteria

1. **Discovery/design:** Confirm effective ignore rules, Kiro IDE/CLI configuration surfaces, schema support, performance limits, UI UX and threats against current official docs. Produce synthetic fixtures and a tiny controlled local validation protocol; no production ingestion.
2. **MVP:** User-initiated metadata-only Workspace Ignore Audit, readable findings, preview/copy recommendations, unknown states, bounded resources, synthetic tests. No mandatory dependency and no new build/release infrastructure.
3. **Configuration expansion:** Separate consent for static Steering/AGENTS/resource/Skill inspection; Hook definition audit. No autonomous edits.
4. **Telemetry-free local attribution PoC:** Prove event semantics and quality; only then independently authorize the opt-in session collector and per-project/model displays.
5. **Cross-signal recommendations:** Conditional session/context/effort and budget insights with model-specific, versioned price rules, quality labels, and user-controlled alerts.

**Definition of done for each implementation PR:** smallest useful vertical slice, explicit scope/permissions, self-contained synthetic tests, no regression to billing/privacy/release checks, no new runtime network/dependencies without demonstrated need, and independent review where appropriate. No overengineering or additional recurring CI pipelines just to report insights.

**Versioning/release:** The 0.7.0 beta candidate is frozen for native acceptance and publishing. Do **not** merge implementation or documentation changes onto `main` before that release without regenerating and re-accepting its exact candidate. Current version policy reserves **0.8.x for stabilization of 0.7.x**, not new features; a later new feature beta would normally start on **0.9.x**, subject to release planning. This document is not part of 0.7.0 and does not authorize publishing.

## Source references (verification required again at implementation time)

- Existing project evidence: [Kiro local data formats](kiro-data-format.md), [privacy and storage](privacy-and-storage.md), [roadmap](../ROADMAP.md), [agent rules](../AGENTS.md).
- Kiro: [Ignore rules](https://kiro.dev/docs/kiroignore/), [Steering](https://kiro.dev/docs/steering/), [CLI context](https://kiro.dev/docs/cli/chat/context/), [Hook actions](https://kiro.dev/docs/hooks/actions/), [Hook best practices](https://kiro.dev/docs/hooks/best-practices/).
- Kiro: [2026-09-14 GPT-5.6 long-context pricing announcement](https://kiro.dev/changelog/models/gpt-5-6-1m-context-window/). Treat all pricing, supported-model and Kiro-version details as subject to change.
