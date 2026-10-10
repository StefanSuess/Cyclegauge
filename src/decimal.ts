// Bounded arbitrary decimal arithmetic; never convert billing values to Number.
function normalize(text: string, bound: number): string {
 const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
 if (!m || text.length > bound) throw new Error('INVALID_DECIMAL');
 const exponent = Number(m[3] ?? 0);
 if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) throw new Error('INVALID_DECIMAL');
 let digits = m[1] + (m[2] ?? '');
 let scale = (m[2]?.length ?? 0) - exponent;
 if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
 digits = digits.padStart(scale + 1, '0');
 const result = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
 const normalized = result.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
 if (normalized.length > bound) throw new Error('INVALID_DECIMAL');
 return normalized;
}
export function decimal(text: string): string { return normalize(text, 256); }
function parts(s: string): [bigint, number] {
 const negative = s.startsWith('-'); const d = normalize(negative ? s.slice(1) : s, 1024);
 return [BigInt(d.replace('.', '')) * (negative ? -1n : 1n), d.split('.')[1]?.length ?? 0];
}
function format(n: bigint, scale: number): string {
 const sign = n < 0 ? '-' : ''; const digits = (n < 0 ? -n : n).toString().padStart(scale + 1, '0');
 return sign + normalize(scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits, 1024);
}
export function subtract(a: string, b: string): string {
 const [x, sx] = parts(a), [y, sy] = parts(b), s = Math.max(sx, sy);
 return format(x * 10n ** BigInt(s - sx) - y * 10n ** BigInt(s - sy), s);
}
export function allocation(remaining: string, milliseconds: number): string | null {
 if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;
 const [n, scale] = parts(remaining);
 return format(n * 86400000n * 1000000n / (10n ** BigInt(scale) * BigInt(milliseconds)), 6);
}

// Exact rational inputs; only final presentation is truncated (towards zero).
export function scaleRatio(amount: string, numerator: bigint, denominator: bigint): string {
 if (denominator <= 0n) throw new Error('INVALID_RATIO');
 const [n, scale] = parts(amount);
 return format(n * numerator * 1000000n / (10n ** BigInt(scale) * denominator), 6);
}
export function compare(a: string, b: string): number {
 const difference = subtract(a, b);
 return difference === '0' ? 0 : difference.startsWith('-') ? -1 : 1;
}
// Floor the exact duration for UTC-day presentation, never an exact-time promise.
// A sub-millisecond instant before midnight must retain the preceding UTC day.
export function exhaustionMilliseconds(remaining: string, change: string, duration: number): bigint | null {
 if (compare(change, '0') <= 0 || compare(remaining, '0') < 0 || !Number.isSafeInteger(duration) || duration <= 0) return null;
 const [r, sr] = parts(remaining), [c, sc] = parts(change);
 const numerator = r * 10n ** BigInt(sc) * BigInt(duration);
 const denominator = c * 10n ** BigInt(sr);
 return numerator / denominator;
}
export function compareRatios(a: string, denominatorA: number, b: string, denominatorB: number): number {
 if (![denominatorA,denominatorB].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('INVALID_RATIO');
 const [x,sx]=parts(a), [y,sy]=parts(b);
 const left=x*10n**BigInt(sy)*BigInt(denominatorB), right=y*10n**BigInt(sx)*BigInt(denominatorA);
 return left === right ? 0 : left < right ? -1 : 1;
}
// Combine before truncating: base + change * numerator / denominator.
export function combineRatio(base: string, change: string, numerator: bigint, denominator: bigint): string {
 if (denominator <= 0n) throw new Error('INVALID_RATIO');
 const [a,sa]=parts(base), [b,sb]=parts(change), scale=Math.max(sa,sb);
 const total=a*10n**BigInt(scale-sa)*denominator+b*10n**BigInt(scale-sb)*numerator;
 return format(total*1000000n/(10n**BigInt(scale)*denominator),6);
}
