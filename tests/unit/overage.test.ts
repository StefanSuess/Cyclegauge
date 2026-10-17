import assert from 'node:assert/strict';
import test from 'node:test';
import { overageOver } from '../../src/cost/overage.ts';
import { reviewedCatalog } from '../../src/cost/catalog.ts';

const NOW = '2030-06-08T00:00:00Z';
const catalog = (change: (c: any) => void) => { const c = structuredClone(reviewedCatalog) as any; change(c); return c; };

test('credits over the limit are exact decimals and money is credits times the catalog price', () => {
 const o = overageOver('300', '100', NOW)!;
 assert.deepEqual(o, { credits: '200', money: '8.00', pricePerCredit: '0.04', catalogVersion: reviewedCatalog.version, reviewedOn: reviewedCatalog.verifiedOn });
 const exact = overageOver('100.000003', '100', NOW)!;
 assert.equal(exact.credits, '0.000003'); // credits stay separate and exact
 assert.equal(exact.money, '0.00');
 assert.equal(overageOver('1000000000000000000000.5', '1', NOW)!.credits, '999999999999999999999.5'); // no float
});

test('money is rounded half-up to whole cents', () => {
 // 0.04 per credit: 3.125 credits = 12.5 cents, 3.12 credits = 12.48 cents, 3.13 credits = 12.52 cents.
 assert.equal(overageOver('103.125', '100', NOW)!.money, '0.13');
 assert.equal(overageOver('103.12', '100', NOW)!.money, '0.12');
 assert.equal(overageOver('103.13', '100', NOW)!.money, '0.13');
 assert.equal(overageOver('100.1', '100', NOW)!.money, '0.00'); // 0.4 cents
 assert.equal(overageOver('100.125', '100', NOW)!.money, '0.01'); // exactly half a cent
 assert.equal(overageOver('1100', '100', NOW)!.money, '40.00');
 assert.equal(overageOver('100012345.5', '100', NOW)!.money, '4000489.82');
});

test('nothing at or below the limit and nothing for unusable amounts', () => {
 assert.equal(overageOver('100', '100', NOW), null);
 assert.equal(overageOver('99.999999', '100', NOW), null);
 assert.equal(overageOver(null, '100', NOW), null);
 assert.equal(overageOver('100', undefined, NOW), null);
 assert.equal(overageOver('abc', '100', NOW), null);
 assert.equal(overageOver('1e999', '100', NOW), null);
});

test('an invalid, hypothetical or ambiguous catalog gives credits but no money', () => {
 const bare = { credits: '200', money: null, pricePerCredit: null, catalogVersion: null, reviewedOn: null };
 assert.deepEqual(overageOver('300', '100', NOW, null), bare);
 assert.deepEqual(overageOver('300', '100', NOW, {}), bare);
 assert.deepEqual(overageOver('300', '100', NOW, catalog(c => { c.consumer.pricePerCredit = '-1'; })), bare);
 assert.deepEqual(overageOver('300', '100', NOW, catalog(c => { c.consumer.pricePerCredit = '0.0400000000000000000000000000001x'; })), bare);
 assert.deepEqual(overageOver('300', '100', NOW, catalog(c => { c.evidence = 'hypothetical'; })), bare);
 assert.deepEqual(overageOver('300', '100', NOW, catalog(c => { c.enterprise.pricePerCredit = '0.05'; })), bare); // two prices: no single figure
 assert.deepEqual(overageOver('300', '100', '2020-01-01T00:00:00Z'), bare); // before the catalog was verified
 assert.deepEqual(overageOver('300', '100', 'not-a-time'), bare);
 assert.equal(overageOver('300', '100', NOW, catalog(c => { c.enterprise.pricePerCredit = '0.040'; }))?.money, null); // a non-canonical amount fails validation
 // A catalog past its review date is a validated, dated reference: the figure stays and carries the review date.
 assert.equal(overageOver('300', '100', '2031-01-01T00:00:00Z')?.reviewedOn, reviewedCatalog.verifiedOn);
});
