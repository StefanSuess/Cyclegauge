// Technical identity of the extension. No vscode import: unit-testable and shared by the manifest test.
export const ID_PREFIX = 'cyclegauge';
export const PANEL_VIEW_TYPE = `${ID_PREFIX}.usage`;
export const SETTING_KEYS = ['sourceRoot', 'storageRoot', 'sourceTimezone'] as const;
// Non-string settings (application scope: user settings only): the audit reminder and its opt-in automatic re-run.
export const AUDIT_SETTING_KEYS = ['auditReminderDays', 'auditAutomatically'] as const;
// The community prompts' user setting (application scope, boolean, default on).
export const SUPPORT_SETTING_KEYS = ['supportPrompts'] as const;
// The budget warning's user settings (application scope): an on/off switch and the usage share (percent of the reported limit) that triggers the early notice.
export const BUDGET_SETTING_KEYS = ['budgetWarnings', 'budgetWarningPercent'] as const;
export const BUDGET_PERCENT_DEFAULT = 80;
// Fixed constants: the only external addresses the extension ever opens, and only when the user clicks. No data, no query strings.
export const LINKS = { rate: 'https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', star: 'https://github.com/StefanSuess/Cyclegauge', support: 'https://ko-fi.com/stefansuess', kiro: 'https://kiro.dev' } as const;
export const SHARE_TEXT = "Cyclegauge shows your Kiro credit usage, forecasts when you'll run out and finds files Kiro may read but probably doesn't need. Free and open source: https://open-vsx.org/extension/StefanSuess/cyclegauge";
export const NOT_KIRO_TEXT = 'Cyclegauge is built for Kiro IDE. This editor has no Kiro credit logs, so the credit view stays empty. The workspace audit still works.';
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
export type AuditAutomatic = 'off' | 'onOpen' | 'onOpenAndChanges';
/** Only an explicit mode enables automatic audits; the earlier boolean true means onOpen, anything else is off. */
export function readAuditAutomatically(get: Getter): AuditAutomatic {
 const value = get(ID_PREFIX, 'auditAutomatically');
 return value === true ? 'onOpen' : value === 'onOpen' || value === 'onOpenAndChanges' ? value : 'off';
}
/** Prompts are on unless the user explicitly sets false. */
export function readSupportPrompts(get: Getter): boolean {
 return get(ID_PREFIX, 'supportPrompts') !== false;
}
/** Budget warnings are on unless the user explicitly sets false. */
export function readBudgetWarnings(get: Getter): boolean {
 return get(ID_PREFIX, 'budgetWarnings') !== false;
}
/** Whole percent of the reported limit, 0..100; anything that is not a finite number uses the default. 0 turns the percent notice off. */
export function readBudgetWarningPercent(get: Getter): number {
 const value = get(ID_PREFIX, 'budgetWarningPercent');
 return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.floor(value))) : BUDGET_PERCENT_DEFAULT;
}
/** Kiro IDE by product name or URL scheme; any other editor (or unreadable metadata) is not Kiro. */
export function isKiroEditor(appName: unknown, uriScheme: unknown): boolean {
 return (typeof appName === 'string' && /kiro/i.test(appName)) || uriScheme === 'kiro';
}
