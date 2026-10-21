<img src="https://raw.githubusercontent.com/StefanSuess/Bobert/HEAD/assets/branding/bobert-icon-128.png" alt="Bobert icon" width="96" height="96">

# Bobert: Kiro Credit Tracker

**Bobert worries about your Kiro credits, so you don't have to.**

[![Open VSX version](https://img.shields.io/open-vsx/v/StefanSuess/bobert)](https://open-vsx.org/extension/StefanSuess/bobert)
![Development version 1.0.0 stable](https://img.shields.io/badge/development-1.0.0%20stable-blue)
[![CI + coverage ≥80%](https://img.shields.io/github/actions/workflow/status/StefanSuess/Bobert/ci.yml?branch=main&label=CI%20%2B%20coverage%20%E2%89%A580%25)](https://github.com/StefanSuess/Bobert/actions/workflows/ci.yml?query=branch%3Amain)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/StefanSuess/Bobert/blob/HEAD/LICENSE)

Bobert looks like he has seen a ghost. He has: your credit forecast.

Kiro tells you how many credits you have used. Bobert tells you what that means: whether they will last until the reset, what going over would cost, and where credits quietly leak away. It's all in your status bar, a few days before it matters rather than at the end of the cycle.

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Bobert/main/docs/media/demo.gif" alt="Animated story with invented data: Bobert, a robot with a gauge for a mouth, asks whether you ran out of Kiro credits before the reset; a notice warns that the credits run out on 27 Oct, 5 days before the reset (about $38 over the limit, modelled); the credit view shows what going over would cost; the workspace audit finds database dumps and archives Kiro may read; Bobert prepares the .kiroignore lines for review; the end card says Bobert is free, open source and runs locally." width="900">
</p>

## Why you'll want it

- **No nasty surprise at the end of the cycle.** Bobert forecasts the day your credits run out and warns you while there is still time to change course: at 80 % (adjustable), when a run-out before the reset becomes likely, and when the limit is reached.
- **See what it costs in dollars.** A projected overage gets a dollar figure, shown next to what the next larger plan would cost. When a smaller plan would have been enough, Bobert says so.
- **Stop feeding Kiro files it doesn't need.** One click finds secrets, database dumps, archives and build output that Kiro can read, and prepares the `.kiroignore` lines for you.
- **Find the hidden credit drains.** Bobert flags large Steering files that load into every request and hooks that start the agent on every save. For each one it prepares a fix for you to review and save.
- **Notice when a session gets expensive.** You get a nudge when a session's context is about 70 % or 85 % full, or when a pricier model is eating into a tight budget, with [tips for spending fewer credits](https://github.com/StefanSuess/Bobert/blob/HEAD/docs/credit-tips.md).
- **Your whole cycle at a glance.** The status bar shows your daily budget. The credit view adds a usage chart with forecast scenarios and a recap of the last cycle that you can share.

Free and open source, with no account, no sign-in and no telemetry. Everything stays on your machine, and Kiro's files are only ever read.

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Bobert/main/docs/media/credit-view.png" alt="Bobert credit view with invented data: Likely to exceed, 3810 of 5000 reported credits used, the credits run out on 27 Oct before the 1 Nov reset, about 958 credits over (about $38.33, modelled) next to the cost of the next larger plan, and the usage chart with forecast lines. No real account information is shown." width="900">
</p>

<details>
<summary><b>More screenshots:</b> budget notice, Cost Advisor, workspace audit, Steering and Hooks review</summary>

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Bobert/main/docs/media/budget-notice.png" alt="Bobert, a worried robot with a gauge for a mouth, next to a notice with invented data: at this pace the Kiro credits run out on 27 Oct, 5 days before the reset (about $38.33 over the limit, modelled), with Show details and Turn off budget notices buttons." width="700">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Bobert/main/docs/media/cost-advisor.png" alt="Cost Advisor in the credit view with invented data: likely plan Pro Max (unconfirmed), based on assumptions, an $80 modelled saving per billing cycle by moving from Pro Max to Pro, with the note that it is modelled from list prices, not a guarantee and not an invoice." width="760">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Bobert/main/docs/media/workspace-audit.png" alt="Workspace Audit view with invented files: 4 suggestions, Kiro may read about 190.7 MiB, a database dump and an archive to exclude, a large always-included Steering file and a hook that runs on every file change, beside the prepared .kiroignore lines that stay unsaved until you save them." width="900">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/StefanSuess/Bobert/main/docs/media/steering-hooks.png" alt="Steering and Hooks review with invented files: a large always-included Steering file and a hook that runs on every file change, with Kiro's change preview switching the Steering file from inclusion always to manual." width="900">
</p>

</details>

## Get started in a minute

1. Install **Bobert** from [Open VSX](https://open-vsx.org/extension/StefanSuess/bobert), or search for it in Kiro's Extensions view. You can also install the VSIX from the [latest release](https://github.com/StefanSuess/Bobert/releases) with **Extensions: Install from VSIX...**.
2. Click the credit item in the status bar, or run **Bobert: Show Credit Budget**.
3. Run **Bobert: Run Workspace Audit** to see what Kiro reads that it doesn't need.

The status bar shows "Collecting data" until Kiro has logged its first account usage. Your daily budget appears with the first update, and forecasts follow after a few days of history. Settings, the command-line tool and troubleshooting are in the [usage guide](https://github.com/StefanSuess/Bobert/blob/HEAD/docs/usage.md).

## Good to know

- **Honest numbers.** Figures are the last values Kiro logged, shown with an as-of time; they are not a live balance. Forecasts are labelled scenarios, unknown periods stay unknown and are never counted as zero, and dollar amounts are modelled from a dated list price (before tax), not an invoice.
- **Private by design.** Bobert has no network code. It keeps only allowlisted billing figures in its own storage. Prompts, code and credentials are never stored or shown. Session hints read your open folder's latest Kiro session in memory and keep only its model, context percentage and time; turn them off with `bobert.sessionHints`. Every fix is prepared as an unsaved edit that you review and save yourself. Details are in [privacy and storage](https://github.com/StefanSuess/Bobert/blob/HEAD/docs/privacy-and-storage.md).
- **Platforms.** Tested on macOS (Apple Silicon). Windows 11 and Ubuntu were smoke-tested with 0.7, and RHEL is best effort. Session hints are verified on macOS only. See [platform support](https://github.com/StefanSuess/Bobert/blob/HEAD/docs/platform-support.md).
- **Verifiable builds.** CI attests each release VSIX before it is published ([attestations](https://github.com/StefanSuess/Bobert/attestations), [release process](https://github.com/StefanSuess/Bobert/blob/HEAD/docs/release-process.md)).
- **Not using Kiro?** In other editors the workspace audit still works, though there is no credit view there.
- **Something wrong?** **Bobert: Report a Problem** creates a short diagnostic report of fixed codes and counts for you to review before you paste it anywhere. Please never post real Kiro data in issues.

## Like it?

[Leave a review on Open VSX](https://open-vsx.org/extension/StefanSuess/bobert) · [Star on GitHub](https://github.com/StefanSuess/Bobert) · [Support development ☕](https://ko-fi.com/stefansuess)

Bobert is free, with no paid features. Support is entirely optional.

[Documentation](https://github.com/StefanSuess/Bobert/blob/HEAD/docs/README.md) · [Changelog](https://github.com/StefanSuess/Bobert/blob/HEAD/CHANGELOG.md) · [Roadmap](https://github.com/StefanSuess/Bobert/blob/HEAD/ROADMAP.md) · [Contributing](https://github.com/StefanSuess/Bobert/blob/HEAD/CONTRIBUTING.md) · [Security](https://github.com/StefanSuess/Bobert/blob/HEAD/SECURITY.md) · [MIT License](https://github.com/StefanSuess/Bobert/blob/HEAD/LICENSE)

> Unofficial open-source project. Not affiliated with, endorsed by or sponsored by Amazon Web Services or Kiro. "Kiro" is a trademark of its owner. The code is MIT-licensed; the Bobert name, icon and mascot are not (see [name, icon and mascot](https://github.com/StefanSuess/Bobert/blob/HEAD/TRADEMARKS.md)).
