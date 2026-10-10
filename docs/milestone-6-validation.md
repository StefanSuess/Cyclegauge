# Milestone 6 validation record (cross-platform, 0.6.0)

Plan: [`docs/superpowers/plans/2026-10-10-milestone-6.md`](superpowers/plans/2026-10-10-milestone-6.md).
Branch: `feature/cross-platform`, created from tag `v0.5.1` (`9ac4c0d`). Nothing is committed,
tagged or pushed.

**Current position: stopped at Security Checkpoint SC1.** Task 0 and the *implementation* of
Task 1A and Task 1B are done. The Windows proof-of-concept has **not been executed on Windows** and
the RHEL 9 survey has **not been run on a RHEL host**; both are waiting for evidence that only those
environments can produce. No production behaviour changed: the `win32` fail-closed restriction in
`src/paths.ts` is untouched and a regression test now pins it.

Evidence labels: **[observed]** run in this repository, **[documented]** vendor documentation,
**[reported]** by the project owner, **[inferred]**, **[unverified]**. Verification levels C1–C4 are
defined in the plan, section 1.

## 1. What was actually run, and where

All rows below were run on macOS (Darwin 27.0.0, arm64), by hand, on 2026-10-11. **No GitHub
Actions run exists for this branch.**

| Check | Node 26.11.1 | Node 24.13.0 | Level |
| --- | --- | --- | --- |
| `tsc --noEmit` (src, tests, scripts) | pass | pass | C1 |
| Baseline suite `tests/unit` | 184 / 184 | 184 / 184 | C1 (macOS: C3 for POSIX permission tests) |
| Milestone 6 PoC tests `tests/poc` | 35 / 35 | 35 / 35 | C1 |
| `tests/fixtures/kiro/validate.py` | pass | — | fixture contract only |
| `git diff --check` | clean | — | — |
| `vsce ls` package contents | `README.md`, `package.json`, `dist/extension.cjs` — unchanged allowlist | — | — |
| `.github/workflows/ci.yml` | parses as YAML; every `uses:` pinned by SHA | — | **not executed** |

Node 24.13.0 was the official darwin-arm64 tarball from nodejs.org, checked against the published
`SHASUMS256.txt` (the checksum file itself was not signature-verified). It was unpacked into the
session scratchpad and nothing was installed.

**What this does and does not show.** It shows the 0.5.1 behaviour is intact on macOS under the
declared Node floor and that the new pure logic behaves as specified. It shows nothing about
Windows, RHEL, SELinux, NTFS ACLs or Kiro at runtime.

## 2. Task 0 — branch, `.gitattributes`, CI skeleton

| Deliverable | State |
| --- | --- |
| `feature/cross-platform` from `v0.5.1` | done |
| `.gitattributes` (`* text=auto eol=lf`, binary types) | done; all 87 tracked text files already have LF in the index, so normalisation is a no-op **[observed]** (`git ls-files --eol`) |
| `package.json` | scripts `test:poc` and `poc:win-acl` added; version, dependencies, manifest contributions unchanged |
| `tsconfig.json` | `include` extended to `tests/poc` and `scripts` so the new code is type-checked |
| `.github/workflows/ci.yml` | jobs `verify` (macOS, Ubuntu 24.04/22.04 × Node 24.13.0/24.x), `windows` (2022/2025), `windows-acl-poc` (2022/2025), `ubi9` (digest-pinned container, non-root, `--network none`) |
| Workflow hygiene | `permissions: contents: read`, no secrets, `persist-credentials: false`, actions pinned to the SHAs of `actions/checkout` v4.2.2 and `actions/setup-node` v4.4.0 (resolved through the public GitHub API), pnpm pinned to the version used locally (12.10.1) |

Open points for the first real run:

- **Exit criterion "macOS/Linux green; Windows failures enumerated" is not yet met** because no run
  exists. The Windows baseline step is `continue-on-error` and writes the failing test names to the
  job summary, so the enumeration will appear on the first run.
- **Predicted Windows baseline failures [inferred]:** every test that constructs a `Store`
  (directly, through the CLI, or through the extension controller) fails closed, because
  `prepareStorage` still refuses `win32`. By file that is `cli.test`, `collector.test`,
  `safety.test`, plus any controller path in `extension.test`/`evidence.test`. The projection,
  history, forecast, view, chart and cost tests do not touch storage and are expected to pass.
  Treat this as a prediction to compare with the real list, not as a result.
- The ubi9 job runs Node from the host mounted read-only into the container, so it exercises RHEL 9
  userland (glibc 2.34) with the Node floor. It has no SELinux and no systemd and is labelled so in
  its summary.
- The `windows` and `windows-acl-poc` jobs have never run; typos in the PowerShell strings will only
  show there.

## 3. Task 1A — Windows ACL proof-of-concept

### What exists

| File | Role |
| --- | --- |
| `scripts/poc/win-acl/sddl.ts` | Throwaway **pure** SDDL parser and decision functions: directory, file and ancestor rules; rights-mask table; trustee categories. Unknown token ⇒ fixed rejection code. Not the production `src/sddl.ts` (Task 4) and not importable from `src/` (test asserts it) |
| `scripts/poc/win-acl/tools.ts` | System-tool shim (D1): absolute `System32` paths, no shell, timeout and output cap, paths passed through one environment variable and never through script text, `-EncodedCommand`, fixed error codes |
| `scripts/poc/win-acl/poc.ts` | Evidence runner for plan items 1–7 plus failure modes; synthetic directories only; report restricted to fixed tokens and scanned for private values before printing |
| `tests/poc/*.test.ts` | 35 tests: SDDL tables (accept/reject per rule, malformed input, generic-right mapping, inherit-only and deny handling), shim behaviour with a fake runner and with real child processes, leak guard, fail-closed regression |

### Status per plan item

"Mechanism" is what the program does. "Proven" is what has actually been observed. **Until the
Windows jobs or a native run have produced a report, every Windows-specific cell is not proven.**

| # | Plan item | Mechanism in the PoC | Proven so far |
| --- | --- | --- | --- |
| 1 | Current-user SID, locale-independent | `whoami /user /fo csv /nh`, SID column only; owner of a probe file cross-checked; UI culture recorded | Parser verified on invented localized output **[observed]**; behaviour on Windows **not run**. Locale independence is argued structurally and observed for one culture at most |
| 2 | Descriptor reads without elevation, incl. under lockdown | One batched `Get-Acl`/`Get-Item` call; Constrained Language Mode emulated by downgrading the session and reading the mode back; `.NET` method call probed | Shim and parser verified with a fake runner **[observed]**; real PowerShell **not run**. "Without elevation" cannot be shown on a CI runner (administrator, high integrity); the report marks it `partial`/`RUNNER_ELEVATED` |
| 3 | Child created in a T-only parent shows only inherited T entries | 20 directory+key pairs created via `mkdir`/exclusive create in a locked-down parent, then read; loose-parent control | **Not run** |
| 4 | Protect step never broader than T | `icacls /inheritance:d`; state before/after; later parent change blocked; descriptor sampled from a second process while the step runs | **Not run.** By construction the sampler can show *states*, not instants; atomicity rests on documentation |
| 5 | Default-profile ancestors pass; loosened ones rejected | Ancestor rule applied to the `%LOCALAPPDATA%` chain; 12 synthetic controls (delete, delete-child, write-DAC, write-owner, full, modify rejected; read, write accepted; extra trustee, deny ACE, re-enabled inheritance rejected) | Rules verified on invented SDDL **[observed]**; real NTFS **not run** |
| 6 | Junction, 8.3, `nlink`, `bigint` identity | `fs.symlinkSync(…, 'junction')`, reparse attribute via PowerShell, `linkSync`, `statSync({bigint})`, short-name expansion via `Scripting.FileSystemObject`, non-ASCII directory name | **Not run** |
| 7 | Launch cost, p95 < 1 s | 10 timed runs each of `whoami`, batched read (normal and constrained), `icacls` | **Not run** |
| — | Failure modes | tool missing, timeout, output cap, garbage, index mismatch, `|`/UNC/relative path | Runner and parsers verified with real child processes on macOS **[observed]**; Windows tools **not run** |

### Findings so far (design-level, for review at SC1)

These come from writing the evaluator against the documented ACL model. They are **[inferred]**
until Windows evidence exists.

1. **The plan's parent rule is stricter than a default profile may satisfy.** Step 2 of the creation
   protocol requires the immediate parent to pass "the full T-only rule", and the table lists
   *protected* DACL. `%LOCALAPPDATA%` normally *inherits* its DACL from the profile directory, so
   it is not protected. The PoC evaluates both variants and reports them separately
   (`profile_leaf_as_parent_t_only` vs `profile_leaf_as_dir_protected`). **Proposed wording for
   SC1:** the parent must be T-only (explicit or inherited) and its children must inherit only T;
   protection is required of the storage directory itself, while upstream tampering is covered by the
   ancestor rule. This does not weaken the model, but it is a change to an approved text and needs
   an explicit decision.
2. **Node cannot see every reparse point.** libuv reports only symlinks and junctions as links; a
   OneDrive placeholder, dedup or app-execution link is an ordinary directory to `lstat`. The
   Windows guard therefore has to read the file attributes (the PoC reads `ReparsePoint` through
   PowerShell) rather than rely on the existing `isSymbolicLink()` checks.
3. **Short (8.3) names break string containment.** `inside()` compares resolved strings, so a short
   path and its long form look unrelated. `os.tmpdir()` is itself commonly in short form on
   runners. Task 6 should compare canonical (`realpath.native`) paths or file identity; the PoC
   records whether each assumption holds on the runner.
4. **File IDs do not fit a `Number`.** NTFS file references carry a 16-bit sequence number in the
   high bits; once it exceeds 31 the value is above 2⁵³. `bigint` identity (Task 6) is required, and
   the existing fingerprint format must stay byte-identical on macOS.
5. **`/inheritance:d`, not `/inheritance:r`, is the protect step.** `:r` removes inherited entries
   and can leave an empty DACL; `:d` copies them first. This is the only difference that matters
   to "never broader than T".
6. **Constrained Language Mode blocks the alternative creation path.** Creation-time security
   descriptors need .NET method calls, which that mode blocks **[documented]**; the PoC reports
   whether the probe call was blocked. Unless it is allowed everywhere that matters, the verified
   private parent remains the only creation mechanism, as the plan already assumes.
7. **`__PSLockdownPolicy` is a machine-level test switch, not something a process can set for
   itself [inferred].** The PoC therefore downgrades its own session and reads the mode back, which
   is a stronger statement than "the variable was set".
8. **Elevated token and ownership.** An elevated administrator creates objects owned by the
   Administrators group, not the user. The rules already allow `BA` as owner; the PoC records which
   one occurred so the standard-user run can be compared.
9. **CREATOR OWNER / OWNER RIGHTS.** Treated as trusted only when the object's owner is in T, and
   inherit-only entries are ignored for the object itself. Both are decisions the production
   `sddl.ts` must keep explicit.
10. **Ancestor-rule scope.** Rights that only add entries (write-data, append) are *not* rejected on
    ancestors, exactly as the plan states; they cannot replace or re-secure our path. The negative
    controls document this so a reviewer can disagree knowingly.

### Windows feasibility (assessment, not a result)

- **Design: plausible.** The model needs only system tools that exist on every supported Windows,
  works without a native addon, and has a pure, testable decision core.
- **Evidence: none yet.** Items 2–7 are unproven on Windows. The honest status is *feasible in
  design, unproven in practice*.
- **Fail-closed behaviour is unchanged.** If any of items 1–5 cannot be established on Windows 11
  hardware or a faithful runner, the plan's rule applies: the `win32` throw stays and 0.6.0 does not
  claim Windows 11.

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
| Windows PowerShell strings or `icacls` argument forms are wrong in some detail | PoC never run on Windows; first CI run will show |
| Runner is elevated Windows Server, not a standard-user Windows 11 | Items 2 and 5 can only be `partial` on CI; native run needed |
| Path-based checks cannot close all races (Node has no handle-relative descriptor API); filter drivers not modelled | Accepted limitation per plan; to be stated in release text |
| Managed profiles with extra ACEs fail closed | Expected; PoC reports offender categories without identifiers |
| Environment inherited by the PowerShell child (`PSModulePath`, profile) could redirect `Get-Acl` | Same-user attack, out of scope per threat model; `-NoProfile` used, fully qualified module call is an open hardening option for Task 5 |
| RHEL home may be network storage; no acceptable local location may exist | Decided only after R0; plan allows the gate to fail honestly |
| `ldd` runs the loader on vendor binaries | Documented; `EKG_SURVEY_NO_LDD=1` skips it |
| No evidence for SELinux behaviour, `noexec`, fapolicyd | Native RHEL 9 only (L4–L8) |
| Action SHAs resolved today; no re-verification mechanism yet | Review at SC3 |

## 6. Security Checkpoint SC1 — record

Decision record is **open**. Inputs required before it can be signed:

- [ ] Windows PoC report from at least one Windows runner (`windows-acl-poc` job) reviewed against items 1–7.
- [ ] Windows PoC report from a native Windows 11 **standard-user** account (managed or lab VM), or an explicit decision to treat Windows 11 as not claimed.
- [ ] Decision on finding 1 (parent-rule wording).
- [ ] RHEL 9 R0 survey record and R1 result reviewed (project owner, authorised host).
- [ ] Storage policy finalised from R0, including the configured-local-location design if the home is networked.
- [ ] Windows enablement confirmed, or the fail-closed throw explicitly retained for 0.6.0.

Until all boxes are checked, Tasks 4, 5 and 7 do not start. Tasks 2, 3 and 6 are independent of SC1
and may proceed, but were deliberately **not** started in this step.
