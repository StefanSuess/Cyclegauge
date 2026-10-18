// The closed list of diagnostic codes of the session hints. Diagnostics, logs and results carry only these codes and counts.
export const HINT_CODES = ['ok', 'disabled', 'unsupported_platform', 'no_root', 'listing_capped', 'no_match', 'unsafe', 'changed', 'aborted', 'unsupported_schema', 'invalid_shape', 'no_candidate', 'out_of_range', 'stale', 'error'] as const;
export type HintCode = (typeof HINT_CODES)[number];
