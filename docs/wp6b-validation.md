# WP6b: chart interaction and observed comparison

Scope: the maintainer continued the approved dashboard design after PR #104 was merged on 2026-10-18. This work implements phase 6b only: chart hover/focus/arrow-key exploration, a polite headline live region, cycle comparison and today's observed UTC-day pace. Phase 6c–6e, new storage, new sources and core history/forecast contracts remain separate work packages. No publication is authorized.

## Evidence rules

- Comparisons use only the existing `history()` output and its evidence-backed cycle starts. Prior absolute usage is reconstructed only from a complete chain beginning with the baseline interval already emitted by history. Missing links or incompatible evidence remain unavailable; no interpolation or invented baseline.
- The comparison offset comes from the current cycle's latest observation, not wall-clock time. A prior observation must be no more than two hours before that offset; otherwise supported bracketing observations are labelled with their actual times.
- Today's pace is observed net counter change within the current UTC day, with the actual start observation, elapsed time and latest as-of time. It is not extrapolated or represented as a full-day total. The 24-hour allocation is context only, evaluated as of the latest observation and shown only after at least 18 observed hours.
- Tooltip changes follow interval comparability. Thinning the chart must not turn the gap between plotted points into an invented per-update measurement.

## Verification

Local checks on the final implementation: `pnpm typecheck` passed; `pnpm test` passed (480 tests, 11 Windows-specific skips on macOS, zero failures); `pnpm test:release` passed (95 tests); `pnpm test:coverage` passed (99.28% lines); `git diff --check` passed. Synthetic browser tests cover arrow navigation, roving selection across live models, pointer travel from a point through blank SVG space to the tooltip, and Escape while focus is outside the chart. The 96-point synthetic chart is 61,979 bytes; its size test retains a 72 KB bound.

The independent `security-reviewer` received the complete diff as a file. The first review found two tooltip accessibility blockers (pointer travel and Escape outside chart focus); both received regression tests and a bounded fix. One scoped re-review found no remaining blocker. No new source access, storage, dependency, network permission, message action or core data contract was added. Exact-head CI, CodeQL and the packaged three-OS host checks are required before merge.

Native Kiro acceptance remains outstanding: keyboard use, VoiceOver on macOS, NVDA on Windows, pointer/tooltip behaviour, theme and forced-colour rendering, reduced-motion behaviour, CSP/Trusted Types and synthetic-click handling. Unit, stubbed browser and packaged VS Code host checks are distinct evidence layers and do not establish native Kiro or screen-reader acceptance.
