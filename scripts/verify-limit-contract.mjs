#!/usr/bin/env node
// EasyKiroGauge — token-only check of the "reported credit limit" data contract.
//
// PURPOSE  Answer, on YOUR machine, whether the limit in Kiro's usage responses looks like a plain plan
//          allocation or like a combined capacity (plan credits plus purchased add-ons).
// READS    Only files named q-client.log or q-client.log.<n> inside
//          <source-root>/logs/<run>/<window>/exthost/kiro.kiroAgent/ , opened read-only, and only the lines that
//          contain GetUsageLimitsCommand. Symbolic links are skipped. Nothing else is opened.
// EXTRACTS In memory only, from each parsed record: output.nextDateReset (to group cycles),
//          usageBreakdownList[type CREDIT].usageLimitWithPrecision / usageLimit, currentUsageWithPrecision / currentUsage,
//          bonuses, overageCredits (emptiness only), output.subscriptionInfo.type / subscriptionTitle and
//          output.overageConfiguration.overageStatus (classified, never printed).
// PRINTS   One JSON object with fixed keys: counts, booleans and fixed tokens from a closed list. It never prints a
//          path, a raw line, an identifier, a timestamp, a limit value, a usage value, a title or any free text.
// WRITES   Nothing. No files, no temp files, no logs, no network, no child processes, no environment access.
// USAGE    node scripts/verify-limit-contract.mjs --source-root "<your Kiro data directory>"
//          Review this file before running it. Do not paste anything except its JSON output.
import {readdirSync,lstatSync,openSync,readSync,closeSync,fstatSync} from 'node:fs';
import {join,resolve} from 'node:path';

// Bundled catalog (kiro-commercial 2026-10-10): nominal plan credits and the add-on purchase range.
const PLANS=[['free',50],['pro',1000],['pro_plus',2000],['pro_max',5000],['power',10000]];
const ADD_ON_MIN=125, ADD_ON_MAX=12500; // 125 credits minimum; 5 packs of at most 2,500
const MAX_FILE=64*1024*1024, MAX_LINE=1024*1024, MAX_FILES=2000, MAX_RECORDS=200000;
const fail=code=>{process.stdout.write(JSON.stringify({schema:'ekg-limit-contract.1',error:code})+'\n');process.exit(1);};

const args=process.argv.slice(2);
const at=args.indexOf('--source-root');
if(args.includes('--help')||at<0||!args[at+1]||args.length!==2){process.stdout.write('usage: node scripts/verify-limit-contract.mjs --source-root <directory>\n');process.exit(args.includes('--help')?0:1);}
let root;
try{root=resolve(args[at+1]);if(!lstatSync(root).isDirectory())fail('SOURCE_ROOT_INVALID');}catch{fail('SOURCE_ROOT_INVALID');}

const dirs=p=>{try{return readdirSync(p,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.isSymbolicLink()).map(d=>d.name).sort();}catch{return [];}};
const files=[];
for(const run of dirs(join(root,'logs')))for(const win of dirs(join(root,'logs',run))){
 const dir=join(root,'logs',run,win,'exthost','kiro.kiroAgent');
 let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{continue;}
 for(const e of entries)if(e.isFile()&&!e.isSymbolicLink()&&/^q-client\.log(?:\.\d+)?$/.test(e.name))files.push(join(dir,e.name));
 if(files.length>=MAX_FILES)break;
}
if(!files.length)fail('NO_LOGS');

const planToken=text=>{ // closed vocabulary only
 if(typeof text!=='string')return null;
 const t=text.toLowerCase().replace(/[^a-z0-9+]+/g,'_');
 if(/enterprise/.test(t))return 'enterprise';
 if(/free/.test(t))return 'free';
 if(/pro_?plus|pro\+/.test(t))return 'pro_plus';
 if(/pro_?max|max/.test(t))return 'pro_max';
 if(/power/.test(t))return 'power';
 if(/pro/.test(t))return 'pro';
 return 'other';
};
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
let seen=0,parsed=0,filesRead=0,bonuses=false,overageCredits=false,aboveLimit=false,missingPrecision=false;
const limitsByCycle=new Map(),limitSet=new Set(),subTokens=new Set(),titleTokens=new Set(),overage=new Set();

for(const file of files){
 let fd;
 try{
  fd=openSync(file,'r');const st=fstatSync(fd);
  if(!st.isFile()||st.size>MAX_FILE){closeSync(fd);continue;}
  const buf=Buffer.alloc(st.size);let off=0;while(off<st.size){const n=readSync(fd,buf,off,st.size-off,off);if(n<=0)break;off+=n;}
  closeSync(fd);filesRead++;
  for(const raw of buf.toString('utf8').split('\n')){
   if(raw.length>MAX_LINE||!raw.includes('GetUsageLimitsCommand'))continue;
   if(++seen>MAX_RECORDS)break;
   const brace=raw.indexOf('{');if(brace<0)continue;
   let rec;try{rec=JSON.parse(raw.slice(brace));}catch{continue;}
   const out=rec&&rec.output;if(!out||typeof out!=='object')continue;
   const list=Array.isArray(out.usageBreakdownList)?out.usageBreakdownList:[];
   const credit=list.find(b=>b&&b.resourceType==='CREDIT');if(!credit)continue;
   parsed++;
   const precise=num(credit.usageLimitWithPrecision),limit=precise??num(credit.usageLimit);
   if(precise===null)missingPrecision=true;
   const usage=num(credit.currentUsageWithPrecision)??num(credit.currentUsage);
   if(limit!==null){
    limitSet.add(limit);
    const cycle=typeof out.nextDateReset==='string'?out.nextDateReset.slice(0,10):'unknown';
    if(!limitsByCycle.has(cycle))limitsByCycle.set(cycle,[]);
    const seq=limitsByCycle.get(cycle);if(seq.at(-1)!==limit)seq.push(limit);
    if(usage!==null&&usage>limit)aboveLimit=true;
   }
   if(Array.isArray(credit.bonuses)&&credit.bonuses.length)bonuses=true;
   if(Array.isArray(credit.overageCredits)&&credit.overageCredits.length)overageCredits=true;
   const info=out.subscriptionInfo;
   if(info&&typeof info==='object'){const a=planToken(info.type),b=planToken(info.subscriptionTitle);if(a)subTokens.add(a);if(b)titleTokens.add(b);}
   const status=out.overageConfiguration&&out.overageConfiguration.overageStatus;
   if(typeof status==='string')overage.add(/^enabled$/i.test(status)?'enabled':/^disabled$/i.test(status)?'disabled':'other');
  }
 }catch{try{if(fd!==undefined)closeSync(fd);}catch{}}
}

// Interpret each distinct limit against the catalog without printing it.
const limitTokens=new Set();
for(const limit of limitSet){
 const exact=PLANS.find(([,c])=>c===limit);
 if(exact){limitTokens.add('nominal_'+exact[0]);continue;}
 const lower=[...PLANS].reverse().find(([,c])=>c<limit);
 const diff=lower?limit-lower[1]:null;
 limitTokens.add(lower&&diff>=ADD_ON_MIN&&diff<=ADD_ON_MAX?'consistent_with_'+lower[0]+'_plus_addons':'no_catalog_explanation');
}
let changesWithinCycle=0;for(const seq of limitsByCycle.values())changesWithinCycle+=Math.max(0,seq.length-1);
const sorted=s=>[...s].sort();
const nominal=sorted(limitTokens).filter(t=>t.startsWith('nominal_')).map(t=>t.slice(8));
const planTokens=new Set([...subTokens,...titleTokens].filter(t=>t!=='other'));
const agrees=nominal.length===1&&planTokens.size>=1?planTokens.size===1&&planTokens.has(nominal[0]):null;
process.stdout.write(JSON.stringify({
 schema:'ekg-limit-contract.1',
 files_read:filesRead,records_seen:seen,records_parsed:parsed,
 limit_distinct_count:limitSet.size,limit_tokens:sorted(limitTokens),
 limit_changes_within_cycle_count:changesWithinCycle,cycles_seen:limitsByCycle.size,
 usage_above_limit_seen:aboveLimit,precision_field_missing_seen:missingPrecision,
 bonuses_nonempty_seen:bonuses,overage_credits_nonempty_seen:overageCredits,
 subscription_type_tokens:sorted(subTokens),subscription_title_tokens:sorted(titleTokens),
 plan_token_agrees_with_nominal_limit:agrees,overage_status_tokens:sorted(overage),
},null,1)+'\n');
