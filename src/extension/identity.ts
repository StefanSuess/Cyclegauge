// Technical identity of the extension. No vscode import: unit-testable and shared by the manifest test.
export const ID_PREFIX = 'cyclegauge';
export const LEGACY_ID_PREFIX = 'easykirogauge';
// Extension ID of the pre-rename build (publisher.name); used only to detect a side-by-side install.
export const LEGACY_EXTENSION_ID = 'easykirogauge.easykirogauge';
export const PANEL_VIEW_TYPE = `${ID_PREFIX}.usage`;
// Commands that shipped under the legacy prefix in v0.5.1. Only these get a temporary alias.
export const LEGACY_COMMAND_SUFFIXES = ['showUsage', 'configureCostOptimizer', 'editCostScenario', 'clearCostInputs'] as const;
export const SETTING_KEYS = ['sourceRoot', 'storageRoot', 'sourceTimezone'] as const;
export const commandId = (suffix: string): string => `${ID_PREFIX}.${suffix}`;
export const legacyCommandId = (suffix: string): string => `${LEGACY_ID_PREFIX}.${suffix}`;

type Disposable = { dispose(): unknown };
// Registers the primary command and, when allowed, its legacy alias. A failing alias (for example an ID already
// taken by an installed legacy extension) never affects the primary command.
export function registerCommand(register: (id: string, fn: () => unknown) => Disposable, suffix: string, fn: () => unknown, aliases = true): Disposable[] {
 const out = [register(commandId(suffix), fn)];
 if (aliases && (LEGACY_COMMAND_SUFFIXES as readonly string[]).includes(suffix)) {
  try { out.push(register(legacyCommandId(suffix), fn)); } catch { /* alias unavailable; primary command still works */ }
 }
 return out;
}

// New key wins when set; otherwise the legacy key (deprecated) applies; empty means platform default.
export function readSetting(get: (prefix: string, key: string) => string | undefined, key: (typeof SETTING_KEYS)[number]): string {
 return get(ID_PREFIX, key) || get(LEGACY_ID_PREFIX, key) || '';
}

export const LEGACY_BLOCKED_MESSAGE = 'Cyclegauge is paused: the legacy EasyKiroGauge extension is still enabled and uses the same private usage storage. Disable or uninstall EasyKiroGauge, then reload the window. Cyclegauge has not read or written any usage data.';
// Storage gate: `start` (collector, store, watchers) runs only when no legacy installation is detected.
export async function startUnlessLegacy<T>(legacyInstalled: boolean, start: () => Promise<T>): Promise<{ blocked: true } | { blocked: false; value: T }> {
 if (legacyInstalled) return { blocked: true };
 return { blocked: false, value: await start() };
}
