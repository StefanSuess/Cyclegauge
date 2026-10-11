# Platform verification runbooks (Milestone 6)

Status: **partial, written for Security Checkpoint SC1.** Only the runbooks needed for the
Windows ACL proof-of-concept (Task 1A) and the RHEL 9 environment survey (Task 1B) exist so far.
The Ubuntu, macOS and full native-acceptance runbooks (Tasks 10–11) are added later.

Evidence labels: **[observed]** in this repository or a recorded run, **[documented]** vendor
documentation, **[reported]** by the project owner, **[inferred]**, **[unverified]**.
A support claim is always the tuple *OS version, architecture, Kiro version, install method, date,
levels reached* (C1 code, C2 CI, C3 OS security, C4 Kiro runtime). Installing Kiro is not C4.

## Rules for every runbook

- Run only on a machine you are authorised to use, as the ordinary non-root user who runs Kiro.
- Nothing here changes a setting, relabels a file, starts a service, runs a Kiro command, calls an
  authenticated service, or reads a Kiro log, database, token or credential store.
- Record only versions, yes/no answers, counts and the fixed tokens the scripts print. No paths,
  user names, host names, SIDs, account identifiers or Kiro data go into an evidence document, a
  chat, an issue or a commit.
- If a step needs elevation or a change to security settings, stop and record it as **blocked**.
  Do not work around it.
- Before sharing any output, read it once. The scripts are built to print only allowlisted tokens,
  but you are the final reviewer.

---

## RHEL 9 — Task 1B: environment survey (R0) and Kiro runtime check (R1)

Purpose: decide, from facts, whether RHEL 9 can reach C3/C4 and what the storage policy must be
(plan section 4, Refinement B). This is a survey: it finds out what the machine offers. It is not a
test of EasyKiroGauge, and nothing in it depends on EasyKiroGauge being installed.

### R0 — automated survey

The survey is one POSIX shell file, [`scripts/poc/rhel9-survey.sh`](../scripts/poc/rhel9-survey.sh).
Read it first (about 330 lines); it contains no network, write or privileged commands, and the test
`tests/poc/rhel9-survey.test.ts` asserts that.

What it reads: `/etc/os-release`, `uname`, `getconf`, `getenforce` or `/sys/fs/selinux`, `id -Z`,
`systemctl is-active fapolicyd`, `/proc/sys/crypto/fips_enabled`, `/proc/self/mountinfo`,
`systemd-tmpfiles --cat-config`, three inotify limits, and — only if you pass
`EKG_KIRO_DIR` — the **program files** of the extracted Kiro tarball (ELF header bytes, version
strings, and `ldd` on vendor binaries). It never lists, opens or counts anything under Kiro's user
data or log directories.

Run it twice if you can: once from a normal login shell and once from Kiro's integrated terminal,
because the extension host inherits the IDE's environment, not your shell's.

```bash
# 1. Record the script's own hash so the evidence says which version ran.
sha256sum scripts/poc/rhel9-survey.sh

# 2. Survey without Kiro program files.
sh scripts/poc/rhel9-survey.sh

# 3. Survey including the extracted tarball (set the variable to the directory you extracted).
EKG_KIRO_DIR="$HOME/path/to/extracted/kiro" sh scripts/poc/rhel9-survey.sh

# 4. Optional: classify one more candidate storage location, e.g. a local scratch directory.
EKG_SURVEY_EXTRA_DIR=/var/tmp sh scripts/poc/rhel9-survey.sh
```

`ldd` runs the dynamic loader in trace mode on the vendor's own binaries. If your policy does not
allow that, set `EKG_SURVEY_NO_LDD=1`; the library check is then reported as `skipped`, and the
symbol-version check (a plain string search) still runs.

Save the output with `> survey-output.txt` only in a private location, then paste the **lines**
into the evidence template below. Do not attach the file to anything that leaves the machine until
you have read it.

#### Reading the output

| Key | Meaning | What it decides |
| --- | --- | --- |
| `os_id`, `os_version_id`, `arch`, `glibc`, `kernel` | Platform tuple | Label for every later claim |
| `selinux`, `selinux_user`, `selinux_domain` | Mode and confinement | `enforcing` is required for L6; a confined user is the stronger test (D6) |
| `fapolicyd` | Application allow-listing | `active` makes L4–L5 (extension install/load) a real risk |
| `fips` | FIPS mode | Informational; affects Node crypto availability |
| `env_xdg_*`, `env_home` | `absolute` / `relative` / `empty` / `unset` | Whether XDG discovery is usable or must be rejected |
| `loc_<name>_class` | `local_posix`, `volatile`, `network_or_cluster`, `fuse`, `autofs`, `container_overlay`, `no_posix_modes`, `other` | **The storage-policy input** (below) |
| `loc_<name>_fstype`, `_mount_opts`, `_mount_opts_unlisted` | Filesystem and allow-listed mount options; `unlisted` is a count of options that were dropped | `noexec` matters only to extension loading, not to storage |
| `loc_<name>_creatable_by_me`, `_nearest_dir_owned_by_me` | Could a private directory be created here, and is the nearest existing parent ours | Candidate for a configured local location |
| `loc_<name>_nfs_vers`, `_nfs_sec` | NFS protocol and security flavour (no addresses, no export names) | Informational for network homes |
| `loc_<name>_selinux_type` | SELinux type of the nearest existing directory | Expected store context for L6 |
| `tmpfiles_age_tmp`, `tmpfiles_age_vartmp`, `tmpfiles_rule_covers_home_config_or_data` | Age-based cleanup | Whether a candidate location is silently emptied |
| `inotify_*` | Watcher limits | Whether the 60 s poll must stay authoritative (it does either way) |
| `kiro_location_class`, `kiro_portable_data_dir` | Where the tarball lives; whether a portable `data/` directory exists | Whether `logUri` discovery or portable mode applies |
| `kiro_elf_files`, `kiro_node_modules`, `kiro_unresolved_libraries`, `kiro_unresolved_names` | Binary and native-module dependency check (library file names are public) | L1 |
| `kiro_max_glibc_required`, `kiro_max_glibcxx_required`, `system_glibcxx_provided`, `kiro_glibc_required_within_system` | Highest symbol versions found vs. provided | L1; a `no` here is a finding, not a script error |

Locations probed: `home`, `config`, `data`, `state`, `runtime`, `tmp`, `vartmp`, `shm`, and `extra`
if requested. **`class` meanings:** `local_posix` honours POSIX modes and is a candidate;
`network_or_cluster`, `fuse`, `autofs` and `container_overlay` are rejected or need review;
`volatile` (tmpfs) does not survive logout or reboot; `no_posix_modes` fails the exact-mode check by
itself.

### R0 — manual items (cannot be automated safely)

| Item | How to record it |
| --- | --- |
| RHEL minor release | `os_version_id` above (e.g. `9.4`) |
| Kiro version | Kiro's **About** dialog; copy version text only |
| Install method and location class | Tarball; the script's `kiro_location_class`. Record whether you extracted it yourself without root |
| Is the home directory network storage? | `loc_home_class` and `loc_home_fstype`. If `autofs` or `network_or_cluster`, also ask the administrator whether a local persistent user-writable path exists |
| Managed-machine restrictions | Yes/no: extension install restricted by policy; SELinux confined login; EDR/allow-listing present. Do not record product names if your organisation treats them as sensitive |

If you cannot run the script at all, the same facts come from these single commands. Each one is
read-only; record the answer, not the surrounding output:

```bash
cat /etc/os-release | grep -E '^(ID|VERSION_ID)='      # record: ID and VERSION_ID only
uname -m; getconf GNU_LIBC_VERSION
getenforce; id -Z                                       # record: mode, SELinux user and type only
systemctl is-active fapolicyd
cat /proc/sys/crypto/fips_enabled
umask
findmnt -T "$HOME" -n -o FSTYPE,OPTIONS                 # record: FSTYPE and the option names, never addresses or export paths
cat /proc/sys/fs/inotify/max_user_watches
```

### R1 — Kiro's own runtime (L2–L3), before EasyKiroGauge is involved

Performed by the project owner on the authorised host. Record pass/fail and counts only.

| Rung | Check | Record |
| --- | --- | --- |
| L0 | Tarball extracted | yes/no (already **[reported]**) |
| L1 | R0: `kiro_unresolved_libraries` is `0` and `kiro_glibc_required_within_system` is `yes` | values |
| L2 | Kiro IDE launches; open **About** | version, Electron, Node, OS strings — as shown by Kiro |
| L3 | Kiro's agent has produced account-usage log files at the root the IDE uses | **count only**, via the command below, or `unknown` if you would rather not check |

L3 touches Kiro's log directory (file names and a count, never contents). It is optional and the
project owner's call:

```bash
# ROOT is the directory containing Kiro's "logs" folder: <config dir>/Kiro for a normal install,
# or <extracted tarball>/data/... for a portable one [unverified layout]. Print the number only.
find "$ROOT/logs" -type f -name 'q-client.log' 2>/dev/null | wc -l
```

If L3 is `0` after real agent use, that is a **blocking finding** for the data source on this
platform and is reported as such; nothing is worked around.

### Evidence template

Copy this block into a private note and fill it in. The values below show the *shape*; they are not
measurements.

```text
EasyKiroGauge Milestone 6 — RHEL 9 survey record
Surveyor role: project owner            Date (UTC): YYYY-MM-DD
Script sha256: <64 hex>                 Run from: login shell | Kiro terminal
Host class: managed | unmanaged | VM    Architecture: x86_64 | aarch64

[R0 automated output — paste the key=value lines unchanged]
survey_schema=...
...
survey_complete=yes

[R0 manual]
RHEL minor: 9.x                         Kiro version (About): x.y.z
Install: tarball, extracted by me without root: yes | no
Extension install restricted by policy: yes | no | unknown
EDR / allow-listing present: yes | no | unknown
Local persistent user-writable location besides home available: yes | no | unknown

[R1]
L1 libraries resolve: yes | no | skipped   L2 IDE launches: yes | no
L3 account-usage logs present: count N | not checked

Private-data review: I read this record; it contains no paths, user or host names,
identifiers or Kiro data.  yes
```

### How the result feeds SC1

| Finding | Consequence for the storage policy |
| --- | --- |
| `loc_home_class=local_posix`, `selinux=enforcing` | Default policy stands; proceed to Tasks 2–3 and the R3 probe build |
| `loc_home_class=network_or_cluster` / `autofs` / `fuse`, and a `local_posix` location with `creatable_by_me=yes` that is not `volatile` and has `tmpfiles_age_*=none` | Design the configured-local-location rules (ancestor ownership, squat-safe create) and decide at SC1 |
| Networked home and **no** acceptable local location | RHEL 9 cannot reach L6; the gate fails honestly and the release decision returns to the project owner |
| `kiro_unresolved_libraries` > 0 or `kiro_glibc_required_within_system=no` | L1 failure: a Kiro-on-this-host problem, outside this project; report, do not engineer around |
| `fapolicyd=active` | Plan L4–L5 explicitly with the administrator; record whether user-installed extension code is permitted |

---

## Windows 11 — Task 1A: ACL proof-of-concept on a native machine

The CI jobs `windows-acl-poc` run the same program on Windows Server runners. Those runs are
**C3 on Windows Server**, not Windows 11, and the runner account is an elevated administrator.
A native Windows 11 run with a **standard (non-administrator) account** is what answers "do typical
client profile directories meet the rules" and "does it work without elevation".

Requirements: Node.js 24.13 or newer on the machine (a portable copy is fine), a standard account,
no administrator rights needed. The program creates a temporary directory named
`synthetic-ekg-acl-*` under your temp folder, removes it afterwards, and otherwise only **reads the
security descriptors** (never contents) of the directories on the path to `%LOCALAPPDATA%`.

```bash
node scripts/poc/win-acl/poc.ts
node scripts/poc/win-acl/poc.ts --skip-profile     # also skip reading the profile directory chain
```

The report is JSON with fixed tokens, counts and booleans. It contains no SID, user name or path;
the program checks that itself before printing and exits with a fixed error if it cannot guarantee
it. Items 1–7 map to plan section 3; `8_failure_modes` records tool-missing, timeout and garbage
handling. For each item the status is `established`, `partial` or `not_established` with a fixed
code, and `partial`/`RUNNER_ELEVATED` means the check ran but not as a standard user.

Constrained Language Mode: the program emulates it by downgrading its own PowerShell session
(`2_descriptor_reads` reads back the mode actually in force and reports whether .NET method calls
were blocked). On a machine where WDAC/AppLocker enforces Constrained Language Mode for real, the
same run shows whether `Get-Acl` still works there; record that as *tested* or *untested* in the
evidence note.

Enterprise-managed ACLs: if `5_safe_path_rules` reports `profile_failing_levels`, the
`profile_failing_offender_categories` show **which kind** of trustee (`builtin_users`,
`account_or_group`, `service_sid`, …) broke the rule, never which one. That is enough to decide
whether the managed profile can pass or must fail closed with a fixed code.

Windows evidence template:

```text
EasyKiroGauge Milestone 6 — Windows ACL PoC record
Date (UTC): YYYY-MM-DD     Windows build (os_release): 10.0.xxxxx     Architecture: x64 | arm64
Account: standard | administrator (elevated | not elevated)     Machine: managed | unmanaged | VM
Node version: v24.x.y      Constrained Language Mode enforced by policy: yes | no | unknown

[paste the JSON report unchanged]

Private-data review: contains no SID, user name or path.  yes
Tested with: managed profile | space/non-ASCII profile name | OneDrive-redirected profile  (mark each)
```


---

## Release candidate verification (Task 9) — what each step proves

| Step | Command | Proves | Does not prove |
| --- | --- | --- | --- |
| Build once | `pnpm release:build release/candidate.vsix` | the working tree packages | that anything runs |
| Content | `pnpm release:verify release/candidate.vsix [--out manifest.json]` | exactly the allowlisted entries; sane manifest and bundle; per-file SHA-256 | behaviour |
| Reproducibility | `pnpm release:verify other.vsix --compare manifest.json` | payload file hashes equal (ZIP bytes ignored) | a clean toolchain |
| Workflow policy (SC3) | `node scripts/release/workflow-policy.ts` | read-only token, no secrets, actions pinned by SHA, images by digest, frozen installs | that a pinned SHA is the tagged release |
| Windows baseline | `node scripts/release/expected-failures.ts baseline.tap tests/windows-expected-failures.txt` | only the listed storage-dependent tests fail while win32 storage is refused | anything about Windows storage itself |
| Smoke | `pnpm release:smoke release/candidate.vsix [--simulate no-sqlite\|no-reviver\|no-watcher]` | the shipped bundle activates, shows the budget, degrades safely and prints a path-free diagnostics report against a stub host | native Kiro behaviour, real log shapes, `context.logUri`, `vscode.env.appName` |

Native acceptance runs must install **the same file** and record its SHA-256. Download the
`release-candidate` artifact of the CI run for the release commit (kept 90 days), then compare its
hash with the `SHA-256:` line in that run's *Release candidate (built once)* summary before installing:

```bash
sha256sum candidate.vsix                                   # Linux (RHEL 9)
shasum -a 256 candidate.vsix                               # macOS
```

```powershell
(Get-FileHash -Algorithm SHA256 .\candidate.vsix).Hash.ToLower()   # Windows 11
```

A mismatch stops the run; do not rebuild locally as a substitute. For phase A of the
RHEL/Windows/macOS acceptance runs, `node scripts/release/synthetic-root.ts <empty-directory>` creates
an invented log tree whose observations end "now" with a billing reset 20 days later.

## Windows non-elevated attempt (Workstream B)

CI job `windows-acl-poc-nonelevated` prints `NONELEVATED_RESULT=obtained|already|not_obtained` and
`MEASURED_INTEGRITY=<level>`. Only `obtained` and `already` are non-elevated evidence, and only for a
Windows Server runner. On a native Windows 11 machine, run the same tool from a standard account:

```bash
node scripts/poc/win-acl/nonelevated.ts
```

If the account is already a standard user the PoC runs directly; the report's `integrity_level`
decides, never the intention.
