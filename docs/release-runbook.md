# Release runbook (Open VSX)

Maintainer and agent runbook for `.github/workflows/release.yml`. It complements [release-process.md](release-process.md), which describes the gates. Nothing here publishes anything; the release workflow only runs when you dispatch it.

## Release checklist

Follow this every time. `X.Y.Z` is the version being released. **[agent]** steps may be done by an AI agent; **[maintainer]** steps are the maintainer's alone. The agent never triggers the live release run, never approves the `release` environment and never changes secrets or repository settings.

**A. Decide the version**
1. [maintainer] Pick `X.Y.Z` using [Versioning](release-process.md#versioning): the minor number decides the channel (odd = pre-release, even = stable; the pipeline derives it from the version), a stable release still needs native acceptance on every platform it names, and the version must be higher than every published one. Versions do not track milestone numbers.

**B. Merge feature PRs to `main`**
1. [maintainer] Merge in dependency order; every branch must be up to date with `main` and all required checks green.
2. [maintainer] Squash merges only. After a base PR merges, update any stacked PR onto `main` and let its checks rerun before merging it.

**C. Release-preparation PR**
1. [agent] Set `version` to `X.Y.Z` in `package.json` (nothing else in that file).
2. [agent] Add a nonempty `CHANGELOG.md` section `## X.Y.Z (...)`, with an upgrade note whenever defaults, storage or settings change. Never edit a released section.
3. [agent] Update the README badges and platform table, `docs/usage.md`, `docs/version-history.md`, and `ROADMAP.md` if the scope changes.
4. [agent] Keep the security checkpoint wording (SC1, SC5) consistent with [release-process.md](release-process.md); file follow-up work as GitHub issues rather than leaving it implicit.
5. [agent] Check that `verifiedOn` in `src/cost/catalog.ts` is within 30 days of the planned release; otherwise review the pricing catalog against Kiro's published prices first (the Cost Advisor shows `catalog_review_due` after 30 days).
6. [agent] Run `pnpm typecheck`, `pnpm test`, `pnpm test:release` (includes an automated version-consistency check of `package.json`, `CHANGELOG.md`, `docs/version-history.md` and the README badge), `python3 tests/fixtures/kiro/validate.py` and `git diff --check`.

**D. Independent review**
1. [agent] An independent, read-only review of the release PR is mandatory (high-risk change): version, changelog accuracy, evidence claims per platform, no overclaiming. Fix findings before merging.

**E. Merge the release PR**
1. [agent, with explicit maintainer approval to merge] Squash-merge the release PR.
2. [agent] Wait for green CI on that exact `main` commit (all required checks, including the candidate and attestation jobs). A green run for an earlier commit is insufficient. Do not merge anything else until the release is done.

**F. Native acceptance of the exact CI candidate**
1. [maintainer] Download the `release-candidate` artifact of that CI run and compare the SHA-256 of `bobert-v<version>-<sha12>-candidate.vsix` (`<sha12>` = first 12 characters of the CI run's commit) with the CI summary.
2. [maintainer] Run macOS acceptance sections A, B, D and E ([macos-acceptance.md](macos-acceptance.md)); they are mandatory.
3. [maintainer] When the release names Windows or Ubuntu, smoke-test the same VSIX in native Kiro on each; this is required before a release that names Windows or Ubuntu (until itemised checklists exist, issue #61). Record Kiro and OS versions.

**G. Dry run, then live run**
1. [maintainer] Run the release workflow with `dry_run = true` (see Dry run below) and record commit, artifact ID and SHA-256.
2. [maintainer] Dispatch `dry_run = false`, re-read the preflight summary and release notes, then approve the `release` deployment.

**H. After publishing**
1. [maintainer/agent] Verify the Open VSX listing and version, tag `vX.Y.Z`, and the GitHub release (pre-release for an odd minor, stable for an even minor) with its two assets (`bobert-vX.Y.Z.vsix`, `SHA256SUMS.txt`).
2. [maintainer] Install from Open VSX in Kiro and run acceptance section C.
3. [agent] After the release, record the evidence (version, SHA-256, CI run, Kiro and OS versions) in [platform-verification.md](platform-verification.md) via a pull request.
4. [maintainer] Do not edit published notes or assets. A correction is a higher patch version.

**Automated:** CI build and verification of the candidate, candidate selection and re-verification, release-notes derivation, remote-state checks, publishing after approval, tagging and the GitHub release, and the version-consistency test. **Deliberately manual:** native acceptance, merge approval, the live dispatch, environment approval and publishing.

## Reference

- The `release` environment, Open VSX secret and Trusted Publisher registration cannot be verified from repository code.
- A fresh dry run is required before any live release.

## What the workflow does

CI builds the candidate once, verifies it (content allowlist, rebuild payload comparison, host checks), and attests its exact VSIX bytes only on trusted `main`. The artifact's VSIX is named `bobert-v<version>-<sha12>-candidate.vsix`; the release workflow selects the newest successful CI candidate for the current `main` head by artifact ID, re-verifies the VSIX and its attestation (the preflight renames it to `bobert-v<version>.vsix` without changing its bytes; the published assets are unchanged), derives release notes from `CHANGELOG.md`, checks Open VSX, tag and GitHub release state read-only, and (live only) publishes after environment approval, then tags, drafts, uploads and publishes the GitHub release. The pre-release flag (VSIX, Open VSX, GitHub) follows the version's channel and a mismatch fails closed. It is create-only and fails closed on any mismatch; a rerun resumes a partial state.

## What you must do manually

### 1. Verify `main` protection (once and after changes)
Settings → Rules → Rulesets: the `main` ruleset should require a pull request (0 approvals), squash merges, **up-to-date branches**, all seven checks `verify (macos-latest)`, `verify (ubuntu-24.04)`, `verify (windows-2025)`, `release candidate (built once)`, `release candidate on macOS`, `release candidate on Windows` and `release candidate on Ubuntu`, and block force pushes and deletion. The maintainer confirms this in Settings → Rules and adds any missing check (maintainer only), and re-confirms after future edits.

### 2. Create the `release` GitHub Environment (once, before any live run)
Settings → Environments → New environment → name exactly `release`.
- Required reviewers: yourself. Disable "Prevent self-review".
- Deployment branches: selected branches → `main` only.
- **Do this before the first live dispatch.** A job that names a missing environment makes GitHub create it with no protection, and a trusted-publishing run would then publish without any approval.
- Confirm it shows the reviewer rule and the `main` restriction.

### 3. Open VSX account and namespace
Already done for the earlier manual publish (maintainer-reported); only confirm the publisher agreement is still accepted.
1. Log in at open-vsx.org with the GitHub account that should publish, and accept the publisher agreement.
2. Confirm that account owns/can publish to namespace `StefanSuess`.
3. Optionally request namespace verification through Open VSX's claim process. Do not describe the namespace as verified until the registry shows it.

### 4a. PAT mode (recommended until Trusted Publishing is registered)
The PAT worked for the earlier manual publish. You may reuse that token or create a fresh one, but it must be stored as an environment secret for the workflow to see it.
1. Open VSX → Settings → Access Tokens → generate a token for the publishing account.
2. GitHub → Settings → Environments → `release` → Environment secrets → add `OPENVSX_PAT`. Do not add a repository-level secret.
3. Dispatch with `auth_mode = pat`. Revoke or rotate the token afterwards if you do not need it.

### 4b. Trusted Publishing (OIDC), optional
Only after the namespace is verified and Open VSX offers Trusted Publisher registration for it: register repository `StefanSuess/Bobert`, workflow path `.github/workflows/release.yml`, environment `release`. Registration steps and server support are controlled by Open VSX and were **not verified** here; the pinned `ovsx@1.2.0` CLI does expose `--trusted-publishing`. Until registered, use PAT mode; an unregistered OIDC run fails at publish time (nothing is published).

### 5. Verify readiness before each dry run
1. `package.json` is `X.Y.Z` and the `## X.Y.Z (...)` section in `CHANGELOG.md` is nonempty (the release-preparation PR is merged). Review those notes against the exact final candidate.
2. Check all required CI jobs, including `attest release candidate`, on the **current** `main` commit; a green run for an earlier commit is insufficient. After the attestation gate first merges, use a fresh `main` CI run and dry run. Older unattested candidates fail the new gate.
3. If `main` changes again, use the new candidate artifact and repeat the dry run and relevant native acceptance checks. The README must not direct users to a release before it is published.

## Dry run (safe; no writes, no environment, no secrets)
1. Actions → release → Run workflow, branch `main`, `version = X.Y.Z`, `dry_run = true`, either auth mode.
2. Expect: preflight selects the CI run and artifact, verifies the VSIX and its attestation, and reports "Read-only publication readiness". Read the summary: commit, CI run, artifact ID, VSIX SHA-256 and release notes. `ATTESTATION_VERIFICATION_FAILED` means the exact VSIX has no provenance matching the trusted workflow, `main` and source commit; inspect the CI signer job, then create a fresh candidate through CI.
3. A dry run cannot test PAT or OIDC credentials and cannot see draft releases; the live job repeats the draft check.
4. Do **not** dispatch a dry run for an already published version: it is immutable (v0.5.2 predates the pipeline and cannot be repaired). If the changelog or candidate is not yet ready, finish those prerequisites before testing.
5. Same-version dry and live runs share one concurrency group, so a live run waiting for approval queues dry runs.

## Live release checklist (only with your explicit go)
1. [ ] Environment `release` verified (step 2) and `OPENVSX_PAT` present if using PAT mode.
2. [ ] The release PR for `X.Y.Z` merged; CI on that `main` commit green; no newer `main` commit expected during approval.
3. [ ] Dry run for `X.Y.Z` passed; you recorded commit, artifact ID and SHA-256.
4. [ ] Download that exact artifact from the linked CI run; verify its SHA-256.
5. [ ] Native macOS acceptance of that VSIX: [macos-acceptance.md](macos-acceptance.md) sections A, B, D, E; smoke test on Windows and Ubuntu when the release names them.
6. [ ] Dispatch `dry_run = false` with the chosen auth mode.
7. [ ] In the run, re-read the preflight summary (same commit and SHA-256 as the dry run) and the release notes, then approve the `release` deployment.
8. [ ] After success: check Open VSX listing/version, tag `vX.Y.Z`, the GitHub release (pre-release or stable per channel) and its two assets (`bobert-vX.Y.Z.vsix`, `SHA256SUMS.txt`); install from Open VSX in Kiro and run acceptance section C.
9. [ ] Revoke or rotate the PAT if it is no longer needed.

## Failure handling
- If `main` advanced during approval, the job stops before any write; review the new candidate and redispatch.
- After a partial failure (for example Open VSX published but the tag or release missing), rerun the same version: matching existing state is verified and skipped, the rest is created.
- A conflicting or half-uploaded GitHub release asset or odd draft fails closed; delete that draft or asset by hand, then rerun. Never edit or replace a published VSIX; publish a higher version instead.
- A read-back right after the Open VSX publish may fail while the registry catches up; rerun to verify.

Required promotion checks also include `verify (windows-2025)`, `release candidate on Windows` and `release candidate on Ubuntu`; they are part of the ruleset (see step 1 and [release-process.md](release-process.md)). Existing required check names remain. See [platform verification](platform-verification.md).
