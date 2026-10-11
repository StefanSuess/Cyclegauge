## Before / After

Before:

After:

## How

<!-- One short paragraph: what the change does and where. -->

## Checklist

- [ ] No real Kiro data, identifiers, paths, tokens or screenshots anywhere in this PR (fixtures are invented `synthetic-*`)
- [ ] No writes to Kiro-owned files, no network code, no telemetry
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:release`, `python3 tests/fixtures/kiro/validate.py`, `git diff --check` pass
- [ ] Data formats, billing semantics and forecast behaviour unchanged (or the change is approved in an issue)
- [ ] No unverified platform claims
