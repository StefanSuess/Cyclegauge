# Release process (Open VSX beta)

Maintainer-only. For the step-by-step setup, dry run and live checklist see [release-runbook.md](release-runbook.md). `.github/workflows/release.yml` is manually triggered and never runs on merge. A live run pauses at the protected `release` environment so the maintainer can review the verified candidate and explicitly approve publication.

## 1. What a release candidate is

One VSIX, built once by the `candidate` job in `.github/workflows/ci.yml`, identified by its SHA-256 and shipped in the `release-candidate` artifact as `cyclegauge-v<version>-<sha12>-candidate.vsix` (`<sha12>` is the first 12 hex characters of the built commit; the artifact also holds `manifest-linux.json` and `SHA256SUMS.txt`). The release workflow downloads the exact artifact ID from the newest successful trusted CI run for the current protected `main` commit. It never rebuilds or repackages the extension. **Never rebuild between acceptance and publishing.** If anything changes (including the `publisher` value), build a new candidate and repeat the acceptance steps that the change affects.

After all candidate checks pass on trusted `main`, CI attests the candidate's exact bytes. Release preflight requires exactly that artifact layout, then renames the VSIX to `cyclegauge-v<version>.vsix` without changing its bytes and verifies it against the repository, `.github/workflows/ci.yml` signer, `main` ref, selected source commit, GitHub-hosted runner and SLSA provenance v1. The attestation is a provenance claim, not a malware-free certificate. The selected CI run ID is checked when selecting its artifact and required jobs; it is not an additional attestation identity constraint. A second run at the same commit that produces identical VSIX bytes is acceptable under this policy.

`release:verify` checks content, not container bytes: exactly eight allowlisted entries, manifest identity (name, license, icon, main, no runtime dependencies), machine-scoped source/storage settings, VSIX version equal to the manifest version, a pre-release flag that matches the channel of that version (`VSIXMANIFEST_CHANNEL_MISMATCH` in either direction), MIT text, bundle entry points and the absence of local paths, source maps and credential-shaped strings. It prints a SHA-256 per file. Reproducibility means equal payload hashes from an independent rebuild (`--compare other-manifest.json`); ZIP timestamps differ and are never compared. CI runs this comparison on every candidate.

## 2. Gates before publishing (all mandatory)

1. The selected candidate's CI run is green (verify on macOS, Ubuntu and Windows, candidate built once, independent payload comparison, the same candidate in all three real VS Code extension hosts, and a successful attestation job). A newer failed, cancelled, or incomplete CI run for that same `main` commit blocks promotion; the workflow never falls back to an older run. Preflight rejects a missing or invalid attestation before remote readiness checks.
2. The publisher is **`StefanSuess`** (fixed extension identity; the namespace exists and its public verification status was `true` as observed on 2026-10-17 at [the registry API](https://open-vsx.org/api/StefanSuess)). Namespace existence does not prove publishing permission; the maintainer must confirm access. The intended extension ID is `StefanSuess.cyclegauge`. `release:verify` fails on any other ID.
3. Native macOS acceptance of the exact candidate passed ([macos-acceptance.md](macos-acceptance.md), sections **A, B, D and E**). **Section E (Cost Advisor acceptance) is explicitly mandatory before publishing**, including conditional figures, answers, account isolation and native visibility checks on the exact final VSIX. The preflight summary identifies the CI run, artifact ID, commit and VSIX SHA-256; the artifact link is on that CI run. Until issue #61 provides itemised checklists, a smoke test of the same candidate in native Kiro on Windows and Ubuntu is required before a release that names Windows or Ubuntu.
4. The maintainer reviewed the exact generated release notes, version, commit, artifact identity, and VSIX hash in the candidate summary, then explicitly approved the protected deployment.
5. Security checkpoints: SC1 (Windows storage protection) is implemented (profile permissions for default locations, a verified owner-only DACL for a chosen location) and stays open only for itemised native Windows acceptance (issue #61); SC5 is not implemented. A beta does not close or bypass them.

## 3. One-time setup and publishing

### One-time repository setup

1. Protect `main` with a ruleset that requires pull requests and the CI checks `verify (macos-latest)`, `verify (ubuntu-24.04)`, `verify (windows-2025)`, `release candidate (built once)`, `release candidate on macOS`, `release candidate on Windows` and `release candidate on Ubuntu`; block force pushes and deletion; and require zero approving reviews. Optionally require branches to be up to date. This lets a solo maintainer merge a checked PR without a second reviewer.
2. Create the GitHub `release` environment. Add the sole maintainer as its required reviewer, disable **Prevent self-review**, and restrict deployments to `main`. This allows the workflow initiator to review the candidate summary and approve their own deployment. Store `OPENVSX_PAT` in this environment only if the fallback is needed; never create a repository-level copy.
3. Keep repository Actions permissions read-only. Only the trusted `main` CI attestation job gets `id-token: write` and `attestations: write`; it is deliberately not a required PR branch-protection check because it skips PRs. Release preflight gets `actions: read`, `attestations: read` and `contents: read`. The workflow starts exactly one protected publishing job: the Trusted Publishing job gets `contents: write` and `id-token: write`; the PAT fallback gets `contents: write` and no OIDC permission. The PAT secret is available only in its publish step. Preflight installs pnpm from a committed npm lockfile with package integrity and lifecycle scripts disabled, then installs the locked CLI and copies the promotion scripts into the promotion artifact. Its SHA-256 is checked after approval; publishing jobs do not install dependencies or fetch source.
4. The namespace `StefanSuess` exists and its public verification status was `true` on 2026-10-17. Confirm the maintainer's account has publishing rights; public metadata does not establish account membership or token permissions. Register the exact GitHub repository, `.github/workflows/release.yml` workflow path, and `release` environment as the Trusted Publisher. Until that is done, OIDC is not ready; choose the protected PAT mode only if access and the environment secret are configured.
5. If using the fallback, create an Open VSX access token and store it only as `OPENVSX_PAT` in the protected `release` environment.

### Each release

1. Open **Actions → release → Run workflow** and select `main`. Supply the exact version present in `package.json`. The other inputs are `dry_run` (defaults to `true`) and auth mode (defaults to `trusted-publishing`).
2. Preflight derives the current `main` commit, newest matching `ci.yml` run, exact `release-candidate` artifact ID, and SHA-256 values. It rejects PR artifacts, failed or incomplete CI, expired or ambiguous artifacts, version mismatches, changed payloads, and conflicting remote state. Review the Actions summary and download the artifact from its linked CI run if needed for native acceptance.
3. A dry run follows the same read-only attestation, checksum, changelog and remote-state checks, including public Open VSX metadata and VSIX reads. It makes no publish request, tag, release or asset write, and does not enter the protected environment. The read-only token may not see draft GitHub releases, so an absent release is reported as having unverified draft visibility; the protected job repeats draft discovery with its `contents:write` token before any release creation. It cannot validate whether OIDC or the PAT will authenticate. After this gate first reaches `main`, check a fresh green CI run and a successful dry run before considering a live release; older unattested candidates cannot pass.
4. For a live run, set `dry_run` to `false`. After preflight posts the verified candidate summary, complete native acceptance sections A, B, D and E for that exact VSIX, then approve the `release` deployment. The required reviewer gate is the final human confirmation before credentials and write permissions are available. The sole maintainer can self-approve because self-review prevention is disabled.
5. After approval, the publishing job rechecks that `main` still points to the reviewed commit. If it advanced while approval was pending, the job stops before any remote write and requires a fresh candidate review. Otherwise, the selected protected job lists GitHub releases with draft visibility, matches the exact tag, and rejects duplicate or unverifiable records. It publishes the byte-identical candidate to Open VSX, verifies the remote VSIX hash, creates or verifies `v<version>` on the selected commit, creates or resumes a matching GitHub draft release (marked pre-release only on a pre-release version), verifies its VSIX and checksum assets, then publishes the release. It derives release notes from the selected commit's `CHANGELOG.md` section.

The workflow is create-only. Existing Open VSX versions, tags, releases, or assets are skipped only when their bytes and metadata match the approved candidate and commit. Conflicts, unreadable state, incomplete published releases, and mismatched assets fail closed; nothing is overwritten. An exact matching published release is a no-op. A per-version concurrency group serializes attempts.

If the candidate artifact has expired, run the existing CI workflow manually on `main` at the same commit and wait for its candidate and verification jobs to pass. The release workflow will derive that new artifact. It never rebuilds during promotion. If `main` has advanced, dispatch from the new head and review that new candidate.

The package is universal (no `--target`), so Kiro on any OS may offer it. The listing and README describe a beta for macOS, Windows and Ubuntu with the evidence level per platform (see [platform support](platform-support.md)); Windows default storage relies on profile permissions and a chosen location uses a fail-closed owner-only NTFS DACL; itemised native Windows/Ubuntu acceptance remains outstanding. One universal package is retained because there are no platform-specific runtime dependencies. The same artifact must pass every supported-platform host test and native acceptance before expanding support claims. See [platform verification](platform-verification.md).

## 4. Rollback

A published Open VSX version cannot be edited. If post-publish acceptance section C finds a defect, publish a fixed higher version and mark the listing text accordingly; do not rebuild an existing version number. Keep the previous candidate and its hashes. The workflow treats v0.5.2 as historical and immutable: it will only accept an exact, read-only match and cannot repair that release.

## 5. After publishing

Record version, SHA-256, CI run, Kiro and macOS versions in the release notes. Do not collect telemetry; user feedback arrives through GitHub issues, which must never contain real Kiro data.

## Versioning

Versions are plain `major.minor.patch`. Extension registries do not accept semantic-versioning pre-release tags such as `-beta.1`, so the minor number carries that meaning, following the [VS Code recommendation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#prerelease-extensions):

| Part | Rule |
| --- | --- |
| Major | `0` while Cyclegauge is in initial development: defaults, settings and stored data may change between minor versions. `1` is the first release with a compatibility promise. |
| Minor, **odd** (`0.5.x`, `0.7.x`) | Pre-release (beta) line, published with the pre-release flag. New features and behaviour changes start a new odd minor. |
| Minor, **even** (`0.6.x`, `0.8.x`) | Stable line, published without the pre-release flag. An even minor is the stabilized form of the odd line before it and adds no features of its own. |
| Patch | Fixes and documentation within a line; no new features. |

Version numbers do not track milestone numbers. A version is never reused or republished; a correction is a higher patch.

The release channel is derived from the version in one place, `scripts/release/channel.ts`; CI, the build, `release:verify`, the promotion checks, `ovsx publish --pre-release` and the GitHub `prerelease` value all use it. A mismatch between the VSIX flag and the version's channel fails closed (`VSIXMANIFEST_CHANNEL_MISMATCH`, `VSIX_CHANNEL_MISMATCH`). `package.json` `preview` must equal the channel (a test checks it). A stable line also needs native acceptance on every platform it names as supported.

## Support links and marketplace listing

The root `README.md` serves both GitHub and the extension listing. `scripts/release/build-vsix.ts` copies it and `package.json` into the staging directory; `.vscodeignore` includes both in the VSIX. The README's single **Support Cyclegauge** section is the main place to discover optional Ko-fi support. Other user guides link to the README rather than repeat the request.

`package.json` uses the official [`sponsor.url` field](https://code.visualstudio.com/api/references/extension-manifest) for the same Ko-fi destination. Keep `homepage`, `repository`, `bugs`, and the functional description focused on their existing purposes. Do not add custom donation metadata. A client's display of a separate sponsor control may vary; the packaged README supplies the link regardless.

[Kiro uses Open VSX by default](https://kiro.dev/docs/editor/extension-registry/), and [Open VSX publishes the packaged VSIX](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions#5-package-and-upload). Merging documentation updates changes the GitHub README immediately. The repository Sponsor button uses [`.github/FUNDING.yml` on the default branch](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository); `ko_fi` takes the username, not the full URL. Only add GitHub Sponsors when the maintainer's sponsorship profile is active and publicly accessible.

The already published **v0.5.2** VSIX and its Open VSX README/metadata do not change when this PR is merged. The support section and sponsor metadata require a **new, higher-version VSIX**, followed by the normal acceptance and explicitly approved Open VSX publication. Do not rebuild, replace or republish v0.5.2. GitHub repository links from the current listing can already lead to the updated README after merge.
