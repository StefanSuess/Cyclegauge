#!/usr/bin/env node
// EasyKiroGauge — token-only check of the "reported credit limit" data contract.
//
// PURPOSE  Answer, on YOUR machine, whether the limit in Kiro's usage responses looks like a plain plan
//          allocation or like a combined capacity (plan credits plus purchased add-ons).
// READS    Directory names are enumerated (never printed) under <source-root>/logs/<run>/<window>/exthost/kiro.kiroAgent/ .
//          Every directory on that path is checked with lstat and skipped if it is a symbolic link. Only regular
//          files named q-client.log or q-client.log.<n> are opened, read-only, without following a link
//          (O_NOFOLLOW) and without blocking (O_NONBLOCK); only lines containing GetUsageLimitsCommand are parsed.
// EXTRACTS In memory only, per record that passes the same checks as the app's collector (command name, HTTP 200,
//          exactly one CREDIT entry): usageLimitWithPrecision / usageLimit, currentUsageWithPrecision / currentUsage,
//          breakdown or output nextDateReset (to group cycles), bonuses and overageCredits (emptiness only),
//          output.userInfo.userId (kept in memory only to count distinct accounts and to separate them; never printed), subscriptionInfo.type /
//          subscriptionTitle and overageConfiguration.overageStatus (classified, never printed).
// PRINTS   One JSON object with fixed keys: counts, booleans and fixed tokens from closed lists. It never prints a
//          path, a raw line, an identifier, a timestamp, a limit value, a usage value, a title or any free text.
// WRITES   Nothing. No files, no temp files, no logs, no network, no child processes, no environment access.
// USAGE    node scripts/verify-limit-contract.mjs --source-root "<your Kiro data directory>"
//          Review this file before running it. Do not paste anything except its JSON output.
import {readdirSync,lstatSync,openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';

// Bundled catalog (kiro-commercial 2026-10-10): nominal plan credits and the add-on purchase range.
const PLANS=[['free',50],['pro',1000],['pro_plus',2000],['pro_max',5000],['power',10000]];
const ADD_ON_MIN=125, ADD_ON_MAX=12500; // 125 credits minimum; 5 packs of at most 2,500
const MAX_FILE=64*1024*1024, MAX_LINE=256*1024, MAX_FILES=2000, MAX_RECORDS=200000;
const fail=code=>{process.stdout.write(JSON.stringify({schema:'ekg-limit-contract.1',error:code})+'\n');process.exit(1);};

const args=process.argv.slice(2);
const at=args.indexOf('--source-root');
if(args.includes('--help')||at<0||!args[at+1]||args.length!==2){process.stdout.write('usage: node scripts/verify-limit-contract.mjs --source-root <directory>\n');process.exit(args.includes('--help')?0:1);}
const isRealDir=p=>{try{const s=lstatSync(p);return s.isDirectory()&&!s.isSymbolicLink();}catch{return false;}};
let root;
try{root=resolve(args[at+1]);if(!isRealDir(root))fail('SOURCE_ROOT_INVALID');}catch{fail('SOURCE_ROOT_INVALID');}

const subdirs=p=>{try{return readdirSync(p,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.isSymbolicLink()).map(d=>d.name).sort();}catch{return [];}};
const files=[];let filesSkipped=0;
for(const run of subdirs(join(root,'logs')))for(const win of subdirs(join(root,'logs',run))){
 const chain=[join(root,'logs'),join(root,'logs',run),join(root,'logs',run,win),join(root,'logs',run,win,'exthost'),join(root,'logs',run,win,'exthost','kiro.kiroAgent')];
 if(!chain.every(isRealDir))continue;
 let entries;try{entries=readdirSync(chain[4],{withFileTypes:true});}catch{continue;}
 for(const e of entries){
  if(!/^q-client\.log(?:\.\d+)?$/.test(e.name))continue;
  if(!e.isFile()||e.isSymbolicLink()){filesSkipped++;continue;}
  if(files.length>=MAX_FILES){filesSkipped++;continue;}
  files.push(join(chain[4],e.name));
 }
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
const STAMP=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \[info\] /;
const instant=v=>{if(typeof v!=='string'||v.length>64)return null;const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null;};
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const FLAGS=constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);
let seen=0,parsed=0,filesRead=0,recordsSkipped=0,bonuses=false,overageCredits=false,aboveLimit=false,nonInteger=false,missingPrecision=false,capped=false;
const records=[],accounts=new Set(),subTokens=new Set(),titleTokens=new Set(),overage=new Set();

for(const file of files){
 let fd;
 try{
  fd=openSync(file,FLAGS);const st=fstatSync(fd);
  if(!st.isFile()||st.size>MAX_FILE){closeSync(fd);filesSkipped++;continue;}
  const buf=Buffer.alloc(st.size);let off=0;while(off<st.size){const n=readSync(fd,buf,off,st.size-off,off);if(n<=0)break;off+=n;}
  closeSync(fd);filesRead++;
  for(const raw of buf.toString('utf8').split('\n')){
   if(!raw.includes('GetUsageLimitsCommand'))continue;
   if(seen>=MAX_RECORDS){capped=true;break;}
   seen++;
   if(raw.length>MAX_LINE){recordsSkipped++;continue;}
   if(!STAMP.test(raw)){recordsSkipped++;continue;}
   const brace=raw.indexOf('{');if(brace<0){recordsSkipped++;continue;}
   let rec;try{rec=JSON.parse(raw.slice(brace));}catch{recordsSkipped++;continue;}
   const out=rec&&typeof rec==='object'?rec.output:null;
   if(!rec||rec.commandName!=='GetUsageLimitsCommand'||!out||typeof out!=='object'||!rec.metadata||rec.metadata.httpStatusCode!==200){recordsSkipped++;continue;}
   const credits=Array.isArray(out.usageBreakdownList)?out.usageBreakdownList.filter(b=>b&&b.resourceType==='CREDIT'):[];
   if(credits.length!==1){recordsSkipped++;continue;}
   const credit=credits[0];
   parsed++;
   const precise=num(credit.usageLimitWithPrecision),limit=precise??num(credit.usageLimit);
   if(precise===null)missingPrecision=true;
   const usage=num(credit.currentUsageWithPrecision)??num(credit.currentUsage);
   const inner=instant(credit.nextDateReset),outerReset=instant(out.nextDateReset);
   // Conflicting reset fields are not trusted (the collector flags them as well).
   if(inner!==null&&outerReset!==null&&inner!==outerReset){recordsSkipped++;parsed--;continue;}
   const cycle=inner??outerReset;
   const account=out.userInfo&&typeof out.userInfo==='object'&&typeof out.userInfo.userId==='string'&&out.userInfo.userId.length>0&&out.userInfo.userId.length<=1024?out.userInfo.userId:null;
   if(account!==null)accounts.add(account);
   // Offset-free log timestamps sort lexically; they order records, they are never printed.
   records.push({ts:raw.slice(0,23),cycle,account,limit});
   if(limit!==null){if(!Number.isInteger(limit))nonInteger=true;if(usage!==null&&usage>limit)aboveLimit=true;}
   if(Array.isArray(credit.bonuses)&&credit.bonuses.length)bonuses=true;
   if(Array.isArray(credit.overageCredits)&&credit.overageCredits.length)overageCredits=true;
   const info=out.subscriptionInfo;
   if(info&&typeof info==='object'){const a=planToken(info.type),b=planToken(info.subscriptionTitle);if(a)subTokens.add(a);if(b)titleTokens.add(b);}
   const status=out.overageConfiguration&&out.overageConfiguration.overageStatus;
   if(typeof status==='string')overage.add(/^enabled$/i.test(status)?'enabled':/^disabled$/i.test(status)?'disabled':'other');
  }
 }catch{try{if(fd!==undefined)closeSync(fd);}catch{}filesSkipped++;}
}

// Interpret each distinct limit against the catalog without printing it. A lower plan plus add-ons is one possible
// explanation, never an identification: several different combinations can reach the same number.
const limitSet=new Set(records.filter(r=>r.limit!==null).map(r=>r.limit)),limitTokens=new Set();
for(const limit of limitSet){
 const exact=PLANS.find(([,c])=>c===limit);
 if(exact){limitTokens.add('nominal_'+exact[0]);continue;}
 const lower=[...PLANS].reverse().find(([,c])=>c<limit);
 const diff=lower?limit-lower[1]:null;
 limitTokens.add(lower&&diff>=ADD_ON_MIN&&diff<=ADD_ON_MAX?'exceeds_'+lower[0]+'_within_addon_range':'no_catalog_explanation');
}
// Limit changes inside one billing cycle, per account, in log-time order. Records without a cycle are counted apart.
const groups=new Map();let unknownCycle=0,noAccount=0;
for(const r of records.sort((a,b)=>a.ts<b.ts?-1:a.ts>b.ts?1:0)){
 if(r.limit===null)continue;
 if(r.cycle===null){unknownCycle++;continue;}
 if(r.account===null){noAccount++;continue;}
 const key=r.account+'\u0000'+r.cycle;
 const seq=groups.get(key)??[];if(seq.at(-1)!==r.limit)seq.push(r.limit);groups.set(key,seq);
}
let changes=0;for(const seq of groups.values())changes+=Math.max(0,seq.length-1);
const sorted=s=>[...s].sort();
const nominal=sorted(limitTokens).filter(t=>t.startsWith('nominal_')).map(t=>t.slice(8));
const planTokens=new Set([...subTokens,...titleTokens].filter(t=>t!=='other'));
const agrees=nominal.length===1&&planTokens.size>=1?planTokens.size===1&&planTokens.has(nominal[0]):null;
process.stdout.write(JSON.stringify({
 schema:'ekg-limit-contract.1',
 files_read:filesRead,files_skipped:filesSkipped,records_seen:seen,records_parsed:parsed,records_skipped:recordsSkipped,record_cap_reached:capped,
 distinct_accounts_seen:accounts.size,
 limit_distinct_count:limitSet.size,limit_tokens:sorted(limitTokens),limit_non_integer_seen:nonInteger,
 limit_changes_within_cycle_count:changes,cycles_seen:new Set([...groups.keys()].map(k=>k.split('\u0000')[1])).size,records_without_cycle:unknownCycle,records_without_account:noAccount,
 usage_above_limit_seen:aboveLimit,precision_field_missing_seen:missingPrecision,
 bonuses_nonempty_seen:bonuses,overage_credits_nonempty_seen:overageCredits,
 subscription_type_tokens:sorted(subTokens),subscription_title_tokens:sorted(titleTokens),
 plan_token_agrees_with_nominal_limit:agrees,overage_status_tokens:sorted(overage),
},null,1)+'\n');
