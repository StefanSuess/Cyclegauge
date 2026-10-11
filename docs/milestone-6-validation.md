# Milestone 6 validation record (cross-platform, 0.6.0)

Plan: [`docs/superpowers/plans/2026-10-10-milestone-6.md`](superpowers/plans/2026-10-10-milestone-6.md).
Branch: `feature/cross-platform`, created from tag `v0.5.1` (`9ac4c0d`) and pushed to the private
origin as preliminary, non-release work. `main` and `v0.5.1` are untouched.

**Current position: Security Checkpoint SC1 is open.** Task 0 is complete, the Windows ACL
proof-of-concept (Task 1A) has run on real Windows Server runners and is accepted as technically
viable there, and the RHEL 9 survey (Task 1B) is prepared but **has not been run on a RHEL host**.
SC1 stays open until native Windows 11 standard-user evidence and the RHEL 9 R0/R1 survey are
reviewed. The `win32` fail-closed restriction in `src/paths.ts` is untouched and a regression test
pins it. Independent Tasks 2, 3 and 6 may proceed (approved 2026-10-11); Tasks 4, 5 and 7 are gated.

Evidence labels: **[observed]** run in this repository, **[documented]** vendor documentation,
**[reported]** by the project owner, **[inferred]**, **[unverified]**. Verification levels C1–C4 are
defined in the plan, section 1.

## 1. What was actually run, and where

### 1.1 GitHub Actions: run 38095926725, commit `a7d470c`

GitHub Actions run `38095926725` on the private origin — **11 of 11 jobs
succeeded** **[observed]**. Four earlier runs on the same branch failed for harness defects in
this repository's own proof-of-concept code (see section 3.3); none of them changed production code.

| Environment | Jobs | Result | Level |
| --- | --- | --- | --- |
| macOS (`macos-latest`), Node 24.13.0 and 24.x | 2 | typecheck, 184 baseline, PoC tests, fixture validator pass | C2 (C3 for POSIX permission tests) |
| Ubuntu 24.04 and 22.04, Node 24.13.0 and 24.x | 4 | same checks pass | C2, C3 for POSIX rules |
| UBI 9 container, non-root, Node 24.13.0 | 1 | baseline + PoC tests pass; survey script exercised | C2 (RHEL 9 userland, **no SELinux, no Kiro**) |
| Windows Server 2022 (10.0.20348) and 2025 (10.0.26100), Node 24.13.0 | 2 | typecheck, LF checkout, PoC tests, validator pass; **baseline 162/184**, the 22 failures are exactly the Store-using tests (identical on both) | C2; fail-closed behaviour as designed |
| Windows ACL proof-of-concept, same two runners | 2 | see section 3.2 | C3 on **Windows Server, elevated administrator**, not Windows 11 |

The 22 Windows baseline failures are the tests in the CLI, collector, store-safety and extension
controller/detail-view paths. They fail because `prepareStorage` still refuses `win32`; this matches
the prediction in section 2 and is the intended state.

Node 24.13 compatibility: the floor version is exercised by every `verify`, `windows` and `ubi9`
job above, and was also run locally (section 1.2).

### 1.2 Local, macOS arm64, 2026-10-11

| Check | Node 26.11.1 | Node 24.13.0 |
| --- | --- | --- |
| `tsc --noEmit` | pass | pass |
| Baseline suite `tests/unit` | 184 / 184 | 184 / 184 |
| PoC tests `tests/poc` (grew from 35 to 37 during CI iterations) | pass | pass at 35 |
| `tests/fixtures/kiro/validate.py`, `git diff --check` | pass | — |
| `vsce ls` package contents | `README.md`, `package.json`, `dist/extension.cjs` (unchanged allowlist) | — |

Node 24.13.0 was the official darwin-arm64 tarball from nodejs.org checked against the published
`SHASUMS256.txt` (the list itself was not signature-verified), used from the session scratchpad.

**What this shows and does not show.** It shows 0.5.1 behaviour is intact on macOS, Linux and (for
non-storage tests) Windows under the declared Node floor, and that the Windows ACL mechanism works
on Windows Server. It shows nothing about native Windows 11, standard-user behaviour, managed
profiles, RHEL 9 with SELinux, or Kiro at runtime.

## 2. Task 0 — branch, `.gitattributes`, CI skeleton

| Deliverable | State |
| --- | --- |
| `feature/cross-platform` from `v0.5.1` | done |
| `.gitattributes` (`* text=auto eol=lf`, binary types) | done; all 87 tracked text files already have LF in the index, so normalisation is a no-op **[observed]** (`git ls-files --eol`) |
| `package.json` | scripts `test:poc` and `poc:win-acl` added; version, dependencies, manifest contributions unchanged |
| `tsconfig.json` | `include` extended to `tests/poc` and `scripts` so the new code is type-checked |
| `.github/workflows/ci.yml` | jobs `verify` (macOS, Ubuntu 24.04/22.04 × Node 24.13.0/24.x), `windows` (2022/2025), `windows-acl-poc` (2022/2025), `ubi9` (digest-pinned container, non-root, `--network none`) |
| Workflow hygiene | `permissions: contents: read`, no secrets, `persist-credentials: false`, actions pinned to the SHAs of `actions/checkout` v4.2.2 and `actions/setup-node` v4.4.0 (resolved through the public GitHub API), pnpm pinned to the version used locally (12.10.1) |

Status of the earlier open points: the exit criterion "macOS/Linux green; Windows failures
enumerated" is **met** (section 1.1). The predicted Windows failure set was correct (every test that
constructs a Store). The ubi9 job runs the host's Node inside RHEL 9 userland; it has no SELinux and no
systemd and says so in its summary.

## 3. Task 1A — Windows ACL proof-of-concept

### What exists

| File | Role |
| --- | --- |
| `scripts/poc/win-acl/sddl.ts` | Throwaway **pure** SDDL parser and decision functions: directory, file and ancestor rules; rights-mask table; trustee categories. Unknown token ⇒ fixed rejection code. Not the production `src/sddl.ts` (Task 4) and not importable from `src/` (test asserts it) |
| `scripts/poc/win-acl/tools.ts` | System-tool shim (D1): absolute `System32` paths, no shell, timeout and output cap, paths passed through one environment variable and never through script text, `-EncodedCommand`, fixed error codes |
| `scripts/poc/win-acl/poc.ts` | Evidence runner for plan items 1–7 plus failure modes; synthetic directories only; report restricted to fixed tokens and scanned for private values before printing |
| `tests/poc/*.test.ts` | 37 tests: SDDL tables (accept/reject per rule, malformed input, generic-right mapping, inherit-only and deny handling), shim behaviour with a fake runner and with real child processes, leak guard, fail-closed regression |

### 3.2 Results per plan item (CI run 38095926725, identical on Server 2022 and 2025)

All results are from **elevated administrator** runner accounts on Windows Server; none are
Windows 11 client or standard-user evidence.

| # | Plan item | Result | Notes |
| --- | --- | --- | --- |
| 1 | Current-user SID, locale-independent | **established** | `whoami /user /fo csv /nh`; owner of a probe file classified `current_user`. Locale independence observed for `en-US` only (structural argument otherwise) |
| 2 | Descriptor reads, incl. lockdown | **partial** | `Get-Acl`/`Get-Item` batch works in Full and in Constrained Language Mode, results identical, mode read back as effective, .NET method calls **blocked**. "Without elevation" **not observed** (integrity `high`) |
| 3 | Child in a T-only parent is T-only on creation | **established** | 20/20 directories and 20/20 key files T-only, every ACE inherited; loose-parent control rejected |
| 4 | Protect step never broader than T | **established** | `icacls /inheritance:d`: T-only and protected after, same entries, later parent change blocked, unprotected control broadened; 5,444–11,370 descriptor samples saw only the two expected states (unprotected, protected), ~18 ms. Instants cannot be observed; atomicity rests on documentation |
| 5 | Default-profile ancestors pass; loosened rejected | **established (runner profile)** | 12/12 negative controls as expected; runner profile chain passed 5/5 ancestors; leaf passes as T-only parent and fails the protected-directory rule (`PPPuu` / `uPPuu`) |
| 6 | Junction, 8.3, `nlink`, `bigint` identity | **established** | Junction seen by `lstat` and by reparse attribute; `nlink` 1→2; identity equal through hard link, case variant and 8.3 name; short names enabled; `os.tmpdir()` is in 8.3 form; file IDs 51 bit here; non-ASCII path transport works |
| 7 | Launch cost | **established** | `whoami` p95 ≈ 29 ms, PowerShell batch p95 ≈ 430–440 ms (Constrained ≈ 440 ms), Store-open estimate ≈ 463 ms against a 1 s budget |
| — | Failure modes | **established** | tool missing, timeout, output cap, garbage, index mismatch, `\|`/UNC/relative path: all fixed codes |

Not covered by any CI evidence: non-elevated behaviour, a default Windows 11 client profile,
managed-profile ACL additions, enforced (WDAC/AppLocker) Constrained Language Mode, ReFS/Dev Drive,
OneDrive-redirected profiles, instantaneous races.

### 3.3 Harness defects found by the CI iterations (not product defects)

| Run | Defect | Fix |
| --- | --- | --- |
| 1 | Leak guard discarded the entire report because the schema string contained `/`; survey tests ran under Git Bash on Windows; `os.userInfo()` threw in a container | lenient sanitiser listing key paths only; survey tests skip on win32; guarded call |
| 2 | `SystemRoot` read from a spread copy of `process.env`, which loses case-insensitivity (Git Bash exports `SYSTEMROOT`) | case-insensitive lookup; Windows Python needs `tzdata` for the validator |
| 3 | Built-in RID-500 account is rendered as SDDL alias `LA` and was treated as a foreign trustee, which made items 3–5 fail and made rejection controls pass for the wrong reason | `LA` resolved to the current user only when the user's SID has RID 500 |
| 4 | Owner cross-check in item 1 did not resolve `LA` | same resolution, owner category reported |

The third row matters for the production design: alias handling is a security decision, and a
parser that does not resolve an alias can silently turn a rejection control into a vacuous pass.

### 3.4 Findings and approved design decisions (SC1, 2026-10-11)

The findings below were raised during the proof-of-concept; the right-hand column records the
approved decision.

| # | Finding | Decision |
| --- | --- | --- |
| 1 | The plan required the immediate parent to be protected; a real profile's `AppData\Local` inherits its DACL and is not protected, so the literal rule fails the default location | **Approved:** the immediate parent must be T-only and safely inheritable; it does not itself need a protected DACL provided actual trustees, rights and the ancestor invariants pass. The **storage directory** must have a protected, verified DACL |
| 2 | Node reports only symlinks and junctions as links | **Approved:** the Windows guard reads reparse attributes and rejects any reparse tag |
| 3 | 8.3 short names defeat string containment; `os.tmpdir()` is in short form on runners | **Approved:** canonical path or file-identity validation |
| 4 | NTFS file IDs can exceed 2⁵³ | **Approved:** `bigint` identities where required; macOS fingerprint format unchanged |
| 5 | `/inheritance:d` (not `:r`) is the protect step | Confirmed by items 3–4 |
| 6 | Constrained Language Mode blocks .NET calls | Confirmed (item 2); the verified private parent stays the only creation mechanism |
| 7 | SDDL aliases are decisions, not lookups | **Approved:** known aliases resolved explicitly, unrecognised or ambiguous aliases rejected |
| 8 | System-executable architecture (D1) | **Approved to continue**; native addon still needs separate approval |
| 9 | Windows fail-closed restriction | **Preserved** until a separate SC1 approval |
| 10 | RHEL 9 network/local storage policy | **Provisional** until the native survey is reviewed |

### 3.5 Windows feasibility

- **Mechanism: technically viable on the tested Windows Server environments (accepted by the
  project owner on 2026-10-11).** Reads, private-parent creation, the protect step, ancestor rules
  and latency behaved as designed on real NTFS.
- **Windows 11: unproven.** Standard-user, default client profile, managed-profile and enforced
  Constrained Language Mode behaviour need the native run.
- **Fail-closed behaviour is unchanged.** If the native run cannot establish items 1–5, the `win32`
  throw stays and 0.6.0 does not claim Windows 11.

## 4. Task 1B — RHEL 9 environment survey

Deliverables: [`scripts/poc/rhel9-survey.sh`](../scripts/poc/rhel9-survey.sh) and the runbook with
evidence template in [`docs/platform-verification.md`](platform-verification.md).

Verified locally **[observed]**, on macOS with `sh` and `dash`: syntax; every output line matches
`key=value` with a restricted alphabet; no private value (home path, user name, host name, a path
containing `;` and spaces, mount source, IP address, export name) appears in the output; mountinfo
classification and option allow-listing from an invented mountinfo; symbol-version aggregation from
invented ELF-like files; the Kiro directory is classified without echoing names; nothing under the
inspected directories changes; the script contains no mutating, privileged or network command.

**Not verified:** behaviour on RHEL 9 itself (`getenforce`, `id -Z`, `systemd-tmpfiles
--cat-config`, `ldd`, SELinux-labelled `ls -Z`). The CI container job exercises the script on RHEL 9
userland and will show which Linux-only branches work, but that is not a RHEL host and has no SELinux.

Nothing was run against any workplace machine or Kiro data. The survey, R1 and the later native
phases are to be performed by the project owner on an authorised host.

## 5. Remaining risks

| Risk | Status |
| --- | --- |
| Windows PowerShell strings or `icacls` argument forms are wrong in some detail | Resolved on Server 2022/2025 (run 38095926725) |
| Runner is elevated Windows Server, not a standard-user Windows 11 | Item 2 `partial`; native Windows 11 standard-user run required |
| Path-based checks cannot close all races (Node has no handle-relative descriptor API); filter drivers not modelled | Accepted limitation per plan; to be stated in release text |
| Managed profiles with extra ACEs fail closed | Expected; PoC reports offender categories without identifiers |
| Environment inherited by the PowerShell child (`PSModulePath`, profile) could redirect `Get-Acl` | Same-user attack, out of scope per threat model; `-NoProfile` used, fully qualified module call is an open hardening option for Task 5 |
| RHEL home may be network storage; no acceptable local location may exist | Decided only after R0; plan allows the gate to fail honestly |
| `ldd` runs the loader on vendor binaries | Documented; `EKG_SURVEY_NO_LDD=1` skips it |
| No evidence for SELinux behaviour, `noexec`, fapolicyd | Native RHEL 9 only (L4–L8) |
| Action SHAs resolved today; no re-verification mechanism yet | Review at SC3 |

## 6. Security Checkpoint SC1 — record

Status: **open.** Design decisions were approved on 2026-10-11 (section 3.4); enablement is not.

- [x] Windows PoC report from Windows runners reviewed against items 1–7 (run 38095926725; accepted as technically viable on Windows Server).
- [x] Decision on the parent-rule wording: T-only, safely inheritable parent; protected, verified storage directory.
- [x] Alias handling, reparse attributes, canonical path or identity, `bigint` identity, system-executable architecture approved.
- [ ] Windows PoC report from a native Windows 11 **standard-user** account (managed or lab VM), or an explicit decision to treat Windows 11 as not claimed.
- [ ] RHEL 9 R0 survey record and R1 result reviewed (project owner, authorised host).
- [ ] Storage policy finalised from R0, including the configured-local-location design if the home is networked.
- [ ] Windows enablement confirmed, or the fail-closed throw explicitly retained for 0.6.0.

Until the open boxes are checked, Tasks 4, 5 and 7 do not start. Tasks 2, 3 and 6 are independent
of SC1 and are authorised; they must not change Windows ACL enforcement or remove the `win32`
restriction, and are not committed or pushed without separate approval.

## 7. Tasks 2, 3 and 6 — independent implementation (SC1-independent)

Approved 2026-10-11. **No Windows ACL enforcement was added and the `win32` fail-closed
restriction is unchanged** (`guardFor('win32')` refuses every operation and a test pins it).

| Task | Change | Evidence |
| --- | --- | --- |
| 2 | `src/guard.ts`: `StorageGuard` with the POSIX 0700/0600/uid/nlink/sidecar checks moved verbatim; `paths.ts` and `store.ts` delegate to it; pure `defaultSourceFor`/`defaultStorageFor(platform, env, home)` ignore empty, relative and (for storage) UNC values | `paths-platform`, `posix-storage` tests; a store written by 0.5.1 is read by this code and vice versa with identical import results and 0700/0600 modes **[observed, macOS, Node 26.11.1 and 24.13.0]** |
| 3 | `src/runtime.ts` capability probes (`node:sqlite` via `process.getBuiltinModule`, reviver source text), lazy SQLite, fixed `RUNTIME_UNSUPPORTED` before anything is created; `src/diagnostics.ts` and `--diagnostics`; extension source root = setting, then `context.logUri` root, then platform default; "Show Diagnostics" command | `runtime-probe`, `runtime-unsupported-ui`, `diagnostics` tests (including `--no-experimental-sqlite` runs) |
| 6 | `bigint` `dev`/`ino` identity in `readLog`; fingerprint text format unchanged for ordinary values; case-insensitive path equivalence (and `\\?\`/`\\?\UNC\` prefixes) on Windows only; UNC storage rejected | `source-identity` test compares the fingerprint to the exact 0.5.1 formula |

Open items: native confirmation that `context.logUri` has the assumed shape on each OS; Windows CI
run of the new tests (pending); Tasks 4, 5 and 7 remain gated by SC1.

## 8. Independent review passes over Tasks 2, 3 and 6 (2026-10-11)

Three read-only review passes (security and privacy, cross-platform correctness, maintainability)
were run over commit `e7e5703`. Every accepted finding was reproduced with a synthetic test before
the fix. No finding was high or critical; none touched Windows enforcement.

| Pass | Finding | Resolution |
| --- | --- | --- |
| CI | `source-identity` real-file test failed on Windows runners: `os.tmpdir()` is an 8.3 path, `fs/promises.realpath` expands it, `samePath` rejected it | `samePath` accepts a component that is the 8.3 alias of the long name (prefix-checked, `+ , ; = [ ]` mapped to `_`); the test keeps the 8.3 temp path on purpose |
| Security | Device/UNC namespaces (`//?/UNC/`, `\\.\`) not recognised; check ran on the raw string only | any double-separator prefix except `\\?\C:\` is a network/device path; checked on raw and resolved path |
| Security | Workspace settings could set `sourceRoot`/`storageRoot` | both settings are `scope: machine` (test pins it) |
| Security | `inside()` case-sensitive on macOS now that the root can have any name | case folded on macOS/Windows (only rejects more); extended prefixes stripped on Windows |
| Security | `prepareStorage(…, platform)` not fail-closed on a real Windows host | a real `win32` host always uses the refusing guard |
| Security/Cross | Configured source root could be relative or padded | must be absolute and untrimmed, otherwise ignored |
| Cross | `homedir()` evaluated eagerly (regression for hosts without a passwd entry) and CLI stage order changed | home is resolved lazily; CLI sets its stage before default resolution as in 0.5.1 |
| Cross | `logUri` outranked the platform default in non-Kiro hosts (VS Code, Cursor) | `logUri` is used only when `vscode.env.appName` is Kiro (unverified label, see below) |
| Maintain | Diagnostics collapsed every source code to `other_code` and overwrote counts | token alphabet includes `_`; counts are summed; test asserts the codes |
| Maintain | `STORAGE_PERMISSIONS_UNSUPPORTED` could never be observed | single allowlisted pass-through to CLI and extension (own label); other failures stay generic |
| Maintain | Vacuous or conditional tests; CI grep under `pipefail`; stale labels | tightened or fixed; verify job no longer skips PoC tests after a failure; main-branch runs not cancelled |

Accepted, not changed:

- **Fingerprint for inode >= 2^53.** 0.5.1 printed a rounded float; the exact `bigint` is printed
  now, so such a file produces one `source_changed` after upgrade. Ordinary identities (macOS APFS,
  NTFS ids seen on runners, 51 bit) are byte-identical.
- **Guard seam for Task 5/7.** `Store` still creates files itself and the guard is synchronous;
  `prepareStorage` owns the network-path check. A Windows guard will need `createFile` on the
  interface and async tool calls. This is deliberately left for the gated tasks.
- **Windows baseline.** The failing-test list is printed, not compared with an expected-failures file.
- **Host label.** `vscode.env.appName` containing the word "Kiro" is assumed; it is not yet verified
  on a native Kiro install.

## 9. CI outcomes for Tasks 2, 3 and 6 and the review fixes

| Commit | Run | Result | Windows Server unit suite (2022 and 2025, identical) |
| --- | --- | --- | --- |
| `e7e5703` Tasks 2/3/6 | `38098345669` | 11 of 11 jobs green | 209 tests, 183 pass, 23 fail: the 22 Store-using tests plus `source-identity` (8.3 temp path, fixed in `88f6ea2`) |
| `88f6ea2` review fixes | `38098859626` | 11 of 11 jobs green | 213 tests, 187 pass, 23 fail: the 22 Store-using tests plus `invalid/unsafe store emits only fixed CLI failure codes` |

The last Windows-only difference is intended. That original baseline test builds a 0755 directory and
expects `STORAGE_UNAVAILABLE`; on Windows the CLI now reports the allowlisted
`STORAGE_PERMISSIONS_UNSUPPORTED` instead, because the refusing guard is reached first. It is still
fail-closed and creates nothing. The test is POSIX-specific; it should be split when Task 5 lands.

Per platform (all `88f6ea2`, Node 24.13.0 and 24.x where stated): macOS, Ubuntu 24.04 and 22.04 run
typecheck, the full unit suite, the PoC suite and the fixture validator; the UBI 9 container runs
the unit and PoC suites as a non-root user (no SELinux, no Kiro); both Windows Server runners pass
typecheck, PoC tests and the validator, and execute the unchanged ACL proof-of-concept with the
same outcomes as run `38095926725`.

Local (macOS arm64, Node 26.11.1 and 24.13.0): typecheck, 213 unit and 37 PoC tests, fixture
validator, bundle build with no local path in the output, unchanged VSIX file list, and a 0.5.1
store opened by this code and the reverse with identical import results and 0700/0600 modes.

Evidence still outstanding: native Windows 11 standard-user ACL run, RHEL 9 R0/R1 survey, and a
native Kiro run to confirm `context.logUri` shape and `vscode.env.appName` on each OS.

## 10. Task 8 regression tests, release tooling and the non-elevated launcher (uncommitted work)

Status of this section: **local verification only** (macOS arm64, Node 26.11.1 and 24.13.0). None of
the new CI jobs below has run on GitHub Actions yet; they are written, YAML-validated and reviewed,
not observed.

### 10.1 Task 8: rotation, concurrency and watcher failure

New files: `tests/unit/resilience.test.ts` (collector and store), `tests/unit/resilience-extension.test.ts`
(controller), `tests/unit/no-symlinks.test.ts`. All synthetic. Storage-dependent tests are skipped on
Windows while storage there stays refused.

| Scenario | Evidence |
| --- | --- |
| Rotation (`.log` to `.1` to `.2`), replacement by rename, truncation and regrowth, partial then completed record, CRLF | observations are never re-imported or lost; stored history is never zeroed |
| Removed file, vanished source root, directory/FIFO named like a log, oversize and observation limits | fixed codes, no blocking, stored observations kept, no zero usage invented |
| Three windows, three store connections, five rounds; four simultaneous CLI processes on a new store | one deduplicated history; every unique observation imported exactly once |
| Watcher that throws or never fires, event storm, disposal during a refresh, source appearing late | polling alone recovers; no throw; no update after disposal |

Defects found by these tests and fixed (each reproduced first):

1. **Empty `device.key` read.** A second window starting while the first was still writing the new key
   failed with `STORAGE_UNAVAILABLE` (3 in 480 simultaneous initialisations). `Store` now waits up to
   200 ms for the other writer; it never replaces the key and still rejects a key that stays short.
2. **`noSymlinks` check-then-use race.** An `existsSync` followed by `lstat` threw `ENOENT` when another
   window removed the file in between (a SQLite journal). It is now a single `lstat` per component.
3. **Watcher registration failure** could abort activation; the controller now tolerates it and
   polling stays authoritative.
4. **Journal deleted by another window.** The sidecar check could see a SQLite `-journal` with zero
   links while another window removed it (about 1 in 2,000 simultaneous initialisations on macOS) and
   refused the store with `UNSAFE_STORAGE`. A sidecar with zero links is now treated as absent; the key
   and database are never given that allowance, and every other anomaly is still refused. After the
   four fixes, 11,520 simultaneous initialisations (24 rounds of 8 processes) produced no failure.

The tests deliberately do not pin `source_changed` except in one labelled characterisation test, because
that code fires on every append (the stored fingerprint includes the whole-file digest). That is
existing behaviour and was not changed.

### 10.2 Release verification tooling (Task 9, partial)

`scripts/release/`: `zip.ts` (defensive reader, no extraction), `verify-vsix.ts` (exact content
allowlist, manifest and bundle checks, per-file SHA-256, payload comparison), `build-vsix.ts` (staged
build that never touches `dist/`), `smoke-bundle.ts` (shipped bundle against a stub host, with
`no-sqlite`, `no-reviver` and `no-watcher` simulations), `synthetic-root.ts` (invented log trees for
acceptance runs). Tests: `tests/release/*` (19). Run with `pnpm test:release`.

Not done and not claimed: native Kiro installation or activation, a Kiro-hosted extension host, any
real account data. A passing smoke test means the bundle loads and degrades safely against a stub.

### 10.3 Non-elevated Windows evidence (Workstream B)

`scripts/poc/win-acl/nonelevated.ts` re-runs the existing proof-of-concept under a Safer "Basic
User" token (`runas /trustlevel:0x20000`: privileges are removed from a copy of the caller's own
token; no account is created and no setting is changed). The verdict is computed only from the
integrity level the child measured about itself (`obtained` for medium or low, otherwise
`not_obtained`; an elevated run is never labelled non-elevated). CI job
`windows-acl-poc-nonelevated` runs it on Server 2022 and 2025.

Feasibility is **unknown until the job runs**: if `runas /trustlevel` does not reduce the token on a
hosted runner the job reports `not_obtained` and a warning annotation. Any result is Windows Server
evidence, not Windows 11 client evidence and not a managed-profile result.

### 10.4 Independent review of this round

Two read-only review passes (test quality; release tooling and launcher) produced the following
accepted fixes: vacuous polling tests now wait for the poll trigger; cleanup runs on failure;
the ZIP reader reconciles the directory with the end record (hidden entries, trailing data,
comments); entry-point detection resolves symlinks (a gate could previously exit 0 without running);
missing CLI values are usage errors; leak patterns cover hidden directories and more credential
shapes; the launcher cannot derive `already` without a measured level and no longer fails on a
failure report; CI compares the downloaded candidate's SHA-256 and emits warnings for non-obtained
or differing results.

Accepted risk: the key wait blocks the extension host thread for at most 200 ms per attempt, and
repeats on each poll while a key stays permanently short (for example after a crashed first writer).
