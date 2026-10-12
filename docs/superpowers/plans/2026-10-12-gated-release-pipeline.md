# Gated GitHub Actions release pipeline implementation plan

Implements [the release-pipeline design](../specs/2026-10-12-gated-release-pipeline-design.md), approved with solo-maintainer and minimal-input adjustments on 2026-10-12. Scope is limited to workflow, release tooling/tests, and release documentation. Implementation is complete on the review branch; no publication, tag, release, PR #19 merge, or v0.5.2 artifact change occurred.

## Constraints

- Extend the candidate artifact produced by `.github/workflows/ci.yml`; the promotion workflow never rebuilds or repackages a VSIX.
- Keep PR and main CI read-only. Only the selected protected publishing job may receive `contents: write` or the `release` environment; only Trusted Publishing receives `id-token: write`, and only the PAT job's publish step receives the optional PAT secret.
- Automatically derive the current `main` SHA, newest `ci.yml` run for that SHA, exact artifact ID, and checksums. Accept only a successful trusted `push` or `workflow_dispatch` run on protected `main`; reject PR artifacts and all other events/branches. Do not fall back to an older successful run when the newest run failed or is incomplete.
- Classify trust by event and exact protected-main provenance; metadata associating a trusted main `push` with its merged PR does not turn it into a PR artifact.
- Keep only three manual inputs: version, dry-run flag (safe default true), and auth mode (OIDC-first). The release summary exposes the derived commit, run, artifact, and SHA before the required environment approval, which is the explicit live release confirmation.
- Configure the solo maintainer as a required `release` environment reviewer and leave self-review prevention disabled; the initiator must be able to approve their own deployment. Recommend branch rules requiring CI and blocking force pushes while requiring zero PR approvals.
- Preserve pre-release verification, exact package allowlist, whole-file SHA-256, payload manifest comparison, privacy rules, and existing security checkpoints.
- Treat v0.5.2 as immutable. Keep PR #19 separate; before a future release includes its behavioral changes, run the full applicable validation and native acceptance.
- The requested commit and focused PR are authorized after verification; do not publish or create a release in this implementation.

## Tasks

### Task 1: Candidate selection and promotion-policy tests

- [x] Add `tests/release/promotion-policy.test.ts` first. Cover latest-main-SHA and newest-CI-run selection; accepted event/branch/workflow/conclusion/required jobs; current workflow SHA mismatch; unique artifact ID/name/expiry and run association; package and VSIX version/pre-release matching; checksum and payload-manifest matching; changelog extraction; and release-state decisions.
- [x] Include rejections for PR runs, wrong branch/workflow/SHA, failed or in-progress newest runs, missing jobs, expired/ambiguous/unrelated artifacts, malformed hashes, and mismatched package contents. Watch tests fail for missing behavior.
- [x] Run the focused test and the full release suite after the first implementation in the next dependent task.

### Task 2: Retry and write-boundary state tests

- [x] Add `tests/release/promotion-state.test.ts` using fake Open VSX/GitHub adapters. Cover absent, exact-existing, partial, conflicting, and unverifiable states.
- [x] Prove exact retries skip completed work; mismatched versions/tags/releases/assets fail closed; published releases are never edited; dry-run makes zero write calls; and v0.5.2 can only be an exact read-only no-op.
- [x] Watch tests fail before implementing the state engine; run focused and full release suites after its implementation.

### Task 3: Pure promotion-policy helpers

- [x] Implement `scripts/release/promotion-policy.ts` with deterministic input validation, trusted-run/artifact acceptance, candidate identity checks, changelog extraction, release-note construction, and state-transition decisions.
- [x] Keep API/network calls and GitHub Actions expressions outside these functions. Use fixed error codes in diagnostics.

### Task 4: Manual workflow and least-privilege permissions

- [x] Implement `.github/workflows/release.yml` with only `workflow_dispatch` inputs: version, dry-run, and auth mode.
- [x] Default permissions to none; require dispatch ref `main` and `github.sha` equal current `main`.
- [x] Define read-only `preflight` permissions and mutually exclusive protected Trusted Publishing and PAT jobs gated by `dry_run == false`. Only the OIDC job receives `id-token: write`; both selected jobs receive `contents: write`. Pin every action by full commit SHA.

### Task 5: Provenance, run selection, and artifact verification

- [x] Add `scripts/release/select-candidate.ts` and `scripts/release/verify-promotion.ts`.
- [x] With the read-only token, derive current `main` SHA; select the newest `ci.yml` run for that exact SHA and fail unless it is completed, successful, and every required CI job succeeded. Resolve exactly one unexpired `release-candidate` artifact from that run; check repository/run/head metadata.
- [x] Download using the derived run and artifact IDs, checkout the selected SHA, verify version, changelog section, pre-release marker, checksum, and payload manifest, then upload only verified bytes plus release metadata as an immutable current-run artifact. Never call the VSIX build command.
- [x] Summary must show links and the derived run, artifact, commit, version, and VSIX hash before environment approval.

### Task 6: Read-only remote preflight

- [x] Implement `scripts/release/release-state.ts` reads for the Open VSX version and hash, Git tag target, and GitHub release metadata/assets.
- [x] Fail before approval on conflicts. Dry runs emit `credential readiness not tested` and do not reference the protected environment, secrets, or OIDC.

### Task 7: Protected publication and recovery

- [x] Add `scripts/release/publisher-tools/package.json` and `scripts/release/publisher-tools/pnpm-lock.yaml` to pin the Open VSX CLI dependency graph outside the extension manifest; install from that lockfile with lifecycle scripts disabled.
- [x] Install the locked CLI and package it with the exact promotion scripts in preflight; re-hash and unpack that immutable runtime after approval. Confirm current main still equals the approved commit; re-read remote state before each write. Use `ovsx publish --trusted-publishing` or expose `OPENVSX_PAT` only to the PAT publish step.
- [x] Verify Open VSX bytes, create a tag without force, create/resume a matching draft release, add only missing matching assets, verify downloaded hashes, and publish the draft last. An exact published release is a no-op; any conflict stops without overwrite.

### Task 8: Workflow-policy regression tests

- [x] Add `tests/release/workflow-policy.test.ts` asserting normal CI remains read-only, the release workflow has no push/merge publish trigger, the OIDC and PAT jobs have separate least-privilege permissions, publishing jobs do no package install or source fetch, and all external actions are SHA-pinned.
- [x] Do not add a second packaging job or modify CI permissions.

### Task 9: Release-process documentation

- [x] Update `docs/release-process.md` with the three inputs, automatic CI/artifact/hash selection, candidate-summary review, native acceptance and solo self-approval gates, dry-run limits, OIDC-first setup, protected-environment PAT fallback, artifact-expiry recovery, retries/conflicts, and setup checklist.
- [x] State that namespace verification is pending; never claim OIDC is already configured.

### Task 10: Preserve v0.5.2 historical documentation

- [x] Update `docs/version-history.md` and the status prose in `docs/identity-migration.md` only as needed to accurately record that v0.5.2 was published; preserve its contemporaneous change description and platform limitations.
- [x] Do not alter the v0.5.2 tag, GitHub release, assets, VSIX, or `CHANGELOG.md` section.

### Task 11: Keep PR #19 separate

- [x] Do not merge its branch or mix its cleanup into the pipeline PR. Preserve the assumption that no external users or historical migration are required.
- [x] Require the full applicable tests and native acceptance before a future release includes its behavior changes.

### Task 12: Verify without publishing

- [x] Run focused release tests, the full unit suite, typecheck, fixture validator, workflow policy checks, and `git diff --check`. `actionlint` is unavailable in this environment; the workflow parsed with Ruby YAML and policy tests passed.
- [x] Exercise dry-run against synthetic artifacts and mocked remote state. Review effective permissions, branch/environment setup instructions, action pins, logs, and the final file list.
- [x] Do not run `ovsx publish`, create a real tag/release, use a PAT, or make a live OIDC request. After verification, commit and open the focused PR; do not merge.

### Task 13: Apply final security-review corrections

- [x] Move dependency installation and promotion-source preparation into read-only preflight; package them in the current workflow's immutable bundle and verify its SHA-256 after approval.
- [x] Pin the pnpm bootstrap package and registry integrity in an npm lockfile; install it with `npm ci --ignore-scripts` instead of an unverified global install.
- [x] Split OIDC and PAT publication into mutually exclusive protected jobs; PAT mode receives no `id-token: write` permission.
- [x] Recheck the current protected `main` SHA after approval and fail before promotion if it differs from the reviewed candidate commit.
- [ ] Re-run all release, unit, typecheck, fixture, YAML, and diff checks; then stage, commit, push and open the focused PR without creating a release or tag.

## Expected review boundary

The resulting focused PR should contain only the manual release workflow, promotion tooling and synthetic tests, release-process documentation, and additive/corrective historical documentation. It must not include PR #19 code or changes to the published v0.5.2 artifacts. Stop after opening the PR for review; do not merge it.

## Shared interfaces

- Candidate selection produces `{ runId, runSha, artifactId, artifactName, artifactDigest }`; promotion verification consumes those identifiers and returns the verified VSIX hash, package version, and payload manifest.
- The verified promotion bundle contains the byte-identical VSIX, derived release checksum, source run/SHA/artifact metadata, and deterministic release notes; the protected publish job consumes this bundle and rechecks its VSIX hash.
- Release-state inspection is read-only; its state model is consumed by both dry-run preflight and protected mutations. The same exact-match/conflict rules apply in both places.
- Workflow policy tests assert that only protected publishing jobs can hold write permissions, only Trusted Publishing can hold OIDC permission, PAT mode has no OIDC permission, and normal CI stays read-only.
