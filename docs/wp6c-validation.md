# WP6c inline Cost Advisor validation

Phase 6c adds a session-only inline form to the credit view. Native pickers remain available from the status bar and command link. Both paths use the same pure validation for plan, billing, purchased add-ons, decimal credits, Enterprise Free, and clearing answers.

The form sends only exact, bounded `advisorSubmit` fields. The host refreshes the observed account context, compares the edit ticket with the current epoch, then commits and advances the epoch. Native picker start and cancellation also advance the epoch. An account change or ambiguous account refuses a late form submit. A dirty form keeps the user's draft across model updates and asks for review when the epoch changes. The form uses a fieldset, legend, field errors and a live status region; no answer is persisted or sent to a network service.

Verification in the implementation worktree: `pnpm typecheck`, `pnpm test`, `pnpm test:release`, and `git diff --check`. Focused unit tests cover shared validation, replay and account tickets, constrained message fields, panel in-flight/cooldown responses, static form parsing, and draft/model ordering. Native Kiro acceptance remains pending for keyboard and screen-reader behavior, CSP/Trusted Types, and scripted versus native command interaction on the target platforms.

Independent security review found and resolved submit/model timing issues: edits made during a pending review, a coalesced model that skips an epoch, and a late successful reply after a timed-out submit and busy retry. Browser event regressions cover these sequences. Busy replies report an operational wait without marking answer fields invalid. Targeted independent re-review found no remaining blocker.

A host refresh that never settles remains single flight. Later attempts receive an explicit busy response, retaining the draft rather than starting parallel reads. Reopening the panel or restarting the extension may be needed for a permanently stuck operation; unsaved drafts must then be re-entered.

Final local checks: typecheck passed; 493 unit tests passed with 11 Windows-only skips; 95 release tests passed; diff check passed. CI and native Kiro acceptance are separate evidence layers.
