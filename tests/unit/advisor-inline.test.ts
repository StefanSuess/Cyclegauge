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

const CSS_HEAD=(html:string)=>html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const formPage=(answers:Parameters<typeof inlineAdvisorForm>[0])=>present(view([],'2030-01-01T00:00:00Z'),[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm(answers,3)).html;
const walk=(n:{tag?:string;attrs?:Record<string,string>;children?:unknown[]},f:(n:{tag:string;attrs:Record<string,string>;children:any[]})=>void)=>{if(n.tag)f(n as never);for(const c of (n.children??[]) as any[])walk(c,f);};

test('the inline form sits in a details disclosure that is open only while the plan is unconfirmed',()=>{
 const unconfirmed=formPage({plan:null,billing:null,addOns:null,addOnCredits:null});
 const confirmed=formPage({plan:'pro_max',billing:null,addOns:null,addOnCredits:null});
 assert.match(unconfirmed,/<details id="advisor-change" class="advisor-change" open><summary>Change your plan answers<\/summary><form id="advisor-form"/);
 assert.match(confirmed,/<details id="advisor-change" class="advisor-change"><summary>Change your plan answers<\/summary><form id="advisor-form"/);
 assert.ok(!confirmed.includes('id="advisor-change" class="advisor-change" open'));
 for(const html of [unconfirmed,confirmed]){
  const model=buildDomModel(html);let details=0,forms=0,inside=false;
  walk(model,n=>{if(n.tag==='details'&&n.attrs.id==='advisor-change'){details++;walk(n,m=>{if(m.tag==='form'&&m.attrs.id==='advisor-form'){forms++;inside=true;}});}});
  assert.equal(details,1);assert.equal(forms,1);assert.ok(inside);
 }
});

test('every field keeps its bound label and a primary submit button; labels sit above fields',()=>{
 const html=formPage({plan:null,billing:null,addOns:null,addOnCredits:null});
 for(const [id,name] of [['advisor-plan','plan'],['advisor-billing','billing'],['advisor-add-ons','addOns'],['advisor-credits','addOnCredits']])
  assert.match(html,new RegExp(`<div class="field"><label for="${id}">[^<]+</label><(select|input) id="${id}" name="${name}"`));
 assert.match(html,/<button type="submit">Review costs<\/button>/);
 const css=CSS_HEAD(html);
 assert.match(css,/#advisor-form label\{display:block/);
 assert.match(css,/#advisor-form \.field\{[^}]*max-width:26rem/);
});

test('the Advisor form is styled with editor theme variables, not fixed colours',()=>{
 const css=CSS_HEAD(formPage({plan:null,billing:null,addOns:null,addOnCredits:null}));
 const rules=css.split('\n').filter(l=>l.includes('#advisor-form')).join('\n');
 for(const variable of ['--vscode-dropdown-background','--vscode-dropdown-foreground','--vscode-dropdown-border','--vscode-input-background','--vscode-input-foreground','--vscode-input-border','--vscode-button-background','--vscode-button-foreground','--vscode-button-hoverBackground','--vscode-button-secondaryBackground','--vscode-focusBorder','--vscode-errorForeground'])
  assert.ok(rules.includes(variable),variable);
 assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(rules.replace(/#advisor-[\w-]+/g,'')),'no hard-coded colour');
 assert.ok(!/rgb\(|hsl\(/.test(rules));
 assert.ok(!/\sstyle=/.test(formPage({plan:null,billing:null,addOns:null,addOnCredits:null})));
 assert.match(css,/@media\(forced-colors:active\)\{[^}]*#advisor-form button/);
});

test('the command link is only a fallback while the inline form exists, and adds no new link',()=>{
 const html=formPage({plan:null,billing:null,addOns:null,addOnCredits:null});
 const hrefs=[...html.matchAll(/href="([^"]*)"/g)].map(m=>m[1]);
 assert.equal(hrefs.filter(h=>h==='command:cyclegauge.costAdvisor').length,1);
 assert.deepEqual(hrefs.filter(h=>h!.startsWith('command:')).sort(),['command:cyclegauge.costAdvisor','command:cyclegauge.reportProblem','command:cyclegauge.share']);
 assert.match(html,/<p class="advisor-actions advisor-fallback">/);
 const css=CSS_HEAD(html);
 assert.match(css,/html\[data-cg-live\] \.advisor-fallback\{display:none\}/);
 assert.match(css,/html:not\(\[data-cg-live\]\) \.advisor-change\{display:none\}/);
 // Without the inline form the link is the plain, always visible button.
 const bare=present(view([],'2030-01-01T00:00:00Z'),[],'','<section id="cost-advisor"></section>').html;
 assert.match(bare,/<p class="advisor-actions"><a class="button primary" href="command:cyclegauge\.costAdvisor">/);assert.ok(!bare.includes('advisor-fallback"><'));
});

test('the status line is a live region outside the disclosure',()=>{
 const model=buildDomModel(formPage({plan:null,billing:null,addOns:null,addOnCredits:null}));
 let inside=false,outside=false;
 walk(model,n=>{if(n.tag==='details'&&n.attrs.id==='advisor-change')walk(n,m=>{if(m.attrs.id==='advisor-status')inside=true;});else if(n.attrs.id==='advisor-status'&&n.attrs.role==='status'&&n.attrs['aria-live']==='polite')outside=true;});
 assert.equal(inside,false);assert.equal(outside,true);
});
