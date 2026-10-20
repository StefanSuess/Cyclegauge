# Development, verification and packaging

## Build, test and package

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:release
python3 tests/fixtures/kiro/validate.py
git diff --check
pnpm package:vsix
```

Equivalent manual build: `./node_modules/.bin/tsc --noEmit`, then esbuild to `dist/extension.cjs`, then `./node_modules/.bin/vsce package --no-dependencies --out dist/` (see the `scripts` in `package.json`). The VSIX allowlist in `.vscodeignore` is exactly `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `dist/extension.cjs` and `assets/branding/bobert-icon-256.png` (the packaged extension icon); `vsce` stores `LICENSE` as `LICENSE.txt` inside the package; its content is byte-identical (MIT, Copyright (c) 2026 Stefan Suess). Source logs, stores, tests and local caches never ship. Because `README.md` ships in the VSIX, its links must be absolute.

Packaging check after `pnpm package:vsix`: `unzip -l dist/bobert-<version>.vsix` must list exactly `extension/package.json`, `extension/readme.md`, `extension/LICENSE.txt`, `extension/changelog.md`, `extension/dist/extension.cjs`, `extension/assets/branding/bobert-icon-256.png` plus the two VSIX manifest files (8 entries, no `src/`, tests, logs or stores), and `unzip -p dist/bobert-<version>.vsix extension/LICENSE.txt | cmp - LICENSE` must report no difference. `tests/unit/identity.test.ts` also pins the `.vscodeignore` allowlist. For release candidates use the content verifier instead of eyeballing: see [release-process.md](release-process.md).

## Simple synthetic plugin test

Follow [synthetic-demo.md](synthetic-demo.md) for the short setup and five visible checks. On Windows, macOS and Linux:

```sh
pnpm install --frozen-lockfile
pnpm demo:setup --open
```

This builds the current checkout, creates 36 fresh invented daily observations in a new temporary profile, checks
collector ingestion/deduplication, verifies the VSIX and launches an
isolated Kiro window. Install the printed `install-this.vsix` in that window. No Python setup block or shell variable
is needed. The native store starts empty; automated preflight uses a separate synthetic store.

For release acceptance, preserve the exact verified CI artifact rather than rebuilding:

```sh
pnpm demo:setup --open --vsix "path/to/candidate.vsix"
```

Record its SHA-256 and run id as required by [macos-acceptance.md](macos-acceptance.md). Setup records its UTC anchor
in the printed demo folder's `synthetic-anchor.txt`. Expected usage is `20 × (UTC day of month − 1) + 10`, reported
limit 5000, and a regular pooled forecast. Generation uses the current clock; create a new demo after 24 hours.
Automated preflight success does not verify the native UI or the selected candidate's runtime behavior.

## Verification and remaining limits

The commands above are the full local check. Release tests include loading the packaged Advisor bundle against an invented native host; they do not prove native Kiro behavior.

The unit/integration suite uses invented records and temporary synthetic sources only, including the existing invented account log fixture. It checks precision, privacy sentinels, DST, source scope and symlinks, read-only file/directory behavior, concurrent source mutation, transactions, restart/deduplication, same-size replacement, corruption, account isolation, conflicts, freshness and cycle transitions.

Verified here: synthetic tests on macOS and live VSIX installation, activation, status bar and detail view in Kiro 1.2.56. The collector was previously reported live-tested by the user. Windows 11 Pro and Ubuntu 26 were smoke-tested by the maintainer in native Kiro (development candidate, 2026-10-14; versions not recorded; no itemised acceptance), while RHEL is an **unverified target**, not a compatibility claim. Windows has a fail-closed NTFS ACL implementation for chosen storage locations; itemised native acceptance remains pending. Live SQLite/WAL safety for Kiro's own cache remains unproven, so that adapter is disabled and explicitly unavailable. Format stability, service latency, nonnumeric rotation naming, unknown populated bonuses and historical source timezone changes remain limitations. Not implemented: session aggregation, statistical probability estimates and a background daemon. The session-only Cost Advisor replaces the standalone Cost Optimizer UI in 0.5.2; native acceptance of the final candidate is pending (see [cost-optimizer.md](cost-optimizer.md)).

## Naming and identifiers

| Kind | Value today | Note |
| --- | --- | --- |
| Public repository | `StefanSuess/Bobert` | Canonical repository for Bobert. |
| Brand / product display name | Bobert / Bobert: Kiro Credit Tracker (display name) | User-visible text only. |
| npm package / extension name | `bobert` | Extension ID `StefanSuess.bobert`. |
| Publisher | `StefanSuess` | Extension ID `StefanSuess.bobert`. The public registry reports the namespace exists and is unverified (2026-10-12); publishing access is a separate maintainer check. |
| Command IDs, settings keys, webview panel ID | `bobert.*` | Cost Advisor is available as `bobert.costAdvisor`. |
| Storage folder | Editor per-extension storage (`globalStorage/stefansuess.bobert`); CLI: `Bobert` under the platform data directory | Private storage owned by Bobert. |

The identifiers live in code in `src/extension/identity.ts` and the contributed settings live in `package.json`.

## Real extension-host integration

Build a development candidate with `pnpm release:build candidate.vsix`, then run `pnpm test:host candidate.vsix` (`xvfb-run -a pnpm test:host candidate.vsix` on headless Linux). CI instead tests the exact shared candidate artifact. See [platform verification](platform-verification.md) for isolation, coverage, host pins and native Kiro limitations.
