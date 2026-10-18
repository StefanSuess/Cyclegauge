import { reconcileAdvisorDraft } from '../../src/extension/advisor-draft.ts';
import { inlineAdvisorForm, present } from '../../src/extension/presentation.ts';
import { view } from '../../src/view.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdvisorInputs, validateAdvisorAnswers } from '../../src/extension/advisor-inputs.ts';
import { buildDomModel, acceptMessage } from '../../src/extension/dashboard-shell.ts';

test('shared Advisor validation keeps unknown, parses credits and normalizes Enterprise Free', () => {
 assert.deepEqual(validateAdvisorAnswers({plan:'unsure',billing:'unsure',addOns:'unsure',addOnCredits:''}).value,{plan:null,billing:null,addOns:null,addOnCredits:null});
 assert.deepEqual(validateAdvisorAnswers({plan:'free',billing:'enterprise_postpaid',addOns:'some',addOnCredits:'10'}).value,{plan:null,billing:'enterprise_postpaid',addOns:null,addOnCredits:null});
 assert.deepEqual(validateAdvisorAnswers({plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'12.50'}).value,{plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'12.5'});
 assert.deepEqual(validateAdvisorAnswers({plan:'reset',billing:'unsure',addOns:'unsure',addOnCredits:''}).value,{plan:null,billing:null,addOns:null,addOnCredits:null});
 assert.deepEqual(validateAdvisorAnswers({plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'-1'}).errors,['addOnCredits']);
});

test('commits bump a read-only epoch so replay and cancelled native editors are stale', () => {
 const a=new AdvisorInputs(); a.observe('synthetic-account','single');
 const ticket=a.epoch; assert.equal(a.commit(ticket,{plan:'pro',billing:null,addOns:null,addOnCredits:null}),true);
 assert.ok(a.epoch>ticket); assert.equal(a.commit(ticket,{plan:'free',billing:null,addOns:null,addOnCredits:null}),false);
 const before=a.epoch; a.begin(); assert.ok(a.epoch>before);
});

test('advisorSubmit only accepts exact bounded plain messages', () => {
 const good={type:'advisorSubmit',ticket:4,plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'12'};
 assert.deepEqual(acceptMessage(good,1,0),good);
 for(const bad of [{...good,extra:1},{...good,ticket:-1},{...good,addOnCredits:'x'.repeat(4097)},{...good,plan:4},Object.assign(Object.create(null),good),{...good,type:'__proto__'}]) assert.equal(acceptMessage(bad,1,0),null);
});

test('inline form remains static and within the constrained model', () => {
 const form=inlineAdvisorForm({plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'12.5'},7);
 const html=present(view([],'2030-01-01T00:00:00Z'),[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,form).html;
 const model=buildDomModel(html);
 assert.ok(JSON.stringify(model).includes('advisor-form'));
 assert.match(html, /<fieldset><legend>Review your Cost Advisor answers<\/legend>/);
 assert.match(html, /data-advisor-epoch="7"/);
 assert.ok(!html.includes('<script'));
});

test('model ordering preserves unsaved drafts and waits for the committed epoch', () => {
 const before=reconcileAdvisorDraft({hasDraft:true,ticket:5,awaitingEpoch:6,editVersion:1,savedVersion:1,modelEpoch:5,hostEpoch:6});
 assert.deepEqual(before,{keepDraft:true,awaitingEpoch:6,stale:false,epoch:6});
 const arrived=reconcileAdvisorDraft({hasDraft:true,ticket:6,awaitingEpoch:6,editVersion:1,savedVersion:1,modelEpoch:6,hostEpoch:6});
 assert.equal(arrived.keepDraft,false);
 const edited=reconcileAdvisorDraft({hasDraft:true,ticket:6,awaitingEpoch:6,editVersion:2,savedVersion:1,modelEpoch:6,hostEpoch:6});
 assert.equal(edited.keepDraft,true);
 const elsewhere=reconcileAdvisorDraft({hasDraft:true,ticket:6,awaitingEpoch:null,editVersion:2,savedVersion:1,modelEpoch:7,hostEpoch:7});
 assert.equal(elsewhere.stale,true);
});

test('a newer coalesced epoch supersedes the awaited commit and keeps the draft stale', () => {
 const next=reconcileAdvisorDraft({hasDraft:true,ticket:2,awaitingEpoch:2,editVersion:1,savedVersion:1,modelEpoch:3,hostEpoch:2});
 assert.deepEqual(next,{keepDraft:true,awaitingEpoch:null,stale:true,epoch:3});
});
