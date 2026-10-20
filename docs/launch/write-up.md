# Bobert 1.0: see your Kiro credits run out before they do

> **DRAFT, NOT PUBLISHED. Outreach is not approved.** All figures are invented. Confirm every feature against the final 1.0.0 build before use; items marked *(confirm)* may still move.

Kiro tells you after the fact. Bobert, an unofficial extension for Kiro IDE, tells you while you can still change something.

## What it does

**Warns before credits run out.** Bobert forecasts your pace against the cycle limit and speaks up once per cycle: "At this pace your credits run out on 24 Oct, 8 days before the reset." It also flags 80 % and 100 % of the reported limit. Thresholds and the warning itself are settings.

**Shows the overage in dollars.** If the forecast exceeds the limit: "about 400 credits over ≈ $16 at $0.04 per credit". It is labelled a modelled scenario from a reviewed, dated price catalog, not an invoice.

**Compares upgrading with paying overage.** Next to the overage figure, the Cost Advisor shows whether a larger plan would cost less and last until the reset ("switching to Pro+ costs $20 more and lasts until the reset"). Near the end of a cycle, after two similar cycles, it also tells you when a smaller plan would have covered you.

**Audits your workspace.** One command lists large files, archives, logs, build output and credentials-style names that Kiro may read because no ignore rule covers them, with a total ("about 240 MB may be readable"). It reports exposure, not saved credits. Accept prepares a `.kiroignore` change you review and save yourself.

**Reviews Hooks and Steering** *(confirm: not yet released)*. Always-included large Steering files, broad hook triggers and hooks that start agent work on every save are flagged, with narrower alternatives shown as a preview, never written for you.

**Session hints** *(confirm: pending review and native acceptance)*. A reminder when your latest session's context is about 70 % or 85 % full, and a note when the selected model is listed above Auto's credit rate.

**An interactive dashboard with a cycle recap.** Hover the usage chart, compare with the last cycle, see today's pace, export your own history as CSV, and share a "Your Kiro cycle" card that is rendered locally and carries no identifiers.

## Try it without touching your own data

The repository includes a synthetic demo: `pnpm demo:setup --open` opens an isolated Kiro window with 36 invented days of usage (`synthetic-*` data only). The GIF in this post was recorded there.

## Getting it

Install **Bobert** from Open VSX in Kiro IDE (macOS, Windows, Ubuntu). It is unofficial and not affiliated with Kiro or AWS. Everything runs locally; nothing is sent anywhere.

If it is useful, a rating or a star helps; support is optional (Ko-fi link in the extension).

*Feedback and bugs: GitHub issues. Use "Copy Diagnostics" for reports; it contains no values, paths or identifiers.*
