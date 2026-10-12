# Gated GitHub Actions release pipeline for Cyclegauge

Status: approved with solo-maintainer and minimal-input adjustments; implementation is complete on the review branch. This document defines a promotion path for future releases; implementation did not publish, tag, or change any release.

## Goal

Promote the existing CI release candidate VSIX to Open VSX and GitHub without a second packaging path. A maintainer selects the version, inspects the verified candidate selected from the latest successful CI run for current protected `main`, completes native acceptance of that exact candidate, and approves the protected release job. Actions derives the approved commit, CI run, artifact ID, and checksums, then performs the verified publication and GitHub release work.

The workflow is manual-only. A merge to `main` must never publish by itself.

## Current release-candidate boundary

`.github/workflows/ci.yml` already builds `release/candidate.vsix` once in its `candidate` job. It checks the VSIX allowlist and pre-release flag, compares the payload with an independent build, records `manifest-linux.json` and `SHA256SUMS.txt`, uploads the `release-candidate` artifact, and verifies that same artifact on macOS. The promotion workflow consumes that artifact by CI run ID and artifact ID. It does not call `release:build`, repackage the extension, or substitute another VSIX.

The promotion checks both the whole-file SHA-256 and the existing payload manifest. Whole-file equality proves which VSIX is promoted; payload equality preserves the package-content gate already used by CI.

## Trust and permission boundaries

### CI

- Keep normal PR, push, and manual CI read-only (`contents: read`); do not add publishing secrets, `id-token: write`, tag permissions, or release permissions to `.github/workflows/ci.yml`.
- Query the repository's `ci.yml` runs and `main` ref. Select only the newest CI run for the exact current `main` SHA; it must be a completed, successful `push` or `workflow_dispatch` run on `main`. If the newest run for that SHA failed, was cancelled, or is still running, fail rather than falling back to an older run. Reject PR and all other event types.
- A `push` run remains trusted when GitHub includes metadata linking its commit to a merged PR; trust is based on the run event, protected branch, exact SHA, repository, and workflow. A `pull_request` event is always rejected.
- Confirm there is exactly one non-expired `release-candidate` artifact for that exact run, and verify its artifact ID and workflow-run metadata. Require the candidate, macOS candidate verification, and every CI verification matrix job to conclude successfully. A successful run from an unprotected branch is not trusted; `main` protection is a required repository setup item.
- Use the selected run's exact commit for `package.json`, `CHANGELOG.md`, and `scripts/release/verify-vsix.ts`. Require `package.json.version` and the VSIX version to equal the explicit input version, require the pre-release marker, and compare verified allowlisted file hashes with the CI manifest.
- Recompute the candidate VSIX SHA-256 and require it to match the checksum inside the CI artifact. GitHub's optional artifact digest covers the uploaded ZIP container, not the VSIX; record and validate its format as artifact metadata but never compare it with the VSIX hash. No checksum or run identifier is copied manually. Reject missing, malformed, extra, or inconsistent candidate files.
- Keep the selected run ID, artifact ID, commit, version, and VSIX hash in a concise Actions summary with links to the run/artifact. The maintainer reviews this exact candidate before approving. Diagnostics must not echo secrets, raw tokens, or unrelated environment data.

### Workflow jobs and credentials

The release workflow has no publishing trigger other than `workflow_dispatch` and defaults to no token permissions. GitHub environment reviewers are configured in repository settings, not in YAML; a live run must not be attempted until the `release` environment has the sole maintainer as its required reviewer and self-review prevention is disabled.

1. **Preflight** has only `actions: read` and `contents: read`. It validates the run, artifact, version, checksum, manifest, changelog section, and existing remote state. It has no environment secrets and no OIDC permission. It copies the exact verified VSIX and derived release metadata into an immutable artifact of the current workflow run for the final job.
2. **Publishing** is split into mutually exclusive trusted-publishing and PAT jobs, selected by the explicit auth-mode input and gated on `dry_run` being false. Both reference the protected `release` environment. The OIDC job alone has `id-token: write`; both get `contents: write`, and the PAT job has no OIDC permission. Configure the solo maintainer as the required reviewer and leave “Prevent self-review” disabled so the workflow initiator can explicitly approve their own deployment; no second person is required. Environment secrets remain unavailable until that approval. Preflight installs pnpm from a committed npm lockfile with registry integrity and lifecycle scripts disabled, installs the exact locked Open VSX CLI, and packages it with the promotion code and artifact; the archive is hashed in preflight and checked after approval. Publishing jobs do not install dependencies or fetch source. After approval, the selected job verifies the promotion-artifact hash and confirms `main` still points to the approved commit before any remote write, then performs publication. It uses pinned actions and does not execute code from an arbitrary run.

The preflight GitHub token is read-only and is used for run/job/artifact metadata and visible tag/release state. Drafts may be hidden from this token, so an absent release in preflight has unverified draft visibility. The protected job uses its `contents:write` token to list releases, including drafts, by exact tag before release creation; duplicate, conflicting, or unreadable results fail closed. A protected publishing job passes its write-capable GitHub token only to the promotion script. The optional `OPENVSX_PAT` is a secret on the protected `release` environment, not a repository-wide secret, and is exposed only to the Open VSX publish step in the PAT job. It is never placed in a command-line argument or logged. The PAT job has no OIDC permission; in trusted-publishing mode the PAT is not passed at all.

OIDC is the preferred mode. The namespace is not yet verified, so the workflow must not claim that OIDC is ready. The Open VSX OIDC option uses `ovsx publish --trusted-publishing`; it fails closed if the required identity token or Open VSX trust registration is unavailable. Until namespace verification and publisher registration are complete, the operator may choose the protected-environment PAT fallback.

## Manual inputs and approval gates

`workflow_dispatch` runs must target `main`; preflight rejects any other dispatch ref and requires the workflow run's `github.sha` to equal the current `main` head. After environment approval, the publish job reads `main` again and fails before writing if it has advanced. Inputs are:

- explicit package version;
- `dry_run` (defaults to true);
- Open VSX auth mode (`trusted-publishing` or `pat`, defaulting to `trusted-publishing`).

The workflow derives the current `main` commit, newest CI run for that SHA, unique artifact ID, CI manifest, and expected VSIX checksum. It fails if the latest CI run is not successful, if the artifact is expired or ambiguous, or if its package version differs from the requested version. It never silently selects an older successful run. The preflight summary is the human-readable approval record for the derived commit, run, artifact, and hash.

Release notes are taken from the version's section in `CHANGELOG.md` at the approved commit, not from free-form shell input. The workflow appends the approved source commit and VSIX hash to the generated notes. A changelog change therefore requires a new main commit and a new CI candidate.

A live run waits at the protected `release` deployment after preflight has posted the candidate summary. The maintainer reviews the derived commit, CI run, artifact, version, and SHA-256, completes native acceptance of that exact candidate, and explicitly approves the deployment. The solo maintainer is an allowed required reviewer and may approve the run they initiated because self-review prevention is intentionally disabled. This approval is the final release confirmation and authorization before credentials or write permissions become available.

The final VSIX asset is named `cyclegauge-v<version>.vsix`. Preflight verifies the CI checksum line for `candidate.vsix`, then derives a release `SHA256SUMS.txt` naming the final asset; this changes only the checksum text, never the approved VSIX bytes.

## Dry run

A dry run executes the same read-only provenance, artifact, version, content, checksum, changelog, Open VSX version, tag, and GitHub release checks. It writes a readiness summary and makes no publication request, creates no tag or release, modifies no existing release, and never enters the protected environment. It has no PAT or OIDC token.

Dry run cannot prove that the Open VSX namespace will accept an OIDC exchange, that a PAT is valid, or that no hidden draft exists, because credential and draft access are intentionally limited. The summary states these limitations. The protected publishing job resolves draft state before release creation.

## Promotion and safe retry state machine

Preflight checks existing state, and the protected job repeats the relevant reads immediately before each write. A per-version concurrency group serializes this workflow's attempts. Writes are create-only: no force-push, release clobber, asset replacement, or Open VSX overwrite.

| State | Action |
|---|---|
| Open VSX version absent | Publish the approved VSIX once; then download the published version and require its SHA-256 to equal the approved VSIX hash. |
| Open VSX version exists and bytes match | Skip publishing and continue as an idempotent retry. |
| Open VSX version exists but differs or cannot be verified | Stop without mutation. |
| Tag absent | After Open VSX is verified, create `v<version>` pointing to the approved commit. |
| Tag resolves to the approved commit | Skip tag creation. |
| Tag resolves elsewhere or is unreadable | Stop without mutation. |
| A GitHub release exists while the tag is absent, or its tag name disagrees | Stop without mutation; do not repair inconsistent pre-existing release state. |
| GitHub release absent | Create a draft pre-release for the verified tag, attach the versioned VSIX and matching `SHA256SUMS.txt`, verify both remote asset hashes, then publish the draft. |
| Matching draft exists | Add only missing assets, verify all assets and release metadata, then publish it. An existing same-name asset is accepted only if its bytes match. |
| Matching published pre-release exists with the expected tag, notes, VSIX, and checksum | Return success without changing it. |
| Existing release metadata, tag, or asset conflicts; or an already-published release is incomplete | Stop without mutation. Never clobber or edit a published release. |

If Open VSX succeeds and a later GitHub operation fails, the next run uses the same CI artifact. It verifies the Open VSX bytes and resumes at the first missing matching state. If an artifact expires, the operator must create a fresh successful CI artifact from the same approved commit; the promotion job never rebuilds or fabricates a replacement.

The pipeline treats v0.5.2 as historical and immutable. A request for v0.5.2 may only return a read-only no-op if every existing Open VSX, tag, and GitHub release record already matches exactly; it may not repair, add, or change any part of that release. A mismatch fails closed. Future releases may be retried only after all existing state is verified against the intended candidate and commit.

## Repository and privacy boundaries

- The VSIX must continue to pass `release:verify --pre-release`; candidate bytes and the existing allowlisted package payload remain unchanged during promotion.
- The workflow handles only public release metadata and invented/test artifacts. It must not read Kiro data, credentials, local files, private workspace paths, or session content.
- No raw credentials, token values, account identifiers, private paths, or unrelated logs enter job output or release notes.
- Keep the v0.5.2 Git tag, GitHub release, assets, and changelog content unchanged. Documentation for the new process is additive; correct any stale status prose as a dated follow-up without rewriting the historical release record.
- PR #19 remains separate. Its cleanup may be considered under the stated assumption that no external users or historical migration are required, but its behavior changes must pass the full applicable validation and native acceptance before a release containing them.

## Minimal one-time setup

1. Protect `main` with a ruleset: require a pull request and successful CI checks; require no approving reviews; block force pushes and deletion. This lets the solo maintainer merge their own PR after checks pass without a second reviewer.
2. Create the GitHub `release` environment, set the solo maintainer as the required reviewer, leave prevention of self-review disabled, and store `OPENVSX_PAT` there only if the fallback is needed.
3. Complete Open VSX publisher agreement and namespace setup. Namespace verification is currently pending. After verification, register the exact GitHub repository, workflow path, and `release` environment as the Trusted Publisher. Until then, select PAT mode.
4. Keep repository-level Actions permissions read-only; the release workflow grants write/OIDC permissions only to its protected publish job.

References: [GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [GitHub artifact download action](https://github.com/actions/download-artifact), [Open VSX CLI and Trusted Publishing](https://github.com/eclipse-openvsx/openvsx/blob/main/cli/README.md), [Eclipse Trusted Publishing setup](https://blogs.eclipse.org/post/tamas-cservenak/trusted-publishing-open-vsx).
