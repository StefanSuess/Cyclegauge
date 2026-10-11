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

Equivalent manual build: `./node_modules/.bin/tsc --noEmit`, then esbuild to `dist/extension.cjs`, then `./node_modules/.bin/vsce package --no-dependencies --out dist/cyclegauge-0.5.1.vsix` (see the `scripts` in `package.json`). The VSIX allowlist in `.vscodeignore` is exactly `package.json`, `README.md`, `LICENSE`, `dist/extension.cjs` and `assets/branding/cyclegauge-icon-256.png` (the packaged extension icon); `vsce` stores `LICENSE` as `LICENSE.txt` inside the package; its content is byte-identical (MIT, Copyright (c) 2026 Stefan Suess). Source logs, stores, tests and local caches never ship. Because `README.md` ships in the VSIX, its links must be absolute.

Packaging check after `pnpm package:vsix`: `unzip -l dist/cyclegauge-0.5.1.vsix` must list exactly `extension/package.json`, `extension/readme.md`, `extension/LICENSE.txt`, `extension/dist/extension.cjs`, `extension/assets/branding/cyclegauge-icon-256.png` plus the two VSIX manifest files (7 entries, no `src/`, tests, logs or stores), and `unzip -p dist/cyclegauge-0.5.1.vsix extension/LICENSE.txt | cmp - LICENSE` must report no difference. `tests/unit/identity.test.ts` also pins the `.vscodeignore` allowlist.

## Verification and remaining limits

The commands above are the full local check.

The unit/integration suite uses invented records and temporary synthetic sources only, including the existing invented account log fixture. It checks precision, privacy sentinels, DST, source scope and symlinks, read-only file/directory behavior, concurrent source mutation, transactions, restart/deduplication, same-size replacement, corruption, account isolation, conflicts, freshness and cycle transitions.

Verified here: synthetic tests on macOS and live VSIX installation, activation, status bar and detail view in Kiro 1.2.56. The collector was previously reported live-tested by the user. Windows, Ubuntu and RHEL are **unverified targets**, not compatibility claims. Windows is additionally blocked by ACL support. Live SQLite/WAL safety for Kiro's own cache remains unproven, so that adapter is disabled and explicitly unavailable. Format stability, service latency, nonnumeric rotation naming, unknown populated bonuses and historical source timezone changes remain limitations. Not implemented: session aggregation, statistical probability estimates and a background daemon. The session-only Cost Optimizer is implemented (see [cost-optimizer.md](cost-optimizer.md)).

## Naming and identifiers

| Kind | Value today | Note |
| --- | --- | --- |
| Public repository | `StefanSuess/Cyclegauge` | The old `EasyKiroGauge` URL redirects. |
| Brand / product display name | Cyclegauge / Cyclegauge for Kiro IDE | User-visible text only. |
| npm package / extension name | `cyclegauge` | Previously `easykirogauge`. A new extension ID is a distinct extension; see [identity-migration.md](identity-migration.md). |
| Publisher | `easykirogauge` | **Provisional**; the final Open VSX namespace is not decided. |
| Command IDs, settings keys, webview panel ID | `cyclegauge.*` | The four v0.5.1 command IDs keep `easykirogauge.*` aliases and the old settings keys remain a deprecated fallback. |
| Storage folder | `EasyKiroGauge` under the platform data directory | Unchanged on purpose; no storage migration without a separate security review. |

The identifier table lives in code in `src/extension/identity.ts`; the technical identity design and its transition rules are in [identity-migration.md](identity-migration.md).
