# Contributing

Thank you for your interest. This project tracks Kiro credit usage **locally and read-only**, so
privacy rules are strict. Please read this page before opening an issue or pull request.

## Privacy rules (non-negotiable)

- **Never post real Kiro data** in an issue, pull request, comment or fixture: no logs, databases,
  transcripts, prompts, tokens, account/user/session identifiers, screenshots of your account, or
  private workspace paths. Redacting a real record is not enough; build invented data instead.
- All test fixtures must be **invented from scratch** with obvious `synthetic-*` identifiers and fixed
  invented dates and numbers.
- The extension must never write to Kiro-owned files, call Kiro or authenticated services, or add
  network code or telemetry.

The full rules are in [AGENTS.md](AGENTS.md), [SPEC.md](SPEC.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
`AGENTS.md` is written for coding agents but applies to human contributors too.

## Reporting a bug

Use the issue form. Include version, OS and Kiro version, what you expected and what happened. Versions
that have the **Bobert: Copy Diagnostics** command (or the CLI's `--diagnostics`) print only
fixed codes, counts and version/platform metadata, which is safe to paste. Older versions have no
diagnostics output: describe the problem in words and do not paste logs. Security problems go to
[SECURITY.md](SECURITY.md), not to a public issue.

## Proposing a change

1. Open an issue first for anything larger than a small fix, so scope can be agreed. Features that
   are not in [ROADMAP.md](ROADMAP.md) (for example session aggregation or Crew integration) need
   explicit maintainer approval before work starts.
2. Fork, branch from the current development branch named in the issue, keep the change small.
3. Preserve existing data formats, billing semantics and forecast algorithms unless the issue says
   otherwise.
4. Run the checks locally (Node.js 24.13 or newer, pnpm):

   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm test
   python3 tests/fixtures/kiro/validate.py
   git diff --check
   ```

5. Open a pull request using the template. Pull requests that touch storage, source reading,
   packaging or workflows get a security review.

## Platform claims

Do not claim support for a platform you did not verify natively. Windows storage is intentionally
disabled; macOS observations do not verify Windows, Ubuntu or RHEL.

## License

By contributing you agree that your contribution is licensed under the project's MIT license (see
[LICENSE](LICENSE)).
