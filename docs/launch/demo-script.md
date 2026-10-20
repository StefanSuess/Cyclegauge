# Demo shot list (screenshots and GIF)

> **DRAFT, NOT PUBLISHED. Outreach is not approved.** Records only the synthetic demo from [synthetic-demo.md](../synthetic-demo.md). Never record a real profile, real workspace, real path, real account name or the normal Kiro window.

**Status 2026-10-20:** S1–S5 and the GIF were captured from candidate `c7f259d` with this setup and embedded in the README; `dashboard.jpg` and `cost-advisor.jpg` were removed. S5 uses the default pace (at the high pace the Cost Advisor prices no strategy). The GIF has no burned-in captions (the local ffmpeg lacks `drawtext`); its alt text describes it. The GIF was later cut from 30.5 s to about 14 s (waiting time removed, same flow). Re-capture only when the UI changes.

## Setup (not filmed)

1. `pnpm demo:setup --open --vsix <candidate.vsix> --pace high` and install nothing else. Work only in the window titled "SYNTHETIC DEMO - not real usage". Demo data: limit 5000, 36 invented days, about 200 credits a day, so the warning, the overage and the right-sizing hint can appear. For the calm "On track" shot, run the setup again without `--pace high`.
2. In that window, open a throwaway folder `synthetic-workspace/` created from scratch (never a real project), trust it, and add invented files only. On macOS or Linux:

   ```bash
   mkdir -p synthetic-workspace/synthetic-build synthetic-workspace/.kiro/steering synthetic-workspace/.kiro/hooks && cd synthetic-workspace
   head -c 120000000 /dev/zero > synthetic-dump.sql && head -c 80000000 /dev/zero > synthetic-archive.zip
   head -c 2000000 /dev/zero > synthetic-build/synthetic-bundle.js && printf 'synthetic log line\n' > synthetic-notes.log
   printf -- '---\ninclusion: always\nname: synthetic-guide\n---\n%s\n' "$(head -c 9000 /dev/zero | tr '\0' x)" > .kiro/steering/synthetic-guide.md
   printf '{\n  "version": "v1",\n  "hooks": [\n    { "name": "synthetic-on-save", "trigger": "PostFileSave", "action": { "type": "agent", "prompt": "synthetic prompt" } }\n  ]\n}\n' > .kiro/hooks/synthetic-on-save.json
   ```

3. One theme for every shot (Kiro's default dark theme), window 1280 × 800, editor zoom 0. Close other panels and notifications. Hide the window title bar, or check that it shows only the synthetic folder name.

**Before you commit or publish anything:** check every frame for paths, usernames, account names, window titles and real folder names. If one appears, take the shot again; don't blur it.

## Still screenshots (README and Open VSX)

The README loads its images from GitHub, so they are not packaged into the VSIX. Save PNGs, at most 1600 px wide and 400 KB each (or JPEG at quality 85). Fill in the `{…}` placeholders with the figures that appear in the frame.

| # | File | Show | Alt text |
| --- | --- | --- | --- |
| S1 | `docs/media/credit-view.png` | **Bobert: Show Credit Budget**, high pace: the status headline "Likely to exceed • runs out {date}", credits used and left, next reset, the line "At this pace by the reset: about {n} credits over (≈ ${x}, modelled)", and the chart below | Bobert credit view with invented data: {used} of 5000 reported credits used, likely to exceed with a run-out date of {date} before the {reset} reset, a modelled overage of about {n} credits (≈ ${x}) and the usage chart with forecast lines. No real account information is shown. |
| S2 | `docs/media/budget-notice.png` | The status bar item with a warning background, and the forecast notice "At this pace your Kiro credits run out on {date}, {n} days before the reset (about ${x} over the limit, modelled)." with **Show details** | Kiro status bar showing "Kiro credits: Likely to exceed • runs out {date}" and a Bobert notice that, at the current pace, the invented credits run out {n} days before the reset, with a modelled overage in dollars. |
| S3 | `docs/media/workspace-audit.png` | The **Workspace Audit** view with the **Exclude from Kiro** group open (the dump, the archive, the build output, the size total), next to the change preview **Exclude from Kiro…** opened for `.kiroignore` | Workspace Audit view listing invented files Kiro may read but probably doesn't need, about {size} in total, beside the editor's change preview of the suggested .kiroignore lines, which stay unsaved until you save them. |
| S4 | `docs/media/steering-hooks.png` | The Steering and Hooks groups (**Load only when needed**, **Run only manually**) with the change preview of **Load only when needed…** for `synthetic-guide.md` | Steering and Hooks review flagging an invented always-included Steering file and a hook that starts the agent on every save, with the editor's change preview of loading the file only when needed. |
| S5 | `docs/media/cost-advisor.png` (replaces `cost-advisor.jpg`) | The Cost Advisor section of the credit view with its badge, the next-cycle estimate and the open **Change your plan answers** form | Cost Advisor in the credit view with invented data: a modelled next-cycle estimate in dollars before tax, labelled as based on assumptions, and the form for confirming plan and billing details. |

`docs/media/dashboard.jpg` and `cost-advisor.jpg` show the old UI. Delete them in the same change that adds S1 and S5.

## GIF (`docs/media/demo.gif`)

A 15–25 s loop, under 5 MB and 1280 px wide, in one theme, with captions burned in and no sound. Cut any shot whose feature isn't in the final 1.0.0 build.

| # | Seconds | Show | Caption |
| --- | --- | --- | --- |
| 1 | 0–3 | The status bar item turns to the warning colour, and the forecast notice appears | Warns before credits run out |
| 2 | 3–7 | **Show details** opens the credit view: the overage "about {n} credits over (≈ ${x}, modelled)" and "For comparison: {next plan} costs …" | Overage in dollars, next to the larger plan |
| 3 | 7–10 | The Cost Advisor estimate and its badge | Plan estimate, modelled before tax |
| 4 | 10–14 | **Run Workspace Audit**, the size total, then **Exclude from Kiro…** opening the change preview | Find what Kiro may read |
| 5 | 14–18 | The Steering and Hooks groups and **Load only when needed…** | Review Hooks and Steering |
| 6 | 18–22 | A hover over the chart, then **About these numbers** expanding | Every figure explained once |

The final frame shows the extension name and "Free, unofficial, for Kiro IDE". Session hints and the cycle recap aren't filmed: the invented demo has no Kiro session, and the recap needs a completed earlier cycle.

## README embedding (after capture)

- Replace the `dashboard.jpg` block with S1. Put the GIF where the `TODO(maintainer)` comment is and remove the comment.
- In the `<details>` block, replace `cost-advisor.jpg` with S5. Add a second `<details>` block, "Workspace audit and Steering and Hooks review", holding S3 and S4. S2 can go under the first bullet, or be left out if the GIF covers it.
- Use the alt texts above with the real figures filled in. Keep the `raw.githubusercontent.com/StefanSuess/Bobert/main/...` URLs, which only resolve after #129 is merged.
