import {parseAmount,planNames,type NativeCostInput} from './cost-inputs.ts';
import {PLAN_IDS,type PlanId} from '../cost/types.ts';
import {noAnswers,type AdvisorAnswers,type PlanHint} from '../cost/advisor.ts';

/**
 * Session-only, account-scoped answers. Like the earlier manual Cost Optimizer state, the identity stays private to this object, a change of
 * account context clears everything, and only a monotonically changing editor ticket escapes. Persistence is a
 * separate, separately approved step (SC5) and is deliberately not implemented here.
 */
export class AdvisorInputs {
 #scope:string|null=null;#state='unobserved';#epoch=0;#value:AdvisorAnswers|null=null;
 get value():AdvisorAnswers{return this.#value?{...this.#value}:{...noAnswers};}
 get isSingleAccount():boolean{return this.#state==='single';}
 observe(scope:string|null,state:'single'|'ambiguous'|'unavailable'){
  if(scope!==this.#scope||state!==this.#state){this.clear();this.#scope=scope;this.#state=state;}
 }
 begin(){return ++this.#epoch;}
 commit(ticket:number,value:AdvisorAnswers){if(ticket!==this.#epoch||this.#state!=='single')return false;this.#value={...value};return true;}
 clear(){this.#epoch++;this.#value=null;}
}

const PLAN_PICK_PREFIX='plan:';
/**
 * At most four native questions, each with a "not sure" answer that keeps results conditional. Cancelling at any
 * point returns null and changes nothing.
 */
export async function reviewAdvisor(ui:NativeCostInput,hint:PlanHint,current:AdvisorAnswers):Promise<AdvisorAnswers|null> {
 const planItems=[
  {id:'reset',label:'Clear my answers',description:'Forget what you told the Cost Advisor in this session'},
  {id:'unsure',label:'Not sure',description:hint.plan?`Keep the unconfirmed hint (${planNames[hint.plan]}); results stay conditional`:'Plan stays unknown; results stay conditional'},
  ...PLAN_IDS.map(id=>({id:PLAN_PICK_PREFIX+id,label:`${planNames[id]}${hint.plan===id?' (matches reported credits)':''}`,description:'Confirm this as my current plan'})),
 ];
 const plan=await ui.pick('Cost Advisor — which plan are you on?',planItems);if(!plan)return null;
 if(plan==='reset')return {...noAnswers};
 const billing=await ui.pick('Cost Advisor — how is the plan billed?',[
  {id:'unsure',label:'Not sure',description:'Personal pricing is assumed and the result stays conditional'},
  {id:'consumer_prepaid',label:'Personal subscription (consumer)',description:'Add-on credit packs apply'},
  {id:'enterprise_postpaid',label:'Enterprise',description:'Prepaid add-ons and postpaid overages are separate; consumer pack rules are not applied'},
 ]);if(!billing)return null;
 let addOns:AdvisorAnswers['addOns']=null,addOnCredits:string|null=null;
 if(billing!=='enterprise_postpaid'){
  const answer=await ui.pick('Cost Advisor — do you have purchased add-on credits?',[
   {id:'unsure',label:'Not sure',description:'A hypothetical "no add-ons" comparison is shown, never a saving'},
   {id:'none',label:'No purchased add-on credits'},
   {id:'some',label:'Yes, I have add-on credits',description:'You can enter the remaining credits next'},
  ]);if(!answer)return null;
  if(answer==='none'||answer==='some')addOns=answer;
  if(answer==='some'){
   const text=await ui.input('Remaining add-on credits (leave empty if unknown)',current.addOnCredits??undefined,v=>v===''||parseAmount(v)!==null?undefined:'Enter a non-negative decimal credit amount.');
   if(text===undefined)return null;
   addOnCredits=text===''?null:parseAmount(text);
   if(text!==''&&addOnCredits===null)return null;
  }
 }
 const chosen=plan.startsWith(PLAN_PICK_PREFIX)?plan.slice(PLAN_PICK_PREFIX.length) as PlanId:null;
 if(chosen!==null&&!PLAN_IDS.includes(chosen))return null;
 // Free does not exist on Enterprise; the plan stays unknown instead of silently cancelling.
 return {plan:billing==='enterprise_postpaid'&&chosen==='free'?null:chosen,billing:billing==='unsure'?null:billing as AdvisorAnswers['billing'],addOns,addOnCredits};
}
