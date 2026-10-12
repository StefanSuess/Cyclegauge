# Release runbook (Open VSX beta)

Maintainer checklist for the first controlled use of `.github/workflows/release.yml`. It complements [release-process.md](release-process.md), which describes the gates. Nothing here publishes anything; the release workflow only runs when you dispatch it.

## Current state (verified 2026-10-12 against `main` at `3e9d246`)

- v0.5.2 and its GitHub pre-release already exist; they were created before the pipeline. The workflow treats v0.5.2 as immutable and cannot repair or re-promote it (its asset is named `candidate.vsix`, the pipeline expects `cyclegauge-v<version>.vsix`).
- `package.json` is still `0.5.2`. `main` contains changes that are not in the published VSIX (Ko-fi `sponsor` field, README support section and screenshots), so the next release needs a **new, higher version** (proposed 0.5.3). Never rebuild or replace v0.5.2.
- The release workflow has never been run. The `release` environment, the Open VSX token and the Trusted Publisher registration are not visible from code and must be checked by you.
- The Open VSX namespace `StefanSuess` exists; public verification was `false` on 2026-10-12. Publishing rights are not proven by that.

## What is automated

CI builds the candidate once and verifies it (content allowlist, rebuild payload comparison, macOS check). The release workflow selects the newest successful CI candidate for the current `main` head by artifact ID, re-verifies the VSIX, derives release notes from `CHANGELOG.md`, checks Open VSX, tag and GitHub release state read-only, and (live only) publishes after environment approval, then tags, drafts, uploads and publishes the GitHub pre-release. It is create-only and fails closed on any mismatch; a rerun resumes a partial state.

## What you must do manually

### 1. Protect `main` (once)
Settings → Rules → Rulesets: target `main`; require a pull request (0 approvals); require checks `verify (macos-latest)`, `verify (ubuntu-24.04)`, `release candidate (built once)`, `release candidate on macOS`; block force pushes and deletion.

### 2. Create the `release` GitHub Environment (once, before any live run)
Settings → Environments → New environment → name exactly `release`.
- Required reviewers: yourself. Disable "Prevent self-review".
- Deployment branches: selected branches → `main` only.
- **Do this before the first live dispatch.** A job that names a missing environment makes GitHub create it with no protection, and a trusted-publishing run would then publish without any approval.
- Confirm it shows the reviewer rule and the `main` restriction.

### 3. Open VSX account and namespace
1. Log in at open-vsx.org with the GitHub account that should publish, and accept the publisher agreement.
2. Confirm that account owns/can publish to namespace `StefanSuess`.
3. Optionally request namespace verification through Open VSX's claim process. Do not describe the namespace as verified until the registry shows it.

### 4a. PAT mode (recommended for the first release)
1. Open VSX → Settings → Access Tokens → generate a token for the publishing account.
2. GitHub → Settings → Environments → `release` → Environment secrets → add `OPENVSX_PAT`. Do not add a repository-level secret.
3. Dispatch with `auth_mode = pat`. Revoke or rotate the token afterwards if you do not need it.

### 4b. Trusted Publishing (OIDC), optional
Only after the namespace is verified and Open VSX offers Trusted Publisher registration for it: register repository `StefanSuess/Cyclegauge`, workflow path `.github/workflows/release.yml`, environment `release`. Registration steps and server support are controlled by Open VSX and were **not verified** here; the pinned `ovsx@1.2.0` CLI does expose `--trusted-publishing`. Until registered, use PAT mode; an unregistered OIDC run fails at publish time (nothing is published).

### 5. Prepare 0.5.3 (separate PR, your approval; do not mix unrelated PRs such as #19)
1. Bump `package.json` to `0.5.3`.
2. Add a `## 0.5.3 (beta, macOS)` section to `CHANGELOG.md` (non-empty; used verbatim as release notes).
3. Merge after CI is green. Wait for the CI run on the merge commit to finish with all four jobs green.

## Dry run (safe; no writes, no environment, no secrets)
1. Actions → release → Run workflow, branch `main`, `version = 0.5.3`, `dry_run = true`, either auth mode.
2. Expect: preflight selects the CI run and artifact, verifies the VSIX, and reports "Read-only publication readiness". Read the summary: commit, CI run, artifact ID, VSIX SHA-256 and release notes.
3. A dry run cannot test PAT or OIDC credentials and cannot see draft releases; the live job repeats the draft check.
4. Before 0.5.3 is merged, a dry run for `0.5.2` is expected to fail on state or version checks; that is not a pipeline fault.
5. Same-version dry and live runs share one concurrency group, so a live run waiting for approval queues dry runs.

## Live release checklist (only with your explicit go)
1. [ ] Environment `release` verified (step 2) and `OPENVSX_PAT` present if using PAT mode.
2. [ ] 0.5.3 merged; CI on that `main` commit green; no newer `main` commit expected during approval.
3. [ ] Dry run for 0.5.3 passed; you recorded commit, artifact ID and SHA-256.
4. [ ] Download that exact artifact from the linked CI run; verify its SHA-256.
5. [ ] Native macOS acceptance of that VSIX: [macos-acceptance.md](macos-acceptance.md) sections A, B, C, E, F.
6. [ ] Dispatch `dry_run = false` with the chosen auth mode.
7. [ ] In the run, re-read the preflight summary (same commit and SHA-256 as the dry run) and the release notes, then approve the `release` deployment.
8. [ ] After success: check Open VSX listing/version, tag `v0.5.3`, the GitHub pre-release and its two assets (`cyclegauge-v0.5.3.vsix`, `SHA256SUMS.txt`); install from Open VSX in Kiro and run acceptance section D.
9. [ ] Revoke or rotate the PAT if it is no longer needed.

## Failure handling
- If `main` advanced during approval, the job stops before any write; review the new candidate and redispatch.
- After a partial failure (for example Open VSX published but the tag or release missing), rerun the same version: matching existing state is verified and skipped, the rest is created.
- A conflicting or half-uploaded GitHub release asset or odd draft fails closed; delete that draft or asset by hand, then rerun. Never edit or replace a published VSIX; publish a higher version instead.
- A read-back right after the Open VSX publish may fail while the registry catches up; rerun to verify.
