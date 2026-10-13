# Exact VSIX Artifact Attestations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attest the exact trusted `main` CI VSIX and reject any future release candidate without matching provenance.

**Architecture:** A main-only CI job signs the existing candidate after all current checks. The read-only release preflight verifies the copied, renamed VSIX with GitHub's native CLI before remote readiness or protected publication.

**Tech Stack:** GitHub Actions, `actions/attest` pinned at `1e69f48acb82d1966a394da916b4c1698aa569d6` (v4.2.2), GitHub CLI, Node release-policy tests.

**Spec:** `docs/superpowers/specs/2026-10-13-artifact-attestations-design.md`

## Global Constraints

- Keep all existing build, allowlist, checksum, protected-approval, and publish-order gates.
- No extra VSIX build, artifact, dependency, signing service, Cosign or SBOM pipeline.
- Only the new main-only CI job gets `id-token: write` and `attestations: write`; preflight gets only `attestations: read` plus existing rights.
- An attestation is provenance, not a malware-free certificate. No merge or publication in this task.

## Review Focus

- PR or non-main CI: signing job skipped; no elevated job permissions available to those runs.
- Missing, skipped, failed, or duplicate attestation job: CI selection fails closed.
- Same commit, different bytes: file digest verification fails; same commit, identical bytes from another run is accepted intentionally.
- Wrong signer/ref/commit or self-hosted runner: CLI constraints reject the statement.
- Versioned release filename: verification still uses the unchanged file bytes, not the original name.

---

### Task 1: Main-only CI signer and release job policy

**Files:** `.github/workflows/ci.yml`, `scripts/release/promotion-policy.ts`, `tests/release/promotion-policy.test.ts`

- [ ] Add `attest release candidate` to the existing synthetic required-jobs test and assert absent, skipped, failed, and duplicate entries fail. Run the focused test and observe failure.
- [ ] Add that name to `REQUIRED_CI_JOBS`. Run the focused test and observe success.
- [ ] Add one CI job with `needs: [verify, candidate, candidate-host]`, restricted to trusted `main` push or dispatch. Download this run's existing artifact, compare its VSIX SHA-256 with `needs.candidate.outputs.sha256`, and use the pinned `actions/attest` action on `release/candidate.vsix`. Keep the workflow default read-only and scope signing permissions to this job.
- [ ] Validate the YAML and required job names; run `pnpm test:release`. Commit only these files.

### Task 2: Fail-closed verification in release preflight

**Files:** `.github/workflows/release.yml`, `tests/release/attestation-workflow.test.ts`, `docs/release-process.md`, `docs/release-runbook.md`

- [ ] Add a focused synthetic/static workflow test for the step position, `GH_TOKEN`, the exact repository/signer/ref/commit/host/predicate flags, fixed error code, and suppressed CLI output. Run it and observe failure.
- [ ] Add `attestations: read` to preflight only. Immediately after `verify-promotion.ts`, run `gh attestation verify` on `release/promotion-bundle/cyclegauge-v${VERSION}.vsix`, with all required flags. Suppress CLI output; print only `ATTESTATION_VERIFICATION_FAILED` and exit nonzero on failure. Run the focused test and observe success.
- [ ] Update release process/runbook for the new gate, same-commit identical-byte decision, main-only rollout and first post-merge dry-run check. Run `git diff --check` and validate the YAML. Commit only these files.

### Task 3: Final verification and PR

- [ ] Run `pnpm typecheck`, `pnpm test`, `pnpm test:release`, `git diff --check`, and workflow syntax validation; inspect the staged/committed diff.
- [ ] Give one fresh read-only reviewer the final diff, criteria, and actual check results. Fix material findings and rerun affected checks.
- [ ] Push the branch and open a focused PR. Do not merge or publish. State that the signing job and live attestation verification can only be observed on `main` after merge.
