# Development, verification and packaging

## Build, test and package

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
python3 tests/fixtures/kiro/validate.py
git diff --check
pnpm package:vsix
```

Equivalent manual build: `./node_modules/.bin/tsc --noEmit`, then esbuild to `dist/extension.cjs`, then `./node_modules/.bin/vsce package --no-dependencies --out dist/easykirogauge-0.5.1.vsix` (see the `scripts` in `package.json`). The VSIX allowlist in `.vscodeignore` is exactly `package.json`, `README.md`, `LICENSE` and `dist/extension.cjs`; `vsce` stores `LICENSE` as `LICENSE.txt` inside the package; its content is byte-identical (MIT, Copyright (c) 2026 Stefan Suess). Source logs, stores, tests and local caches never ship. Because `README.md` ships in the VSIX, its links must be absolute.

## Verification and remaining limits

The commands above are the full local check.

The unit/integration suite uses invented records and temporary synthetic sources only, including the existing invented account log fixture. It checks precision, privacy sentinels, DST, source scope and symlinks, read-only file/directory behavior, concurrent source mutation, transactions, restart/deduplication, same-size replacement, corruption, account isolation, conflicts, freshness and cycle transitions.

Verified here: synthetic tests on macOS and live VSIX installation, activation, status bar and detail view in Kiro 1.2.56. The collector was previously reported live-tested by the user. Windows, Ubuntu and RHEL are **unverified targets**, not compatibility claims. Windows is additionally blocked by ACL support. Live SQLite/WAL safety for Kiro's own cache remains unproven, so that adapter is disabled and explicitly unavailable. Format stability, service latency, nonnumeric rotation naming, unknown populated bonuses and historical source timezone changes remain limitations. Not implemented: session aggregation, statistical probability estimates and a background daemon. The session-only Cost Optimizer is implemented (see [cost-optimizer.md](cost-optimizer.md)).

## Naming and identifiers

| Kind | Value today | Note |
| --- | --- | --- |
| Public repository | `StefanSuess/Cyclegauge` | The old `EasyKiroGauge` URL redirects. |
| Brand / product display name | Cyclegauge / Cyclegauge for Kiro IDE | User-visible text only. |
| npm package name, extension name, publisher | `easykirogauge` | Technical identifier, unchanged. |
| Command IDs, settings keys, webview panel ID | `easykirogauge.*` | Unchanged; changing them breaks users' settings and keybindings. |
| Storage folder | `EasyKiroGauge` under the platform data directory | Unchanged; renaming would orphan existing data without a migration. |

Changing technical identifiers needs a reviewed migration (publisher namespace, settings and storage migration, rollback) and is tracked separately, not part of branding work.
