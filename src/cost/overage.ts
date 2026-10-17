// Vscode-free modelled overage: credits above the reported limit and, only with a validated reviewed catalog, their list-price value.
// Credits and money are separate exact decimals; money is rounded half-up to whole cents for display only. Never an invoice.
import { compare, subtract } from '../decimal.ts';
import { reviewedCatalog, validateCatalog } from './catalog.ts';
import { decimalToRational, formatRational, multiplyRational, rational } from './money.ts';

export interface Overage {
 /** Exact decimal credits above the limit, always greater than zero. */
 credits: string;
 /** Whole-cent amount in USD ("12.40"), or null when no validated reviewed price is available. */
 money: string | null;
 pricePerCredit: string | null;
 catalogVersion: string | null;
 /** The catalog's verification instant. */
 reviewedOn: string | null;
}

/** Credits by which `total` exceeds `limit` (null when it does not, or on any invalid amount), valued at the catalog price when one is validated at `now`. */
export function overageOver(total: string | null | undefined, limit: string | null | undefined, now: string, catalog: unknown = reviewedCatalog): Overage | null {
 try {
  if (typeof total !== 'string' || typeof limit !== 'string' || compare(total, limit) <= 0) return null;
  const credits = subtract(total, limit);
  const none: Overage = { credits, money: null, pricePerCredit: null, catalogVersion: null, reviewedOn: null };
  const checked = validateCatalog(catalog, now);
  const c = checked.catalog;
  // Only a reviewed catalog with one unambiguous per-credit price yields money.
  if (!c || checked.status === 'unavailable' || c.evidence !== 'reviewed' || compare(c.consumer.pricePerCredit, c.enterprise.pricePerCredit) !== 0) return none;
  const price = c.consumer.pricePerCredit;
  const cents = BigInt(formatRational(multiplyRational(multiplyRational(decimalToRational(credits), decimalToRational(price)), rational(100n)), 0, 'half_up'));
  return { credits, money: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`, pricePerCredit: price, catalogVersion: c.version, reviewedOn: c.verifiedOn };
 } catch { return null; }
}
