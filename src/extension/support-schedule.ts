// Vscode-free decision logic for the support prompt. Dates are UTC calendar days (`YYYY-MM-DD`); anything invalid counts as absent.
import { addDays, daysBetween, isDate } from './audit-schedule.ts';
export const MIN_DAYS_BEFORE_FIRST = 7;
export const SNOOZE_DAYS = 60;
export const SNOOZE_DAYS_AFTER_ACTION = 120;
/** The buttons of the prompt; a dismissed prompt is `undefined`. */
export type SupportChoice = 'Rate' | 'Star on GitHub' | 'Support ☕' | 'Not now' | "Don't ask again";
export interface SupportDueInput { today: string; firstSeen?: unknown; next?: unknown; never?: unknown; valueSeen?: unknown; auditSaved?: unknown; detailDays?: unknown; advisorUsed?: unknown; enabled: boolean; kiro: boolean }

/** Whether any value signal is due; all signals share the editor, setting and snooze gates. */
export function supportDue(i: SupportDueInput): boolean {
 if (!i.enabled || !i.kiro || i.never === true || !isDate(i.today) || !isDate(i.firstSeen)) return false;
 const age = daysBetween(i.firstSeen, i.today)!;
 if (age < 0 || (isDate(i.next) && i.today < i.next)) return false;
 return (i.auditSaved === true && age >= 1) || i.advisorUsed === true
  || (typeof i.detailDays === 'number' && Number.isInteger(i.detailDays) && i.detailDays === 3)
  || (age >= MIN_DAYS_BEFORE_FIRST && i.valueSeen === true);
}
/** The state change after a choice: a snooze date, or never. A dismissed or unknown answer is "Not now". */
export function afterChoice(choice: SupportChoice | string | undefined, today: string): { next?: string; never?: true } {
 if (choice === "Don't ask again") return { never: true };
 const acted = choice === 'Rate' || choice === 'Star on GitHub' || choice === 'Support ☕';
 return { next: addDays(today, acted ? SNOOZE_DAYS_AFTER_ACTION : SNOOZE_DAYS) };
}
