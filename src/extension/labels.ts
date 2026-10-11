/** Presentation-only labels shared by the budget view and the usage chart. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const names: Record<string,string> = {
 history_7_day:'Pooled 7-day history', history_14_day:'Pooled 14-day history', history_28_day:'Pooled 28-day history', history_84_day:'Pooled 84-day history',
 insufficient_exposure:'not enough observed time in the window', insufficient_observations:'too few account updates in the window',
 insufficient_observation_days:'account updates on too few days', dependent_window:'one long interval supplies most of the window',
 extended_zero_net_period_in_window:'an extended unchanged period is in the 28-day window', recent_usage_higher:'recent usage is higher than the earlier weeks',
 recent_usage_lower:'recent usage is lower than the earlier weeks', zero_net_change_not_proof_of_inactivity:'an unchanged counter is not proof of inactivity',
 runtime_unsupported:'This Kiro runtime lacks a feature EasyKiroGauge needs (SQLite or exact-number parsing)',
 storage_permissions_unsupported:'Private storage permissions are not supported on this platform yet, so no data is stored or shown',
 unobserved_periods_not_zero:'unobserved periods are not counted as zero', completed_break_excluded:'a completed break was excluded from the rate',
};
export const readable = (s: string) => names[s] ?? s.replaceAll('_',' ');
export const updated = (s: string) => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(s))+' UTC';
export const date = (s: string, year=false) => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',...(year ? {year:'numeric' as const} : {}),timeZone:'UTC'}).format(new Date(s));
