# SC5 — persisted Cost Advisor inputs: specification (DRAFT for review, nothing implemented)

Status: **draft**. Persistence is approved in principle (AGENTS.md, 2026-10-11) but is **not implemented**, and **SC5 is
not complete**. Implementation starts only after this specification and its security review are approved.
Depends on: Phase A (PR #3). Does not change Store, projection, billing or forecast semantics. Windows stays fail-closed.

## 1. What is persisted, and what never is

| Persisted (only after an explicit "remember on this device" answer) | Never persisted |
|---|---|
| Explicitly chosen plan | Plan hints and any inferred value |
| Billing system (personal / Enterprise) | Observed usage, limits, resets (these are in the Store) |
| Add-on state (none / some) and remaining add-on credits with `confirmedAt` | Raw account identifiers, user ids, request ids |
| Phase C only: expiry dates, original purchase amount and currency, EUR rate basis, Enterprise overage flag and headroom | Anything read from Kiro files or credentials; prompts, paths, log lines |

Absence of a field means **unknown**. Unknown is never stored as zero, never defaulted on load, and never silently
carried from another account.

## 2. File, location, permissions

- One file, `cost-inputs.json`, in the existing EasyKiroGauge store directory, created through the existing
  `StorageGuard` (directory 0700, file 0600, owner and link-count checks, no symlinks).
- Not in `usage.sqlite`; not inside Kiro directories or the repository; excluded from VSIX packaging.
- Atomic write: temporary file in the same directory (0600, `O_EXCL`), flush, rename over the target, remove the
  temporary file on any failure. No lock files and no other sidecars.
- **Windows:** disabled while Windows storage is fail-closed (SC1 open); inputs stay session-only.

## 3. Schema and parsing

- `{schema:1, entries:[{binding, rev, updatedAt, plan?, billing?, addOns?, addOnCredits?, confirmedAt?}], mac}`.
- Strict allowlisted parse: unknown keys, wrong types, non-canonical decimals, more than 8 entries, an entry over
  1 KiB or a file over 16 KiB reject the **whole file** as unavailable (fixed code `cost_inputs_unavailable`).
- A rejected file is never auto-repaired, truncated or deleted. New saves are blocked until the user runs
  "Clear saved Cost Advisor answers", which replaces it.
- Decimal values use the existing `validAmount`/`decimal` helpers (exact text, no floats).

## 4. Account binding and integrity

- `binding = HMAC-SHA256(device.key, "ekg-cost-inputs.v1" || opaquePartition)`, truncated to 128 bits, hex.
  The opaque partition is the existing device-local derived key; it is never written, shown or put in diagnostics.
- File integrity: `mac = HMAC-SHA256(device.key, canonical entries)`. A file copied to another device, or edited by
  hand, fails the MAC and is treated as unavailable. This is tamper evidence for accidents, not a defence against a
  process running as the same user (out of scope; stated in the threat model).
- Entries apply only when the controller's account state is `single` **and** the binding matches. `ambiguous` or
  `unavailable` state: nothing is applied and nothing is overwritten. Entries of other bindings are retained
  (bounded, least-recently-updated eviction) and are never displayed.

## 5. Concurrent windows

- Optimistic single-writer: read, merge, write, with a file-identity re-check (device, inode, size, mtime — the same
  identity rules as source files) immediately before rename; up to three retries, then a fixed failure code and the
  in-memory answer stays session-only.
- Per-binding last-writer-wins by `rev` (monotonic per entry) then `updatedAt`. A window that loses sees the newer
  value on its next refresh (watcher or the 60 s poll). Writers never modify entries of other bindings except for
  eviction.
- A window never writes during an open native editor that began under another account context (existing ticket rule).

## 6. Staleness and confirmation

- Remaining add-on credits carry `confirmedAt`. They become **needs confirmation** (treated as unknown by the engine,
  shown as such) when a billing reset has passed since `confirmedAt`, when the stored expiry (Phase C) has passed, or
  after 31 days. Re-confirmation is an explicit answer; there is no silent carry-over.
- A confirmed plan persists. If the observed limit later differs from the plan's nominal credits, the card shows a
  notice; the plan is not invalidated by that alone (purchases, expiry and billing changes move a combined limit).

## 7. User controls and consent

- After answering, an explicit question: "Remember these answers on this device?" Default **No** (session only).
- Commands: "Cost Advisor" (answer), "Clear Cost Inputs and Advisor Answers" (session), and a new "Clear saved Cost
  Advisor answers" (deletes this account's entry; with confirmation, "all entries" as a second option).
- The card states whether answers are session-only or saved, and their `confirmedAt` date.

## 8. Privacy and diagnostics

- No network, telemetry, sync, export or Kiro authentication access. Offline catalog only.
- Diagnostics may report only fixed codes (`cost_inputs_unavailable`, `cost_inputs_write_failed`, `cost_inputs_stale`)
  and a count of entries; never values, bindings, paths or MAC material. Errors never embed file content.
- Tests use invented `synthetic-*` values only; no real data in fixtures or CI.

## 9. Threat model (summary)

| Threat | Mitigation |
|---|---|
| Another local user reads or writes the file | 0700/0600, owner check, StorageGuard |
| Symlink or path swap | Existing no-symlink checks and fail-closed guard |
| Hand-edited or copied file | Strict parse, MAC, device-bound key |
| Personal data crossing accounts | Binding, `single` state only, ticketed editors |
| Concurrent windows corrupt the file | Atomic rename, identity check, retries, session-only fallback |
| Stale balance presented as current | `confirmedAt` rules, treated as unknown |
| Same-user malware | Out of scope; stated, not mitigated |

## 10. Test plan (all synthetic)

Schema fuzz and caps; atomicity under injected failure; permission and ownership checks; two-window write race and
rev ordering; binding mismatch, ambiguous and unavailable account states; MAC tamper and cross-device copy; stale and
expiry rules; unknown never becomes zero on load; Windows disabled; no-network import allowlist; no value in
diagnostics; downgrade safety (older versions ignore the file); Store byte-identical before and after.

## 11. Gate and acceptance

SC5 can close only when: this spec is approved; the implementation passes the test plan on macOS, Ubuntu and Windows
(disabled behaviour); an independent security review finds no blocker; native macOS acceptance on the isolated
instance passes; the owner approves in writing. Phase A remains correct without any of this.

## 12. Decisions needed from the owner

1. Default for "Remember on this device": No (proposed) or Yes?
2. Retention of other accounts' entries: retain up to 8 (proposed) or purge on account change?
3. Staleness window for add-on balances: 31 days or reset-only?
4. Is "Windows disabled" acceptable until SC1 closes?
