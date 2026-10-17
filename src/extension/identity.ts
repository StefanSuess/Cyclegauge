// Technical identity of the extension. No vscode import: unit-testable and shared by the manifest test.
export const ID_PREFIX = 'cyclegauge';
export const PANEL_VIEW_TYPE = `${ID_PREFIX}.usage`;
export const AUDIT_VIEW_TYPE = `${ID_PREFIX}.audit`;
export const SETTING_KEYS = ['sourceRoot', 'storageRoot', 'sourceTimezone'] as const;
export const commandId = (suffix: string): string => `${ID_PREFIX}.${suffix}`;

type Disposable = { dispose(): unknown };
export function registerCommand(register: (id: string, fn: () => unknown) => Disposable, suffix: string, fn: () => unknown): Disposable {
 return register(commandId(suffix), fn);
}

export function readSetting(get: (prefix: string, key: string) => string | undefined, key: (typeof SETTING_KEYS)[number]): string {
 return get(ID_PREFIX, key) || '';
}
