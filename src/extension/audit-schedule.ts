// Vscode-free decision logic for the workspace audit reminder. Dates are UTC calendar days as `YYYY-MM-DD` text, so DST and
// local time zones never matter. Anything that is not a valid date is treated as absent.
export type AuditDue = 'none' | 'first' | 'remind' | 'auto';
export const LATER_DAYS = 7;
export const DEFAULT_REMINDER_DAYS = 30;
export const MAX_REMINDER_DAYS = 365;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a real calendar date, otherwise undefined. */
function dayNumber(value: unknown): number | undefined {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
 const ms = Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
 return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY_MS : undefined;
}
export const isDate = (value: unknown): value is string => dayNumber(value) !== undefined;
/** The UTC calendar day of a moment. */
export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);
/** `date` plus `days` (may be negative); undefined when `date` is not valid. */
export function addDays(date: string, days: number): string | undefined {
 const n = dayNumber(date);
 return n === undefined || !Number.isInteger(days) ? undefined : new Date((n + days) * DAY_MS).toISOString().slice(0, 10);
}
/** Whole days from `from` to `to` (negative when `to` is earlier); undefined when either is invalid. */
export function daysBetween(from: string, to: string): number | undefined {
 const a = dayNumber(from), b = dayNumber(to);
 return a === undefined || b === undefined ? undefined : b - a;
}

export interface AuditDueInput { today: string; last?: unknown; snoozeUntil?: unknown; neverRemind?: unknown; reminderDays: number; automatic: boolean }
/**
 * What the once-per-window check should do. 'first': never audited (prompt once); 'remind': audited reminderDays or more ago;
 * 'auto': the same, with automatic re-runs enabled; 'none': nothing. A future `last` (clock change) is not due.
 */
export function auditDue(i: AuditDueInput): AuditDue {
 if (i.neverRemind === true || !isDate(i.today) || !Number.isFinite(i.reminderDays) || i.reminderDays <= 0) return 'none';
 if (isDate(i.snoozeUntil) && i.today < i.snoozeUntil) return 'none';
 if (!isDate(i.last)) return 'first';
 return daysBetween(i.last, i.today)! >= i.reminderDays ? (i.automatic ? 'auto' : 'remind') : 'none';
}
