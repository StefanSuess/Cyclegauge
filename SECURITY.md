# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**. Include the affected version, platform, and the steps to reproduce.

**Never attach real Kiro logs, databases, transcripts, tokens or screenshots of your account.**
Describe the problem with invented values. If a report needs data, build a tiny synthetic example.

This is a hobby-scale project maintained by one person. You can expect an acknowledgement as soon
as practical, but there is no guaranteed response time and no bug bounty.

## Scope

Cyclegauge for Kiro IDE is a local, read-only extension. It reads Kiro's existing usage logs, stores
derived billing numbers in its own private directory, and has no network code and no telemetry.
On macOS it also, for the optional session hints, parses up to 20 of the most recently changed
sessions' `session.json` files (each whole, in memory, including titles and workspace paths) to find the
newest session of your open folder and loads up to the last 256 KiB of that session's `messages.jsonl`
(in memory; may contain prompts and replies). It keeps only that session's model identifier, context
percentage and time, and persists nothing. The
user setting `cyclegauge.sessionHints` turns this read off.
In scope:

- any path by which the extension writes to Kiro-owned files or databases
- leaking raw account, session or content data into storage, diagnostics or the UI
- symlink/path escapes from the configured source root or from the fixed session root (`~/.kiro/sessions`), or unsafe permissions on its own storage
- any session-hints path that reads outside its bounds, keeps or shows more than the model identifier, percentage and time, or touches the filesystem while the setting is off
- code execution or script injection in the detail view (it is intentionally script-free)
- weaknesses in the release workflow or the packaged VSIX contents

Out of scope: vulnerabilities in Kiro itself, VS Code, Node.js or GitHub (report those upstream),
and anything that requires an already compromised local user account.

## Supported versions

Only the latest released version receives fixes.
