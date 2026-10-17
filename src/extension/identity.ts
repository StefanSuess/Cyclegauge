// Technical identity of the extension. No vscode import: unit-testable and shared by the manifest test.
export const ID_PREFIX = 'cyclegauge';
export const PANEL_VIEW_TYPE = `${ID_PREFIX}.usage`;
export const SETTING_KEYS = ['sourceRoot', 'storageRoot', 'sourceTimezone'] as const;
// Non-string settings (application scope: user settings only): the audit reminder and its opt-in automatic re-run.
export const AUDIT_SETTING_KEYS = ['auditReminderDays', 'auditAutomatically'] as const;
export const REMINDER_DAYS_DEFAULT = 30;
export const REMINDER_DAYS_MAX = 365;
export const commandId = (suffix: string): string => `${ID_PREFIX}.${suffix}`;

type Disposable = { dispose(): unknown };
export function registerCommand(register: (id: string, fn: () => unknown) => Disposable, suffix: string, fn: () => unknown): Disposable {
 return register(commandId(suffix), fn);
}

export function readSetting(get: (prefix: string, key: string) => string | undefined, key: (typeof SETTING_KEYS)[number]): string {
 return get(ID_PREFIX, key) || '';
}

type Getter = (prefix: string, key: string) => unknown;
/** Whole days between audit reminders, 0..365; anything that is not a finite number uses the default. 0 turns reminders off. */
export function readReminderDays(get: Getter): number {
 const value = get(ID_PREFIX, 'auditReminderDays');
 return typeof value === 'number' && Number.isFinite(value) ? Math.min(REMINDER_DAYS_MAX, Math.max(0, Math.floor(value))) : REMINDER_DAYS_DEFAULT;
}
/** Only an explicit true enables automatic audits. */
export function readAuditAutomatically(get: Getter): boolean {
 return get(ID_PREFIX, 'auditAutomatically') === true;
}
