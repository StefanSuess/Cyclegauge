# Release runbook (Open VSX beta)

Maintainer checklist for the first controlled use of `.github/workflows/release.yml`. It complements [release-process.md](release-process.md), which describes the gates. Nothing here publishes anything; the release workflow only runs when you dispatch it.

## Current state (checked 2026-10-13 against GitHub Releases, `main` and Actions)

- v0.5.2 and its GitHub pre-release already exist; they were created before the pipeline. The workflow treats v0.5.2 as immutable and cannot repair or re-promote it (its asset is named `candidate.vsix`, the pipeline expects `cyclegauge-v<version>.vsix`).
- `package.json` is **already `0.5.3`** on `main`. The latest published GitHub release is still **v0.5.2**. The next release must use an unpublished, higher version, a matching non-empty `CHANGELOG.md` section, and fresh CI plus native acceptance. Never rebuild or replace v0.5.2.
- The manually dispatched [release workflow run #38276549100](https://github.com/StefanSuess/Cyclegauge/actions/runs/38276549100) completed successfully on 2026-10-12 at an **earlier** `main` commit, with **preflight only**; both publishing jobs were skipped. This is not proof of a live release or of readiness for the current `main` commit. A fresh dry run is required before any live release. The `release` environment, Open VSX secret and Trusted Publisher registration cannot be verified from repository code.
- The maintainer reports that v0.5.2 was published to Open VSX manually with a PAT, so account access to the `StefanSuess` namespace and PAT publishing are proven in practice (maintainer-reported; not checked by this repo). Public namespace verification was `false` on 2026-10-12.

## What is automated

CI builds the candidate once and verifies it (content allowlist, rebuild payload comparison, macOS check). The release workflow selects the newest successful CI candidate for the current `main` head by artifact ID, re-verifies the VSIX, derives release notes from `CHANGELOG.md`, checks Open VSX, tag and GitHub release state read-only, and (live only) publishes after environment approval, then tags, drafts, uploads and publishes the GitHub pre-release. It is create-only and fails closed on any mismatch; a rerun resumes a partial state.

## What you must do manually

### 1. Verify `main` protection (once and after changes)
Settings → Rules → Rulesets: the active `main` ruleset currently requires a pull request (0 approvals), squash merges, **up-to-date branches**, checks `verify (macos-latest)`, `verify (ubuntu-24.04)`, `release candidate (built once)`, `release candidate on macOS`, and blocks force pushes and deletion. Confirm these remain enforced after future edits.

### 2. Create the `release` GitHub Environment (once, before any live run)
Settings → Environments → New environment → name exactly `release`.
- Required reviewers: yourself. Disable "Prevent self-review".
- Deployment branches: selected branches → `main` only.
- **Do this before the first live dispatch.** A job that names a missing environment makes GitHub create it with no protection, and a trusted-publishing run would then publish without any approval.
- Confirm it shows the reviewer rule and the `main` restriction.

### 3. Open VSX account and namespace
Already done for the manual v0.5.2 release (maintainer-reported); only confirm the publisher agreement is still accepted.
1. Log in at open-vsx.org with the GitHub account that should publish, and accept the publisher agreement.
2. Confirm that account owns/can publish to namespace `StefanSuess`.
3. Optionally request namespace verification through Open VSX's claim process. Do not describe the namespace as verified until the registry shows it.

### 4a. PAT mode (recommended for the first release)
The PAT worked for the manual v0.5.2 publish. You may reuse that token or create a fresh one, but it must be stored as an environment secret for the workflow to see it.
1. Open VSX → Settings → Access Tokens → generate a token for the publishing account.
2. GitHub → Settings → Environments → `release` → Environment secrets → add `OPENVSX_PAT`. Do not add a repository-level secret.
3. Dispatch with `auth_mode = pat`. Revoke or rotate the token afterwards if you do not need it.

### 4b. Trusted Publishing (OIDC), optional
Only after the namespace is verified and Open VSX offers Trusted Publisher registration for it: register repository `StefanSuess/Cyclegauge`, workflow path `.github/workflows/release.yml`, environment `release`. Registration steps and server support are controlled by Open VSX and were **not verified** here; the pinned `ovsx@1.2.0` CLI does expose `--trusted-publishing`. Until registered, use PAT mode; an unregistered OIDC run fails at publish time (nothing is published).

### 5. Verify 0.5.3 readiness before the next dry run
1. `package.json` is already `0.5.3`, and the `## 0.5.3 (beta, macOS)` section in `CHANGELOG.md` is already nonempty; PR #19 containing the storage/identity compatibility change is merged. Review those notes against the exact final candidate rather than creating a redundant version-bump or changelog PR.
2. Check all four required CI jobs on the **current** `main` commit; a green run for an earlier commit is insufficient.
3. If `main` changes again, use the new candidate artifact and repeat the dry run and relevant native acceptance checks. No public `v0.5.3` GitHub release existed at this audit; the README must not direct users to it before publication.

## Dry run (safe; no writes, no environment, no secrets)
1. Actions → release → Run workflow, branch `main`, `version = 0.5.3`, `dry_run = true`, either auth mode.
2. Expect: preflight selects the CI run and artifact, verifies the VSIX, and reports "Read-only publication readiness". Read the summary: commit, CI run, artifact ID, VSIX SHA-256 and release notes.
3. A dry run cannot test PAT or OIDC credentials and cannot see draft releases; the live job repeats the draft check.
4. Do **not** dispatch a dry run for `0.5.2`: it is already published and intentionally immutable. If the `0.5.3` changelog or candidate is not yet ready, finish those prerequisites before testing.
5. Same-version dry and live runs share one concurrency group, so a live run waiting for approval queues dry runs.

## Live release checklist (only with your explicit go)
1. [ ] Environment `release` verified (step 2) and `OPENVSX_PAT` present if using PAT mode.
2. [ ] 0.5.3 merged; CI on that `main` commit green; no newer `main` commit expected during approval.
3. [ ] Dry run for 0.5.3 passed; you recorded commit, artifact ID and SHA-256.
4. [ ] Download that exact artifact from the linked CI run; verify its SHA-256.
5. [ ] Native macOS acceptance of that VSIX: [macos-acceptance.md](macos-acceptance.md) sections A, B, D, E.
6. [ ] Dispatch `dry_run = false` with the chosen auth mode.
7. [ ] In the run, re-read the preflight summary (same commit and SHA-256 as the dry run) and the release notes, then approve the `release` deployment.
8. [ ] After success: check Open VSX listing/version, tag `v0.5.3`, the GitHub pre-release and its two assets (`cyclegauge-v0.5.3.vsix`, `SHA256SUMS.txt`); install from Open VSX in Kiro and run acceptance section C.
9. [ ] Revoke or rotate the PAT if it is no longer needed.

## Failure handling
- If `main` advanced during approval, the job stops before any write; review the new candidate and redispatch.
- After a partial failure (for example Open VSX published but the tag or release missing), rerun the same version: matching existing state is verified and skipped, the rest is created.
- A conflicting or half-uploaded GitHub release asset or odd draft fails closed; delete that draft or asset by hand, then rerun. Never edit or replace a published VSIX; publish a higher version instead.
- A read-back right after the Open VSX publish may fail while the registry catches up; rerun to verify.

Cross-platform development adds required promotion checks `verify (windows-2025)`, `release candidate on Windows`, and `release candidate on Ubuntu`. The maintainer must add these to the repository ruleset before merging this CI change; this task does not modify repository protection settings. Existing required check names remain. See [platform verification](platform-verification.md).
