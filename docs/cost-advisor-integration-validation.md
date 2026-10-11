# Cost Advisor integration for the 0.5.2 macOS beta

Integration baseline: main `95031a9` (merged PR #16). Donor: PR #15 `947620e`, which has PR #1 cross-platform ancestry. This integration selects feature files and adapts the native entry point to main; neither donor branch is merged.

## Scope and dependency audit

Included: pure Phase A Advisor/profile/classifier, pure numerical estimate layer, session-only account-scoped native answers, card and status-first presentation, chart presentation refinements, existing cost-engine rendering, and synthetic tests. The Advisor replaces standalone configure/edit/clear commands; only `easykirogauge.showUsage` remains aliased. Pricing/catalog, demand generation and simulator algorithms are unchanged.

One necessary dependency: `validDemand` accepts `long_history_future_rate` and `short_window_long_horizon`, already produced by the forecast demand builder. Without these codes automatic forecast comparisons fail with `invalid_cost_input`. A regression test exercises forecast-derived demand. This is a validation allowlist correction, not a new consumption model.

Excluded: PR #1 portable storage/runtime/discovery/diagnostics changes, Windows ACL work, platform PoCs/workflows, expected-failure baselines, owner-run limit verification, demo scripts, future-record filtering/clock-skew tolerance and SC5 persistence draft. No source logs or real data were inspected. SC1 and SC5 stay open.

Main's publisher `StefanSuess`, ID `StefanSuess.cyclegauge`, version 0.5.2, preview flag, machine-scoped new/legacy settings, legacy-install gate, CI, release staging builder, secure exact-content verifier, VSIX allowlist, lockfile and privacy/storage behavior are preserved. No new dependencies. Collector, Store, projection, history, forecast, view, paths and guard files are byte-identical to main. Commands and public docs are reconciled for the Advisor.

## Validation

Synthetic local checks on macOS: current-main baseline 194 unit tests and 8 release tests passed. Integration 231 unit tests and 9 release tests passed; type checking, fixture validator (7 synthetic files, 20 edge-case contracts) and whitespace validation passed. Release tests check pre-release packaging, exact eight-entry allowlist, publisher, settings scopes, hostile ZIP diagnostics, independent payload reproduction and the shipped bundle's native Advisor command, conditional figure, cancellation, answer clearing and panel visibility lifecycle. These do not verify Kiro's native UI or other platforms.

A release candidate is built with `release:build --pre-release`, checked by the unchanged verifier and independently rebuilt for payload comparison. Its exact file checksum is delivered with the candidate, outside the repository. CI must also pass on the final PR commit.

Independent review and native acceptance are separate gates. Independent read-only review found no critical or important issues and two minor clarity findings. Both are addressed: future-cycle pooled-history basis is disclosed (new regression test failed before the fix and passed after it), and the spec distinguishes classifier verdicts from conditional numerical differences. The reviewer independently ran 42 focused tests. Native macOS acceptance remains pending and must use the exact final candidate under [the revised checklist](macos-acceptance.md), including section F. No merge, publish, tag or GitHub release is performed by this integration task.

## Final release-readiness documentation

PR #17 now specifies a fully invented, current-date UTC setup (36 daily observations across cycles), a CLI preflight, and isolated legacy-first migration steps. Publishing explicitly requires acceptance section F. Namespace existence and verification are distinct from maintainer publishing access. The GitHub bot request did not execute: its reply requires a Codex environment for this repository. Only the local independent review is complete; no GitHub bot review is claimed.

Documentation setup verification: the exact Python block parses as 36 accepted invented records. Current-date, UTC month-start and year-start runs each yield a regular `history_28_day` forecast and a modelled next-cycle difference. CLI preflight observes all 36 invented records. These are collector/engine checks, not native Kiro acceptance.

The documented legacy-tag packaging command built the 0.5.1 VSIX. A generated migration store populated by the legacy CLI retained all 36 invented observations when opened by the current CLI (0 new imports, 36 duplicates, unchanged observed usage). This checks data reuse only; side-by-side activation still requires native checklist C.
