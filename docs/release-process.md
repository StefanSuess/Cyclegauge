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
2. The **maintainer decides the publisher / Open VSX namespace** and `package.json` is updated accordingly. Until then `easykirogauge` is a provisional placeholder and no candidate is final. The extension ID is `publisher.name`; the legacy build is `easykirogauge.easykirogauge` and is detected by a constant that must not change.
3. Native macOS acceptance of the exact final candidate passed ([macos-acceptance.md](macos-acceptance.md), sections A to C and E).
4. The maintainer approved the version, the changelog text and the listing text.
5. Security checkpoints stay as they are: SC1 open (Windows storage disabled), SC5 not implemented. A beta does not close or bypass them.

## 3. Publishing (maintainer, one time per version)

1. Create an Eclipse Foundation account, link your GitHub username, sign the Open VSX Publisher Agreement and create an access token at open-vsx.org (maintainer actions; the token never goes into the repository, CI or chat).
2. Create the namespace once: `npx ovsx create-namespace <publisher> -p <token>`. Optionally ask for ownership verification so the listing is not marked "unverified".
3. Check the checksum of the file you are about to publish against the one recorded for the accepted candidate:
   ```sh
   shasum -a 256 release/candidate.vsix
   ```
4. `npx ovsx publish release/candidate.vsix --pre-release -p <token>` (or the `OVSX_PAT` environment variable).
5. Open the listing, install from it in a clean isolated Kiro profile and repeat acceptance section D.
6. Only then, with approval: tag `v<version>` on the accepted commit and create a GitHub release that attaches the same VSIX and `SHA256SUMS.txt`.

The package is universal (no `--target`), so Kiro on any OS may offer it. The listing and README state "macOS beta"; Windows storage fails closed by design and Linux is unverified. Restricting to `darwin-arm64`/`darwin-x64` is possible with two target-specific builds but each would need its own native test; deferred.

## 4. Rollback

A published Open VSX version cannot be edited. If acceptance step D finds a defect, publish a fixed higher version quickly and mark the listing text accordingly; do not rebuild an existing version number. Keep the previous candidate and its hashes.

## 5. After publishing

Record version, SHA-256, CI run, Kiro and macOS versions in the release notes. Do not collect telemetry; user feedback arrives through GitHub issues, which must never contain real Kiro data.
