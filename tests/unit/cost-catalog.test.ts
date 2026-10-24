import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewedCatalog, validateCatalog } from '../../src/cost/catalog.ts';
import { syntheticCatalog } from './cost-synthetic.ts';

test('catalog rejects invalid rules without returning rejected data', () => {
 const mutations = [
  (c:any)=>c.schemaVersion=999, (c:any)=>c.plans[0].source.url='',
  (c:any)=>c.plans.push(c.plans[0]), (c:any)=>c.plans[1].fee='-1',
  (c:any)=>c.consumer.minimumCredits='2501', (c:any)=>c.consumer.billingSystem='enterprise_postpaid',
  (c:any)=>c.rules[0].effectiveTo='2029-01-01T00:00:00Z',
  (c:any)=>c.rules[0].status='conflicting', (c:any)=>c.currency='EUR',
 ];
 for (const mutate of mutations) {
  const c=syntheticCatalog(); mutate(c);
  const r=validateCatalog(c,'2030-01-01T00:00:00Z');
  assert.equal(r.status,'unavailable'); assert.equal(r.catalog,null);
  assert.ok(r.reasons.every(x=>/^[a-z_]+$/.test(x)));
 }
});
test('reviewed catalog retains all tiers and unresolved rules', () => {
 const r=validateCatalog(reviewedCatalog,'2026-10-10T12:00:00Z');
 assert.equal(r.status,'available'); assert.equal(r.catalog!.plans.length,5);
 assert.equal(r.catalog!.enterprise.allowedPlans.length,4);
 assert.equal(r.catalog!.consumer.purchaseStepCredits,null);
 assert.equal(r.catalog!.consumer.moneyRounding,null);
 assert.equal(r.catalog!.consumer.depletedSlotRelease,null);
 assert.equal(r.catalog!.market,'commercial');
 assert.equal(r.catalog!.rules.find(x=>x.id==='B3')!.effectiveFrom,null);
});
test('review policy keeps day 30 dated and day 31 conditional', () => {
 assert.equal(validateCatalog(syntheticCatalog(),'2030-01-31T00:00:00Z').status,'available');
 const r=validateCatalog(syntheticCatalog(),'2030-02-01T00:00:00Z');
 assert.equal(r.status,'conditional'); assert.deepEqual(r.reasons,['catalog_review_due']);
});
test('future effective changes are retained and unknown properties dropped', () => {
 const c:any=syntheticCatalog(); c.privateSentinel='synthetic-private-marker';
 c.changes=[{at:'2030-02-01T00:00:00Z',planId:'pro',fee:'21',credits:'1000',source:c.plans[0].source}];
 const r=validateCatalog(c,'2030-01-01T00:00:00Z');
 assert.equal(r.catalog!.changes[0].at,'2030-02-01T00:00:00Z');
 assert.ok(!JSON.stringify(r).includes('synthetic-private-marker'));
 c.changes.push({...c.changes[0],fee:'22'});
 assert.equal(validateCatalog(c,'2030-01-01T00:00:00Z').status,'unavailable');
});

test('incompatible purchase quantum is rejected before simulation',()=>{
 const c=syntheticCatalog();c.consumer.minimumCredits='2499';c.consumer.purchaseStepCredits='2498';
 assert.equal(validateCatalog(c,'2030-01-01T00:00:00Z').status,'unavailable');
});
