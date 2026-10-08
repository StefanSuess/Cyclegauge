# EasyKiroGauge contributor rules

## Scope and authority

- Follow [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ROADMAP.md](ROADMAP.md).
- This initial phase contains documentation, invented fixtures, and fixture-validation tooling only. Do not implement the application without a subsequent request.
- Account snapshots are authoritative for current **observed account usage**, with an explicit as-of time and freshness status. Session metering provides **observed local daily attribution**, never a replacement account balance.
- Unknown consumption across observation gaps is unknown, not zero. Do not invent daily allocations or sum account snapshots with session totals.
- CLI metering entries must be checked for additive versus cumulative semantics before aggregation. Do not infer semantics from a field name, increasing values, or one sample.

## Strict privacy rules

- Never commit, print, upload, attach, or expose in diagnostics any real raw session data, credentials, authentication material, account/user/session/request identifiers, prompts, source code encountered in Kiro data, tool arguments/results, conversation text, or private workspace paths. This does not prohibit future EasyKiroGauge application code itself.
- Never copy real Kiro logs, databases, transcripts, database backups, or exports into this repository, temporary fixture folders, bug reports, or review packages. Redaction of a copied real session is not an acceptable fixture-generation strategy.
- All fixtures must be invented from scratch. Use obvious `synthetic-*` identifiers and fixed invented dates/numbers. Sensitive-content test markers must be inert invented sentinels, not realistic credentials or copied text.
- Extract only explicitly allowlisted billing fields in memory. Drop every unrecognized field by default. Do not log rejected values, full records, exception representations containing data, dynamic filenames, or local absolute paths. Diagnostics may contain fixed error codes, counts, schema field names, and version/platform metadata only.
- Do not read authentication stores, keychains, cookies, credential files, or authentication table values. Do not invoke Kiro commands, call authenticated Kiro services, or enable verbose logging to obtain more data.
- Do not send locally read data to external services or tools. Public documentation lookups must use generic queries without local identifiers or contents.
- If account continuity requires identifiers, design a narrow in-memory projection and device-local opaque partition key. Never persist raw identifiers or expose opaque identity/deduplication keys in diagnostics. Treat derived identifiers as private too.

## Read-only access

- Kiro-owned files and databases must remain strictly read-only: no migrations, repairs, checkpoints, journal-mode changes, permission changes, sidecar creation, settings changes, session exports, or writes of any kind.
- Use explicit read-only handles and allowlisted paths. Do not recursively import snapshots, source trees, or unrelated directories; reject symlink escapes from configured source roots.
- SQLite `query_only` alone is insufficient. A future reader must prove it cannot create or modify sidecars. `immutable=1` is not a generally correct reader for live databases or WAL content. Unsupported/concurrently changing database states must produce a safe unavailable status, never fabricated current data.
- Write only to EasyKiroGauge-owned storage. Do not put extracted real billing data in the repository. Never use production Kiro data for automated tests or CI.

## Evidence and validation

- Distinguish locally observed, officially documented, inferred, and unverified claims. macOS observations for Kiro 1.2.37 do not verify Windows, Ubuntu, or RHEL.
- Keep monetary amounts, credits, tokens, and context percentages separate. Preserve decimal precision and timestamp offsets; daily timezone and UTC billing boundaries are different concepts.
- Run `python3 tests/fixtures/kiro/validate.py` and `git diff --check` after fixture/documentation changes. The validator checks fixture contracts, not production parser behavior.
- Before committing, inspect the staged file list and verify it contains only intended documents, wholly synthetic fixtures, and validation tooling. Do not stage unrelated files with a blanket add.
