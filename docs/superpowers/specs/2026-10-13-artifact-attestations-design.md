# Exact VSIX artifact attestations

## Purpose and boundary

Give users a verifiable provenance statement for the exact `candidate.vsix` that the existing release workflow promotes. The statement proves which GitHub repository, `main` commit, and CI workflow produced the bytes. It does not certify that the extension is malware-free, replace native Kiro acceptance, or change the eight-entry VSIX allowlist, hashes, protected approval, or publication order.

Only a trusted `main` CI run may create an attestation. Pull requests and other branches keep their current read-only token and never receive signing rights. Existing published versions are historical and acquire no retroactive provenance claim.

## CI producer

Add one job to `.github/workflows/ci.yml` that runs on `main` after `verify`, `candidate`, and all three `candidate-host` jobs succeed. It also runs for a manual CI dispatch on `main`, so an expired candidate can be regenerated at the same commit. The job downloads the candidate artifact from its own run, compares `candidate.vsix` against the candidate job's SHA-256 output, then uses a commit-pinned `actions/attest` action with `subject-path` set to that exact file. It checks out no source, installs no dependencies, uses no secrets, and receives only `contents: read`, `id-token: write`, and `attestations: write`. Existing jobs retain their current permissions.

The new job has a stable name and becomes a required successful job in the release candidate selection policy. A skipped, failed, or absent attestation job makes that CI run ineligible for promotion. The selected candidate remains the single existing `release-candidate` artifact; no VSIX rebuild or second package is introduced.

## Release consumer

After the read-only preflight downloads and verifies the selected candidate's existing hash and VSIX contents, it verifies the public attestation for those same bytes with `gh attestation verify`. Verification requires the exact repository, the `.github/workflows/ci.yml` signer workflow, `refs/heads/main`, the selected source commit, and GitHub-hosted runners. The CLI's default SLSA provenance predicate must be verified. The preflight gains only `attestations: read` in addition to its current read permissions; publisher jobs and their credentials do not change.

Failure to find or verify a matching statement stops preflight before the protected publish job. Diagnostics emit a fixed failure code, not CLI output, artifact contents, absolute paths, or other dynamic values. This gate applies to dry runs and live runs. A new successful `main` CI candidate with an attestation is required before any future release after this change; old released versions remain unchanged.

## Evidence, rollout, and limits

- Synthetic release-policy tests cover missing, skipped, failed, and successful attestation jobs; a scoped verification test covers accepted and rejected signer, ref, commit, and byte identity without using private data.
- Run `pnpm typecheck`, `pnpm test`, `pnpm test:release`, and `git diff --check`; validate the edited workflow syntax. Obtain independent read-only review before opening the PR.
- A PR cannot run the trusted `main` signing job. After merge, inspect the first `main` CI attestation for the exact candidate and run a read-only release dry run before any live release. No merge or publication is part of this task.
- Document a user-facing `gh attestation verify` command against a downloaded published VSIX only after a live attested release exists. Keep the later README visual redesign and any malware-scan badge separate.
