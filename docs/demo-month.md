# Synthetic demo month (isolated, not real usage)

`scripts/demo/generate-demo-month.mjs` writes an invented Kiro-shaped `q-client.log` covering one complete billing
cycle, the reset, and the current partial cycle (weekday fluctuation, quiet weekends, two heavy agent days per cycle,
a few near-idle days). The application ingests it like any other source: **no derived statistics are inserted anywhere**.
Everything in it is marked `synthetic-demo-*`; no real log, account or identifier was used.

## Layout used for native testing (outside every real profile)

| What | Path |
|---|---|
| Isolated HOME, user data, extensions, store | `~/.ekg-iso-demo/{home,user-data,extensions,storage-parent}` |
| Synthetic source root | `~/.ekg-iso-demo/source` |
| Synthetic workspace | `~/.ekg-iso-demo/workspace/SYNTHETIC-DEMO-NOT-REAL-USAGE` |
| Settings | `sourceRoot`, `storageRoot` and `sourceTimezone` set in the isolated User settings; `window.title` starts with "SYNTHETIC DEMO - not real usage" |

The existing `~/.ekg-iso` test environment is untouched.

## Install the release candidate and open the demo

```sh
D=$HOME/.ekg-iso-demo
HOME=$D/home /Applications/Kiro.app/Contents/Resources/app/bin/code --user-data-dir $D/user-data --extensions-dir $D/extensions --install-extension <path to candidate.vsix>
HOME=$D/home /Applications/Kiro.app/Contents/MacOS/Kiro --user-data-dir $D/user-data --extensions-dir $D/extensions --new-window $D/workspace/SYNTHETIC-DEMO-NOT-REAL-USAGE
```

The last snapshot is generated ten minutes before the generator ran, so the data goes stale after 24 hours; re-run the
generator into a new empty directory (and point `sourceRoot` at it) to refresh. The data is relative to the day it is generated, so it is not identical across days; the same `--seed` gives the same
shape on the same day.

## What a headless check observed (real ingestion path; **not** a native UI check)

Status `Tight • ~31.7/day`, Regular forecast, usage chart present, Cost Advisor *Conditional comparison* with the plan
shown as an unconfirmed hint "Pro", no future-dated notice. This is a synthetic observation only.
