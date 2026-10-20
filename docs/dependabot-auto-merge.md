# Dependabot npm patch auto-merge

This automation does not auto-publish a new extension version. **The first live eligible patch PR passed end-to-end on 2026-10-12:** [Dependabot PR #45](https://github.com/StefanSuess/Bobert/pull/45) passed the signed-patch verifier and the protected PAT merge step in [workflow run 38316270235](https://github.com/StefanSuess/Bobert/actions/runs/38316270235); PR #45 was merged and the subsequent [main push CI](https://github.com/StefanSuess/Bobert/actions/runs/38316288428) succeeded. This proves the configured path worked for that PR, not that future dependency updates are automatically safe. GitHub reports **Allow auto-merge is enabled**. The secret itself and its expiry/permissions remain inaccessible through the repository review API.

## One-time setup (repository administrator)

1. In **Settings -> General -> Pull Requests**, enable **Allow auto-merge**. Preserve squash merging and automatic deletion of merged branches.
2. Create a fine-grained personal access token (PAT) restricted to **StefanSuess/Bobert** with repository permissions **Contents: Read and write** and **Pull requests: Read and write**. Set a limited expiration and rotate it before it expires.
3. In **Settings -> Secrets and variables -> Actions** (not Dependabot secrets), create the repository secret **`DEPENDABOT_AUTOMERGE_TOKEN`** containing that PAT.
4. Keep the default-branch ruleset active, including all four required CI checks. Prefer enabling **Require branches to be up to date before merging** as well.

Do **not** add this PAT to the untrusted `ci.yml` workflow or to a `pull_request_target` workflow. Never print the token or use it to check out/run PR code. The Auto-Merge workflow only makes GitHub API calls against a validated PR.

## What happens

- `.github/dependabot.yml` creates separate npm **`npm-patch`** and **`npm-minor`** groups. GitHub Actions dependency updates remain separate and are never auto-merged.
- A read-only **`ci`** run completes on a Dependabot PR.
- `.github/workflows/dependabot-auto-merge.yml` starts from GitHub's **`workflow_run`** event. It does not check out or execute PR contents.
- The workflow requires a *successful* pull-request CI run with Dependabot as the run actor; exactly one open, non-draft Dependabot PR targeting `main`; the PR's head SHA must match that successful CI run.
- It additionally verifies the Dependabot branch name, a single signed and verified Dependabot commit, patch-only metadata for the **`npm-patch`** group, and changes limited to `package.json` and/or `pnpm-lock.yaml`.
- The PAT only reaches the last step. `gh pr merge --auto --squash` enables GitHub's native auto-merge. GitHub still enforces all required PR checks and branch rules. Failed checks, modified PRs, other package groups, or missing metadata are skipped.
- Using a PAT rather than the built-in `GITHUB_TOKEN` for the merge allows the normal `push` CI on `main` to run, which is required by the gated release pipeline.

**Fail-closed behavior:** If the qualifying PR passes validation but the PAT is absent, the merge step fails and nothing is merged. The administrator can then set the secret. This is intentionally *not* a broad auto-approval bot.

## Live proof and future regression checks

- **Observed:** PR #45 was an eligible signed `npm-patch` update with passing four-job PR CI. The privileged verifier identified it, the PAT-backed `gh pr merge --auto --squash` step succeeded, the PR was merged, and a new main push CI succeeded (links above).
- **Keep validating:** After changes to this workflow, repository rules or Dependabot formatting, confirm an eligible fresh patch PR still passes the full chain: signed metadata verification, native auto-merge, and new green `main` push CI. Do not relax eligibility merely to make a skipped run execute.
- **Operator upkeep:** Monitor PAT expiration/rotation and preserve repository-secret placement, branch rules and required checks. The successful run does not expose or verify the secret's exact scope or expiration.

The workflow deliberately handles only Dependabot's current grouped-patch commit format. If Dependabot changes that format, it will skip merging until the verification is reviewed and updated.
