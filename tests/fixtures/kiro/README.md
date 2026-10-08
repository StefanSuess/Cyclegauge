# Synthetic Kiro data fixtures

Every date, amount, identifier, and content marker here is invented. No file is a copied or redacted Kiro record. These fixtures describe proposed extraction contracts from the observed structures documented in [kiro-data-format.md](../../../docs/kiro-data-format.md).

## Files

| File | Purpose |
| --- | --- |
| `account-snapshots.log` | Timestamped command envelopes; fractional counters, duplicate/out-of-order observation, and cycle change across a gap |
| `ide-events.jsonl` | Two usage summaries on different Berlin calendar days, a duplicate, and an unrelated synthetic content record |
| `cli-session.json` | A turn with two metering entries and a turn without metering; no aggregation semantics assumed |
| `usage-cache.json` | Older cached snapshot; timestamp remains old when reread; unverified cache `type`/`unit` enums intentionally omitted |
| `malformed-and-partial.txt` | Two valid JSON records, one malformed complete line, and an incomplete trailing line without newline |
| `expected.json` | Expected billing-only projections/counts; decimal strings express exact expected values; unknowns are `null` |
| `scenarios.json` | Twenty synthetic edge-case contracts; normalized fields are design notation, not additional observed Kiro fields |
| `validate.py` | Standard-library fixture consistency validator; never reads Kiro data |

The account log's `synthetic-envelope` prefix is invented filler; only its timestamp/level and command JSON reproduce relevant observed structure. Private and unnecessary fields are mostly omitted. Inert markers and `synthetic-*` identifiers deliberately exercise allowlist requirements. No marker is a credential, real prompt, source snippet, or real identifier.

The known latest account amount is **0.80**. The separate IDE observed local total is **0.30**, split into **0.10** on June 29 and **0.20** on June 30 in Europe/Berlin. These totals must never be added or used to overwrite each other. The same-cycle account interval change is **1.25**; consumption during the later gap and either side of the reset remains unknown.

CLI entries **0.10, 0.30** intentionally admit different interpretations. The expected total is **unknown**. The hypothetical additive result **0.40** and cumulative-final-last result **0.30** are arithmetic examples only; neither establishes Kiro semantics or enables CLI aggregation. Empty metering is missing data, not a zero-credit turn.

## Validation

From the repository root:

```sh
python3 tests/fixtures/kiro/validate.py
git diff --check
```

Python 3.9+ and IANA timezone data are required. On systems without zoneinfo data (notably some Windows Python installations), supply a Python environment with `tzdata` before running validation. This prerequisite is not evidence that the application supports that platform.

The validator checks strict JSON/JSONL syntax (with intentional malformed/partial exceptions), Decimal arithmetic, timestamp conversions, DST day lengths and ambiguity, deduplication expectations, separate account/local totals, unknown CLI totals, privacy projections, and consistency of the twenty scenario contracts. It uses no network, credentials, source databases, or live Kiro files and creates no artifacts.

**Validation scope:** this is fixture/reference arithmetic only. Passing does not prove a production parser, sidecar-safe SQLite access, crash recovery, cross-platform file watching, or privacy enforcement in an application. Those components do not exist yet. In particular, the WAL scenario asserts an expected unavailable status; it does not exercise a database driver.
