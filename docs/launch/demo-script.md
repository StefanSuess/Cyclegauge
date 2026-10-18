# Demo GIF shot list

> **DRAFT, NOT PUBLISHED. Outreach is not approved.** Records only the synthetic demo from [synthetic-demo.md](../synthetic-demo.md). Never record a real profile, real workspace, real path, real account name or the normal Kiro window.

**Setup (not filmed):** `pnpm demo:setup --open`, install the printed VSIX in the window titled "SYNTHETIC DEMO - not real usage". Demo data: limit 5000, 36 invented days, about 20 credits/day. Because that default pace never exceeds the limit, the warning, overage and right-sizing shots need the higher invented pace of `pnpm demo:setup --open --pace high` (about 200 credits/day), with `synthetic-*` names only. For the audit shots use a throwaway folder `synthetic-workspace/` with invented files (`synthetic-dump.sql` 120 MB, `synthetic-archive.zip` 80 MB, `synthetic-build/`, `synthetic-notes.log`), created from scratch. Hook and Steering shots need the released review and invented `.kiro/steering/synthetic-guide.md` and `.kiro/hooks/synthetic-on-save` files.

**Format:** 15–25 s loop, under 5 MB, 1280 px wide, one consistent theme, captions burned in, no sound. Check every frame for paths, usernames and window titles before publishing.

| # | Seconds | Show | Caption |
| --- | --- | --- | --- |
| 1 | 0–3 | Status bar item turning to a warning colour; notice "At this pace your credits run out on 24 Oct, 8 days before the reset" | Warns before credits run out |
| 2 | 3–7 | Detail view: overage "about 400 credits over ≈ $16" and the Cost Advisor upgrade comparison | Overage in dollars, with an upgrade comparison |
| 3 | 7–10 | Right-sizing hint: smaller plan would cost about $20 a month less | Right-size your plan |
| 4 | 10–14 | Audit view with "about 240 MB Kiro may read" and Exclude from Kiro preparing an unsaved `.kiroignore` | Find what Kiro may read |
| 5 | 14–17 | Hook and Steering review list *(only if it ships in 1.0)* | Review Hooks and Steering |
| 6 | 17–19 | Session hint notice "about 70 % full" *(only if confirmed)* | Session hints |
| 7 | 19–24 | Dashboard hover, last-cycle comparison, then the recap card | Dashboard and cycle recap |

Cut any shot whose feature is not in the final 1.0.0 build. Final frame: extension name and "Free, unofficial, for Kiro IDE".
