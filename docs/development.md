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

Equivalent manual build: `./node_modules/.bin/tsc --noEmit`, then esbuild to `dist/extension.cjs`, then `./node_modules/.bin/vsce package --no-dependencies --out dist/` (see the `scripts` in `package.json`). The VSIX allowlist in `.vscodeignore` is exactly `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `dist/extension.cjs` and `assets/branding/cyclegauge-icon-256.png` (the packaged extension icon); `vsce` stores `LICENSE` as `LICENSE.txt` inside the package; its content is byte-identical (MIT, Copyright (c) 2026 Stefan Suess). Source logs, stores, tests and local caches never ship. Because `README.md` ships in the VSIX, its links must be absolute.

Packaging check after `pnpm package:vsix`: `unzip -l dist/cyclegauge-<version>.vsix` must list exactly `extension/package.json`, `extension/readme.md`, `extension/LICENSE.txt`, `extension/changelog.md`, `extension/dist/extension.cjs`, `extension/assets/branding/cyclegauge-icon-256.png` plus the two VSIX manifest files (8 entries, no `src/`, tests, logs or stores), and `unzip -p dist/cyclegauge-<version>.vsix extension/LICENSE.txt | cmp - LICENSE` must report no difference. `tests/unit/identity.test.ts` also pins the `.vscodeignore` allowlist. For release candidates use the content verifier instead of eyeballing: see [release-process.md](release-process.md).

## Reproducible synthetic native-acceptance setup

Run from the repository with Python 3 and Node.js 24.13+. This creates a **new empty**, canonical private temporary profile; every account, amount and log envelope below is invented. It reads no existing Kiro data and does not launch Kiro. Keep the printed `$D` in the same shell for the acceptance steps.

```sh
D=$(mktemp -d /private/tmp/synthetic-cyclegauge-acceptance.XXXXXX)
export D
python3 - "$D" <<'PYSETUP'
import json, os, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.umask(0o077)
d = Path(sys.argv[1]).resolve(strict=True)
if not d.is_dir() or any(d.iterdir()):
    raise SystemExit("SETUP_REQUIRES_NEW_EMPTY_DIRECTORY")
# Optional second argument is a UTC ISO anchor for deterministic verification only.
anchor = (datetime.fromisoformat(sys.argv[2].replace("Z", "+00:00"))
          if len(sys.argv) == 3 else datetime.now(timezone.utc))
if anchor.utcoffset() != timedelta(0):
    raise SystemExit("ANCHOR_MUST_BE_UTC")
anchor = anchor.replace(microsecond=0)
source = d / "source"
logdir = source / "logs/synthetic-run/synthetic-window/exthost/kiro.kiroAgent"
storage = d / "home/Library/Application Support/Cyclegauge"
for folder in (logdir, d / "home", d / "user-data/User", d / "extensions", d / "workspace"):
    folder.mkdir(parents=True, exist_ok=True)
settings = {
    "cyclegauge.sourceRoot": str(source),
    "cyclegauge.storageRoot": str(storage),
    "cyclegauge.sourceTimezone": "UTC",
}
(d / "user-data/User/settings.json").write_text(json.dumps(settings, indent=2) + "\n")
lines = []
for offset in range(35, -1, -1):
    at = anchor - timedelta(days=offset)
    start = at.replace(day=1, hour=0, minute=0, second=0)
    reset = (start.replace(year=start.year + 1, month=1) if start.month == 12
             else start.replace(month=start.month + 1))
    # 20 invented credits/day; reset the counter at each UTC calendar boundary.
    usage = 20 * (at.day - 1) + 10
    envelope = {"commandName": "GetUsageLimitsCommand", "input": {}, "output": {
        "userInfo": {"userId": "synthetic-acceptance-account"},
        "nextDateReset": reset.isoformat().replace("+00:00", "Z"),
        "usageBreakdownList": [{"resourceType": "CREDIT", "unit": "INVOCATIONS",
            "currentUsageWithPrecision": usage, "usageLimitWithPrecision": 5000,
            "nextDateReset": reset.isoformat().replace("+00:00", "Z"),
            "bonuses": [], "overageCredits": []}]}, "metadata": {"httpStatusCode": 200}}
    lines.append(at.isoformat().replace("+00:00", "Z") + " [info] synthetic-envelope "
                 + json.dumps(envelope, separators=(",", ":")) + "\n")
(logdir / "q-client.log").write_text("".join(lines), encoding="utf-8")
(d / "synthetic-anchor.txt").write_text(anchor.isoformat().replace("+00:00", "Z") + "\n")
print("SYNTHETIC_SETUP_READY: 36 invented daily observations; reported limit 5000; UTC")
PYSETUP
printf '%s\n' "$D"
```

The last observation is at generation time (never in the future), and resets are the first of the next UTC month **per record**. The 35-day span supplies pooled history even on the first days of a month. For identical bytes, pass the recorded UTC value in `synthetic-anchor.txt` as the Python block's second argument when creating another empty profile. A fixed old anchor is for parser verification only; regenerate with the current clock for native acceptance. If the setup is over 24 hours old, create a new empty profile and rerun; do not reinterpret stale fixtures as fresh. No source time zone ambiguity: `cyclegauge.sourceTimezone` explicitly uses `UTC` and every log timestamp carries `Z`.

Optional CLI preflight (invented records only; run once per new profile, because another import deduplicates instead of importing 36 anew). Use a separate owned directory so the native storage directory is initially empty:

```sh
node --disable-warning=ExperimentalWarning src/cli.ts --source-root "$D/source" --source-timezone UTC --store-dir "$D/preflight-store" --json > "$D/preflight.json"
node - "$D/preflight.json" <<'JSCHECK'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (report.observation.status !== 'observed' || report.observation.forecast.status !== 'qualified'
    || report.observation.forecast.tier !== 'regular' || report.import.imported !== 36) {
  throw new Error('SYNTHETIC_PREFLIGHT_FAILED');
}
console.log('SYNTHETIC_PREFLIGHT_PASS');
JSCHECK
```

Launch/install instructions are in [macos-acceptance.md](macos-acceptance.md). Expected fresh state: regular forecast, reported limit 5000, low invented usage and next UTC reset. In **Cyclegauge: Cost Advisor**, select **Pro Max**, **Personal subscription (consumer)** and **No purchased add-on credits**. Expect an explicitly modelled next-cycle USD difference and expandable 1/3/6-cycle sensitivity; no supported or guaranteed savings claim. Then check cancellation and **Clear my answers**. Changing to Enterprise or reporting add-ons must withhold unsupported figures.

## Verification and remaining limits

The commands above are the full local check. Release tests include loading the packaged Advisor bundle against an invented native host; they do not prove native Kiro behavior.

The unit/integration suite uses invented records and temporary synthetic sources only, including the existing invented account log fixture. It checks precision, privacy sentinels, DST, source scope and symlinks, read-only file/directory behavior, concurrent source mutation, transactions, restart/deduplication, same-size replacement, corruption, account isolation, conflicts, freshness and cycle transitions.

Verified here: synthetic tests on macOS and live VSIX installation, activation, status bar and detail view in Kiro 1.2.56. The collector was previously reported live-tested by the user. Windows, Ubuntu and RHEL are **unverified targets**, not compatibility claims. Windows has a new fail-closed NTFS ACL implementation; native Kiro acceptance remains pending. Live SQLite/WAL safety for Kiro's own cache remains unproven, so that adapter is disabled and explicitly unavailable. Format stability, service latency, nonnumeric rotation naming, unknown populated bonuses and historical source timezone changes remain limitations. Not implemented: session aggregation, statistical probability estimates and a background daemon. The session-only Cost Advisor replaces the standalone Cost Optimizer UI in 0.5.2; native acceptance of the final candidate is pending (see [cost-optimizer.md](cost-optimizer.md)).

## Naming and identifiers

| Kind | Value today | Note |
| --- | --- | --- |
| Public repository | `StefanSuess/Cyclegauge` | Canonical repository for Cyclegauge. |
| Brand / product display name | Cyclegauge / Cyclegauge for Kiro IDE | User-visible text only. |
| npm package / extension name | `cyclegauge` | Extension ID `StefanSuess.cyclegauge`. |
| Publisher | `StefanSuess` | Extension ID `StefanSuess.cyclegauge`. The public registry reports the namespace exists and is unverified (2026-10-12); publishing access is a separate maintainer check. |
| Command IDs, settings keys, webview panel ID | `cyclegauge.*` | Cost Advisor is available as `cyclegauge.costAdvisor`. |
| Storage folder | Editor per-extension storage (`globalStorage/stefansuess.cyclegauge`); CLI: `Cyclegauge` under the platform data directory | Private storage owned by Cyclegauge. |

The identifiers live in code in `src/extension/identity.ts` and the contributed settings live in `package.json`.

## Real extension-host integration

Build a development candidate with `pnpm release:build candidate.vsix --pre-release`, then run `pnpm test:host candidate.vsix` (`xvfb-run -a pnpm test:host candidate.vsix` on headless Linux). CI instead tests the exact shared candidate artifact. See [platform verification](platform-verification.md) for isolation, coverage, host pins and native Kiro limitations.
