# Release process (Open VSX beta)

Maintainer-only. `.github/workflows/release.yml` is manually triggered and never runs on merge. A live run pauses at the protected `release` environment so the maintainer can review the verified candidate and explicitly approve publication.

## 1. What a release candidate is

One VSIX, built once by the `candidate` job in `.github/workflows/ci.yml`, identified by its SHA-256. The release workflow downloads the exact artifact ID from the newest successful trusted CI run for the current protected `main` commit. It never rebuilds or repackages the extension. **Never rebuild between acceptance and publishing.** If anything changes (including the `publisher` value), build a new candidate and repeat the acceptance steps that the change affects.

`release:verify` checks content, not container bytes: exactly eight allowlisted entries, manifest identity (name, license, icon, main, no runtime dependencies), machine-scoped source/storage settings, VSIX version equal to the manifest version, pre-release flag, MIT text, bundle entry points and the absence of local paths, source maps and credential-shaped strings. It prints a SHA-256 per file. Reproducibility means equal payload hashes from an independent rebuild (`--compare other-manifest.json`); ZIP timestamps differ and are never compared. CI runs this comparison on every candidate.

## 2. Gates before publishing (all mandatory)

1. The selected candidate's CI run is green (verify on macOS and Ubuntu, candidate built once, independent payload comparison, and macOS download check). A newer failed, cancelled, or incomplete CI run for that same `main` commit blocks promotion; the workflow never falls back to an older run.
2. The publisher is **`StefanSuess`** (fixed extension identity; the namespace exists, with public verification status `false` as observed on 2026-10-12 at [the registry API](https://open-vsx.org/api/StefanSuess)). Namespace existence does not prove publishing permission; the maintainer must confirm access. The intended extension ID is `StefanSuess.cyclegauge`; the legacy build `easykirogauge.easykirogauge` is a different extension, detected by a constant that must not change. `release:verify` fails on any other ID.
3. Native macOS acceptance of the exact candidate passed ([macos-acceptance.md](macos-acceptance.md), sections **A, B, C, E and F**). **Section F (Cost Advisor acceptance) is explicitly mandatory before publishing**, including conditional figures, answers, account isolation and native visibility checks on the exact final VSIX. The preflight summary identifies the CI run, artifact ID, commit and VSIX SHA-256; the artifact link is on that CI run.
4. The maintainer reviewed the exact generated release notes, version, commit, artifact identity, and VSIX hash in the candidate summary, then explicitly approved the protected deployment.
5. Security checkpoints stay as they are: SC1 open (Windows storage disabled), SC5 not implemented. A beta does not close or bypass them.

## 3. One-time setup and publishing

### One-time repository setup

1. Protect `main` with a ruleset that requires pull requests and the CI checks `verify (macos-latest)`, `verify (ubuntu-24.04)`, `release candidate (built once)` and `release candidate on macOS`; block force pushes and deletion; and require zero approving reviews. Optionally require branches to be up to date. This lets a solo maintainer merge a checked PR without a second reviewer.
2. Create the GitHub `release` environment. Add the sole maintainer as its required reviewer, disable **Prevent self-review**, and restrict deployments to `main`. This allows the workflow initiator to review the candidate summary and approve their own deployment. Store `OPENVSX_PAT` in this environment only if the fallback is needed; never create a repository-level copy.
3. Keep repository Actions permissions read-only. Preflight gets only `actions: read` and `contents: read`. The workflow starts exactly one protected publishing job: the Trusted Publishing job gets `contents: write` and `id-token: write`; the PAT fallback gets `contents: write` and no OIDC permission. The PAT secret is available only in its publish step. Preflight installs pnpm from a committed npm lockfile with package integrity and lifecycle scripts disabled, then installs the locked CLI and copies the promotion scripts into the promotion artifact. Its SHA-256 is checked after approval; publishing jobs do not install dependencies or fetch source.
4. The namespace `StefanSuess` already exists and its public verification status was `false` on 2026-10-12. Complete the Open VSX publisher agreement and confirm the maintainer's account has publishing rights; public metadata does not establish account membership or token permissions. Request namespace verification through the Open VSX claim process. After verification, register the exact GitHub repository, `.github/workflows/release.yml` workflow path, and `release` environment as the Trusted Publisher. Until that is done, OIDC is not ready; choose the protected PAT mode only if access and the environment secret are configured.
5. If using the fallback, create an Open VSX access token and store it only as `OPENVSX_PAT` in the protected `release` environment.

### Each release

1. Open **Actions → release → Run workflow** and select `main`. Supply the exact version present in `package.json`. The other inputs are `dry_run` (defaults to `true`) and auth mode (defaults to `trusted-publishing`).
2. Preflight derives the current `main` commit, newest matching `ci.yml` run, exact `release-candidate` artifact ID, and SHA-256 values. It rejects PR artifacts, failed or incomplete CI, expired or ambiguous artifacts, version mismatches, changed payloads, and conflicting remote state. Review the Actions summary and download the artifact from its linked CI run if needed for native acceptance.
3. A dry run follows the same read-only provenance, checksum, changelog and remote-state checks, including public Open VSX metadata and VSIX reads. It makes no publish request, tag, release or asset write, and does not enter the protected environment. The read-only token may not see draft GitHub releases, so an absent release is reported as having unverified draft visibility; the protected job repeats draft discovery with its `contents:write` token before any release creation. It cannot validate whether OIDC or the PAT will authenticate.
4. For a live run, set `dry_run` to `false`. After preflight posts the verified candidate summary, complete native acceptance sections A, B, C, E and F for that exact VSIX, then approve the `release` deployment. The required reviewer gate is the final human confirmation before credentials and write permissions are available. The sole maintainer can self-approve because self-review prevention is disabled.
5. After approval, the publishing job rechecks that `main` still points to the reviewed commit. If it advanced while approval was pending, the job stops before any remote write and requires a fresh candidate review. Otherwise, the selected protected job lists GitHub releases with draft visibility, matches the exact tag, and rejects duplicate or unverifiable records. It publishes the byte-identical candidate to Open VSX, verifies the remote VSIX hash, creates or verifies `v<version>` on the selected commit, creates or resumes a matching GitHub draft pre-release, verifies its VSIX and checksum assets, then publishes the release. It derives release notes from the selected commit's `CHANGELOG.md` section.

The workflow is create-only. Existing Open VSX versions, tags, releases, or assets are skipped only when their bytes and metadata match the approved candidate and commit. Conflicts, unreadable state, incomplete published releases, and mismatched assets fail closed; nothing is overwritten. An exact matching published release is a no-op. A per-version concurrency group serializes attempts.

If the candidate artifact has expired, run the existing CI workflow manually on `main` at the same commit and wait for its candidate and verification jobs to pass. The release workflow will derive that new artifact. It never rebuilds during promotion. If `main` has advanced, dispatch from the new head and review that new candidate.

PR #19 remains separate from the release pipeline. Its cleanup is acceptable under the assumption that no external users or historical migration are required; validate its behavior changes with the full applicable suite and native acceptance before a future release includes them.

The package is universal (no `--target`), so Kiro on any OS may offer it. The listing and README state "macOS beta"; Windows storage fails closed by design and Linux is unverified. Restricting to `darwin-arm64`/`darwin-x64` is possible with two target-specific builds but each would need its own native test; deferred.

## 4. Rollback

A published Open VSX version cannot be edited. If post-publish acceptance section D finds a defect, publish a fixed higher version and mark the listing text accordingly; do not rebuild an existing version number. Keep the previous candidate and its hashes. The workflow treats v0.5.2 as historical and immutable: it will only accept an exact, read-only match and cannot repair that release.

## 5. After publishing

Record version, SHA-256, CI run, Kiro and macOS versions in the release notes. Do not collect telemetry; user feedback arrives through GitHub issues, which must never contain real Kiro data.

## Review status for PR #17

The local independent read-only code review completed, with its two minor findings resolved. The GitHub connector initially requested a Codex environment, but subsequently completed a review of commit `92c398d` and reported one P2 finding: the Enterprise UI incorrectly described unknown purchased add-ons as assumed absent. The disclosure now keeps unknown/unentered add-ons distinct from the explicitly hypothetical `assumed_none` state; a regression test reproduced the issue before the fix. This changes presentation only, not the fail-closed profile or calculations. Review coverage is commit-specific: do not describe the earlier review as approval of a later candidate. Native acceptance remains mandatory before publication.
