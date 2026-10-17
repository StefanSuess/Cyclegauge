// Vscode-free decision logic for the support prompt. Dates are UTC calendar days (`YYYY-MM-DD`); anything invalid counts as absent.
import { addDays, daysBetween, isDate } from './audit-schedule.ts';
export const MIN_DAYS_BEFORE_FIRST = 7;
export const SNOOZE_DAYS = 60;
export const SNOOZE_DAYS_AFTER_ACTION = 120;
/** The buttons of the prompt; a dismissed prompt is `undefined`. */
export type SupportChoice = 'Rate' | 'Star on GitHub' | 'Support ☕' | 'Not now' | "Don't ask again";
export interface SupportDueInput { today: string; firstSeen?: unknown; next?: unknown; never?: unknown; valueSeen?: unknown; enabled: boolean; kiro: boolean }

/** Whether the once-per-window prompt may be shown: enabled, in Kiro, not silenced, value seen, 7 days after first use, past the snooze. */
export function supportDue(i: SupportDueInput): boolean {
 if (!i.enabled || !i.kiro || i.never === true || i.valueSeen !== true || !isDate(i.today) || !isDate(i.firstSeen)) return false;
 if (daysBetween(i.firstSeen, i.today)! < MIN_DAYS_BEFORE_FIRST) return false; // also false for a first date in the future (clock change)
 return !(isDate(i.next) && i.today < i.next);
}
/** The state change after a choice: a snooze date, or never. A dismissed or unknown answer is "Not now". */
export function afterChoice(choice: SupportChoice | string | undefined, today: string): { next?: string; never?: true } {
 if (choice === "Don't ask again") return { never: true };
 const acted = choice === 'Rate' || choice === 'Star on GitHub' || choice === 'Support ☕';
 return { next: addDays(today, acted ? SNOOZE_DAYS_AFTER_ACTION : SNOOZE_DAYS) };
}
