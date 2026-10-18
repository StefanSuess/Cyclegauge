// Dated model table for the model hint. Source: Kiro's public models overview, available-models and settings pages, "Cost" relative to Auto (1.0x baseline),
// as of 2026-10-18 (page updated 2026-10-17; values as relayed by a page summariser, not independently re-verified; see docs/wp10-13-evidence.md and
// docs/wp11-13-data-proof.md). Review on every Kiro model release, together with the pricing catalog.
// basis 'observed': the identifier was seen in a local session.json (IDE, macOS, 2026-10-18). 'documented': the identifier string appears in Kiro's settings
// documentation. 'pattern': derived by the rule "published name, lowercased, spaces to hyphens, dot in the version" (a guess; two vendors fit it). Maintainer
// decision D2 (2026-10-18): pattern-derived rows may show a hint. An unlisted identifier, and Auto, never produce a hint; only multipliers above 1.0 do.
import { MODEL_ID } from './parse.ts';
export const TABLE_DATE = '2026-10-18';
export const TABLE_SOURCE = 'Kiro model table';
export const STALE_AFTER_DAYS = 90;
export interface ModelRow {
 id: string; name: string; multiplier: string; basis: 'observed' | 'documented' | 'pattern';
 // 'tiered': the listed rate is the base factor; above 272K tokens Kiro bills a higher one (hint says "from about"). 'silent': never hints, see the comment on the row.
 flag?: 'tiered' | 'silent';
}
export const MODELS: readonly ModelRow[] = [
 // observed in local session metadata
 { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', multiplier: '1.3', basis: 'observed' },
 { id: 'minimax-m2.5', name: 'MiniMax M2.5', multiplier: '0.25', basis: 'observed' },
 { id: 'minimax-m2.1', name: 'MiniMax M2.1', multiplier: '0.15', basis: 'observed' },
 // identifier string documented by Kiro
 { id: 'claude-opus-4.8', name: 'Claude Opus 4.8', multiplier: '2.2', basis: 'documented' },
 { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', multiplier: '1.3', basis: 'documented' },
 // pattern-derived identifiers
 { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', multiplier: '4.4', basis: 'pattern', flag: 'tiered' }, // 8.8x above 272K tokens; experimental
 { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', multiplier: '2.2', basis: 'pattern', flag: 'tiered' }, // 4.4x above 272K tokens; experimental
 { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', multiplier: '0.6', basis: 'pattern', flag: 'tiered' }, // 1.2x above 272K tokens, i.e. above 1.0 there; the base factor is below 1.0, so silent
 { id: 'claude-fable-5.1', name: 'Claude Fable 5.1', multiplier: '6', basis: 'pattern' }, // limited preview for Enterprise, US East only
 { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', multiplier: '2.0', basis: 'pattern' }, // experimental
 { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', multiplier: '1.3', basis: 'pattern' },
 { id: 'claude-opus-5', name: 'Claude Opus 5', multiplier: '2.2', basis: 'pattern' },
 { id: 'claude-opus-4.7', name: 'Claude Opus 4.7', multiplier: '2.2', basis: 'pattern' },
 { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', multiplier: '2.2', basis: 'pattern' },
 { id: 'claude-opus-4.5', name: 'Claude Opus 4.5', multiplier: '2.2', basis: 'pattern' },
 { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', multiplier: '1.3', basis: 'pattern' },
 // end of life since 2026-10-14: Kiro does not switch a removed selected model, so a session may still carry the id, but the model can no longer be
 // chosen and a "costs more than Auto" hint would not help; kept in the table so the id is known, silent on purpose.
 { id: 'claude-sonnet-4.0', name: 'Claude Sonnet 4.0', multiplier: '1.3', basis: 'pattern', flag: 'silent' },
 { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', multiplier: '0.4', basis: 'pattern' },
 { id: 'kimi-k3', name: 'Kimi K3', multiplier: '2.4', basis: 'pattern' }, // US only, experimental
 { id: 'deepseek-3.2', name: 'DeepSeek 3.2', multiplier: '0.25', basis: 'pattern' }, // experimental
 { id: 'glm-5', name: 'GLM-5', multiplier: '0.5', basis: 'pattern' },
 { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', multiplier: '0.05', basis: 'pattern' }, // experimental
];
export interface ModelHint { name: string; multiplier: string; from: boolean; stale: boolean; date: string }
/** "1.3" -> "1.3", "2.0" -> "2", rounded to one decimal; undefined unless a finite positive decimal. */
export function multiplierText(decimal: string): string | undefined {
 const n = Number(decimal);
 if (!/^\d+(\.\d+)?$/.test(decimal) || !Number.isFinite(n) || n <= 0) return undefined;
 return String(Math.round(n * 10) / 10);
}
/** A hint only for a listed identifier whose table multiplier is above 1.0; silent for Auto, unknown ids, silent rows and everything at or below 1.0. */
export function modelHint(id: string | null, now: number, table: readonly ModelRow[] = MODELS, date = TABLE_DATE): ModelHint | undefined {
 if (id === null || !MODEL_ID.test(id)) return undefined;
 const row = table.find(r => r.id === id);
 if (!row || row.flag === 'silent' || !MODEL_ID.test(row.id) || !(Number(row.multiplier) > 1)) return undefined;
 const shown = multiplierText(row.multiplier), age = now - Date.parse(`${date}T00:00:00Z`);
 if (shown === undefined) return undefined;
 return { name: row.name, multiplier: shown, from: row.flag === 'tiered', stale: !Number.isFinite(age) || age > STALE_AFTER_DAYS * 86_400_000, date };
}
