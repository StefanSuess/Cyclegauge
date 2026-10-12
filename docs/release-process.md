# Release process (Open VSX beta)

Maintainer-only. Nothing in this document is run by CI or by an assistant: publishing, tagging and creating a GitHub release each need the maintainer's explicit approval.

## 1. What a release candidate is

One VSIX, built once by the `candidate` job in `.github/workflows/ci.yml`, identified by its SHA-256. The same file is verified, tested natively on macOS and then published. **Never rebuild between acceptance and publishing.** If anything changes (including the `publisher` value), build a new candidate and repeat the acceptance steps that the change affects.

```sh
pnpm release:build release/candidate.vsix --pre-release   # staging build, bundle + vsce, nothing in the repo is touched
pnpm release:verify release/candidate.vsix --pre-release --out release/manifest.json
```

`release:verify` checks content, not container bytes: exactly eight allowlisted entries, manifest identity (name, license, icon, main, no runtime dependencies), machine-scoped source/storage settings, VSIX version equal to the manifest version, pre-release flag, MIT text, bundle entry points and the absence of local paths, source maps and credential-shaped strings. It prints a SHA-256 per file. Reproducibility means equal payload hashes from an independent rebuild (`--compare other-manifest.json`); ZIP timestamps differ and are never compared. CI runs this comparison on every candidate.

## 2. Gates before publishing (all mandatory)

1. The candidate's CI run is green (verify on macOS and Ubuntu, candidate built, rebuilt, payload identical, macOS download check).
2. The publisher is **`StefanSuess`** (fixed extension identity; the namespace exists, with public verification status `false` as observed on 2026-10-12 at [the registry API](https://open-vsx.org/api/StefanSuess)). Namespace existence does not prove publishing permission; the maintainer must confirm access. The intended extension ID is `StefanSuess.cyclegauge`. `release:verify` fails on any other ID.
3. Native macOS acceptance of the exact final candidate passed ([macos-acceptance.md](macos-acceptance.md), sections **A, B, C, D and E**). **Section E (Cost Advisor acceptance) is explicitly mandatory before publishing**, including conditional figures, answers, account isolation and native visibility checks on the exact final VSIX.
4. The maintainer approved the version, the changelog text and the listing text.
5. Security checkpoints stay as they are: SC1 open (Windows storage disabled), SC5 not implemented. A beta does not close or bypass them.

## 3. Publishing (maintainer, one time per version)

1. Create an Eclipse Foundation account, link your GitHub username, sign the Open VSX Publisher Agreement and create an access token at open-vsx.org (maintainer actions; the token never goes into the repository, CI or chat).
2. The namespace `StefanSuess` already exists; do not recreate it or assume it is available for registration. Confirm the maintainer's Eclipse account has publishing rights for that namespace using the registry account interface. Public namespace metadata does not establish membership or token permissions. If access is missing, resolve it before publishing; do not change the extension identity as an automatic workaround.
3. **Namespace ownership verification remains outstanding:** the public API currently reports `verified: false` (2026-10-12). An unverified namespace is shown as such on the listing. Request ownership of the `StefanSuess` namespace through Open VSX's claim process (currently a GitHub issue on the open-vsx.org repository, referencing your Eclipse account and GitHub identity; check the current Open VSX documentation for the exact steps). A verified namespace is also the basis for later namespace protection against look-alikes.
4. Check the checksum of the file you are about to publish against the one recorded for the accepted candidate:
   ```sh
   shasum -a 256 release/candidate.vsix
   ```
5. `npx ovsx publish release/candidate.vsix --pre-release -p <token>` (or the `OVSX_PAT` environment variable).
6. Open the listing, install from it in a clean isolated Kiro profile and repeat acceptance section D.
7. Only then, with approval: tag `v<version>` on the accepted commit and create a GitHub release that attaches the same VSIX and `SHA256SUMS.txt`.

The package is universal (no `--target`), so Kiro on any OS may offer it. The listing and README state "macOS beta"; Windows storage fails closed by design and Linux is unverified. Restricting to `darwin-arm64`/`darwin-x64` is possible with two target-specific builds but each would need its own native test; deferred.

## 4. Rollback

A published Open VSX version cannot be edited. If acceptance step D finds a defect, publish a fixed higher version quickly and mark the listing text accordingly; do not rebuild an existing version number. Keep the previous candidate and its hashes.

## 5. After publishing

Record version, SHA-256, CI run, Kiro and macOS versions in the release notes. Do not collect telemetry; user feedback arrives through GitHub issues, which must never contain real Kiro data.

## Review status for PR #17

The local independent read-only code review completed, with its two minor findings resolved. The GitHub connector initially requested a Codex environment, but subsequently completed a review of commit `92c398d` and reported one P2 finding: the Enterprise UI incorrectly described unknown purchased add-ons as assumed absent. The disclosure now keeps unknown/unentered add-ons distinct from the explicitly hypothetical `assumed_none` state; a regression test reproduced the issue before the fix. This changes presentation only, not the fail-closed profile or calculations. Review coverage is commit-specific: do not describe the earlier review as approval of a later candidate. Native acceptance remains mandatory before publication.
