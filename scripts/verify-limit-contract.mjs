#!/usr/bin/env node
// EasyKiroGauge — token-only check of the "reported credit limit" data contract.
//
// PURPOSE  Answer, on YOUR machine, whether the limit in Kiro's usage responses looks like a plain plan
//          allocation or like a combined capacity (plan credits plus purchased add-ons).
// PARSER   Records are accepted or rejected by the application's own production parser (src/projection.ts with
//          src/decimal.ts and src/time.ts): numeric precision (exact decimal text, exponents), timestamp
//          acceptance, command and HTTP checks, the single-CREDIT rule and reset-conflict handling are the same
//          code as the collector's. Only the file framing is separate: lines are split on bytes, must be valid
//          UTF-8 and at most 256 KiB, and a final line without a newline is counted as partial, not parsed.
// READS    Directory names are enumerated (never printed) under <source-root>/logs/<run>/<window>/exthost/kiro.kiroAgent/ .
//          Every directory on that path is checked with lstat and skipped if it is a symbolic link. Only regular
//          files named q-client.log or q-client.log.<n> are opened, read-only, without following a link
//          (O_NOFOLLOW) and without blocking (O_NONBLOCK); only lines containing GetUsageLimitsCommand are parsed.
//          Lines longer than 256 KiB, as in the collector, are skipped and counted.
// EXTRACTS In memory only, from accepted records: reported limit and usage (exact decimals), reset instant,
//          observation instant, quality flags, and userInfo.userId (kept only to count and separate accounts;
//          never printed). From the same line, as strings classified into closed vocabularies:
//          subscriptionInfo.type / subscriptionTitle and overageConfiguration.overageStatus.
// PRINTS   One JSON object with fixed keys: counts, booleans and fixed tokens from closed lists. It never prints a
//          path, a raw line, an identifier, a timestamp, a limit value, a usage value, a title or any free text.
// WRITES   Nothing. No files, no temp files, no logs, no network, no child processes, no environment access.
// USAGE    node --disable-warning=ExperimentalWarning scripts/verify-limit-contract.mjs --source-root "<Kiro data dir>"
//                 [--source-timezone <IANA zone>]
//          Kiro's account log timestamps carry no UTC offset; they are wall-clock times in the zone Kiro wrote them in
//          (normally this computer's zone). The default is this computer's zone, exactly like the extension's
//          easykirogauge.sourceTimezone setting when it is empty. Pass --source-timezone only if you changed that
//          setting or ran Kiro in another zone (for example a remote or container session). The zone only orders
//          records and resolves wall-clock times; wall-clock times that are ambiguous or do not exist because of a
//          daylight-saving change are rejected by the production parser and counted as such.
//          Review this file before running it. Do not paste anything except its JSON output.
import {readdirSync,lstatSync,openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseLine} from '../src/projection.ts';
import {compare,subtract} from '../src/decimal.ts';

// Bundled catalog (kiro-commercial 2026-10-10): nominal plan credits and the add-on purchase range.
const PLANS=[['free','50'],['pro','1000'],['pro_plus','2000'],['pro_max','5000'],['power','10000']];
const ADD_ON_MIN='125', ADD_ON_MAX='12500'; // 125 credits minimum; 5 packs of at most 2,500
const MAX_FILE=64*1024*1024, MAX_LINE=256*1024, MAX_FILES=2000, MAX_RECORDS=200000;
// Closed set of production parser outcomes that may be reported by name; anything else is "other".
const STATUSES=new Set(['ignored','malformed_record','failed_response','unsupported_format','conflicting_resources','unsupported_resource','invalid_billing','invalid_timestamp','source_timezone_required','ambiguous_timezone','unsupported_timezone']);
const fail=code=>{process.stdout.write(JSON.stringify({schema:'ekg-limit-contract.1',error:code})+'\n');process.exit(1);};

const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const known=args.filter(a=>a.startsWith('--')).every(a=>a==='--source-root'||a==='--source-timezone'||a==='--help');
if(args.includes('--help')||!known||!flag('--source-root')||args.length!==2*['--source-root','--source-timezone'].filter(f=>args.includes(f)).length){
 process.stdout.write('usage: node --disable-warning=ExperimentalWarning scripts/verify-limit-contract.mjs --source-root <directory> [--source-timezone <IANA zone>]\n');process.exit(args.includes('--help')?0:1);
}
const requestedZone=flag('--source-timezone');
const zone=requestedZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{fail('TIMEZONE_INVALID');}
const isRealDir=p=>{try{const s=lstatSync(p);return s.isDirectory()&&!s.isSymbolicLink();}catch{return false;}};
let root;
try{root=resolve(flag('--source-root'));if(!isRealDir(root))fail('SOURCE_ROOT_INVALID');}catch{fail('SOURCE_ROOT_INVALID');}

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
// Exact decimals need JSON.parse reviver source text (Node 24.13+); without it every record would look invalid.
{let seenSource;JSON.parse('[1.50]',(k,v,c)=>{if(typeof v==='number')seenSource=c&&c.source;return v;});if(seenSource!=='1.50')fail('RUNTIME_UNSUPPORTED');}
const FLAGS=constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);
let partial=0,seen=0,accepted=0,filesRead=0,tooLong=0,capped=false,usageAbove=false,extra=false,reduced=false,missingLimit=false,conflictingReset=false,assumedZone=false;
const rejected=new Map(),records=[],accounts=new Set(),subTokens=new Set(),titleTokens=new Set(),overage=new Set();
const bump=(m,k)=>m.set(k,(m.get(k)??0)+1);

for(const file of files){
 let fd;
 try{
  fd=openSync(file,FLAGS);const st=fstatSync(fd);
  if(!st.isFile()||st.size>MAX_FILE){closeSync(fd);filesSkipped++;continue;}
  const buf=Buffer.alloc(st.size);let off=0;while(off<st.size){const n=readSync(fd,buf,off,st.size-off,off);if(n<=0)break;off+=n;}
  closeSync(fd);filesRead++;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  for(let start=0;start<buf.length;){
   const nl=buf.indexOf(10,start);
   const end=nl<0?buf.length:nl,bytes=buf.subarray(start,end);start=end+1;
   const complete=nl>=0;
   if(bytes.indexOf('GetUsageLimitsCommand')<0)continue;
   if(seen>=MAX_RECORDS){capped=true;break;}
   seen++;
   if(!complete){partial++;continue;}
   if(bytes.length>MAX_LINE){tooLong++;continue;}
   let line;try{line=decoder.decode(bytes);}catch{bump(rejected,'malformed_record');continue;}
   const p=parseLine(line.replace(/\r$/,''),zone);
   if(p.status!=='accepted'||!p.snapshot){bump(rejected,STATUSES.has(p.status)?p.status:'other');continue;}
   accepted++;
   const s=p.snapshot;
   if(typeof p.identity==='string')accounts.add(p.identity);
   records.push({at:s.observedAt,cycle:s.resetAt,account:typeof p.identity==='string'?p.identity:null,limit:s.limit});
   if(s.limit!==null&&s.usage!==null&&compare(s.usage,s.limit)>0)usageAbove=true;
   if(s.flags.includes('unsupported_extra_credits'))extra=true;
   if(s.flags.includes('reduced_precision'))reduced=true;
   if(s.flags.includes('missing_limit'))missingLimit=true;
   if(s.flags.includes('conflicting_reset_metadata'))conflictingReset=true;
   if(s.flags.includes('assumed_source_timezone'))assumedZone=true;
   try{ // strings only, classified into closed vocabularies; the numeric parsing above is the production one
    const out=JSON.parse(line.slice(line.indexOf('{'))).output;
    const info=out&&out.subscriptionInfo;
    if(info&&typeof info==='object'){const a=planToken(info.type),b=planToken(info.subscriptionTitle);if(a)subTokens.add(a);if(b)titleTokens.add(b);}
    const status=out&&out.overageConfiguration&&out.overageConfiguration.overageStatus;
    if(typeof status==='string')overage.add(/^enabled$/i.test(status)?'enabled':/^disabled$/i.test(status)?'disabled':'other');
   }catch{/* classification is optional */}
  }
 }catch{try{if(fd!==undefined)closeSync(fd);}catch{}filesSkipped++;}
}

// Interpret each distinct limit against the catalog without printing it. A lower plan plus add-ons is one possible
// explanation, never an identification: several different combinations can reach the same number.
const limitSet=new Set(records.filter(r=>r.limit!==null).map(r=>r.limit)),limitTokens=new Set();
let nonInteger=false;
for(const limit of limitSet){
 if(!/^\d+$/.test(limit))nonInteger=true;
 const exact=PLANS.find(([,c])=>compare(c,limit)===0);
 if(exact){limitTokens.add('nominal_'+exact[0]);continue;}
 const lower=[...PLANS].reverse().find(([,c])=>compare(c,limit)<0);
 let within=false;
 if(lower){const diff=subtract(limit,lower[1]);within=compare(diff,ADD_ON_MIN)>=0&&compare(diff,ADD_ON_MAX)<=0;}
 limitTokens.add(lower&&within?'exceeds_'+lower[0]+'_within_addon_range':'no_catalog_explanation');
}
// Limit changes inside one billing cycle, per account, in observation order. Records without a reset instant or
// an account are counted apart and excluded from the change count.
const groups=new Map(),cycles=new Set();let unknownCycle=0,noAccount=0;
for(const r of records.sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0)){
 if(r.limit===null)continue;
 if(r.cycle===null){unknownCycle++;continue;}
 if(r.account===null){noAccount++;continue;}
 const perAccount=groups.get(r.account)??new Map();groups.set(r.account,perAccount);
 const seq=perAccount.get(r.cycle)??[];if(seq.at(-1)!==r.limit)seq.push(r.limit);perAccount.set(r.cycle,seq);cycles.add(r.cycle);
}
let changes=0;for(const perAccount of groups.values())for(const seq of perAccount.values())changes+=Math.max(0,seq.length-1);
const sorted=s=>[...s].sort();
const nominal=sorted(limitTokens).filter(t=>t.startsWith('nominal_')).map(t=>t.slice(8));
const planTokens=new Set([...subTokens,...titleTokens].filter(t=>t!=='other'));
const agrees=nominal.length===1&&planTokens.size>=1?planTokens.size===1&&planTokens.has(nominal[0]):null;
const rejectedCounts=Object.fromEntries(sorted(rejected.keys()).map(k=>[k,rejected.get(k)]));
process.stdout.write(JSON.stringify({
 schema:'ekg-limit-contract.1',
 files_read:filesRead,files_skipped:filesSkipped,records_seen:seen,records_accepted:accepted,
 records_rejected_by_status:rejectedCounts,records_too_long:tooLong,records_partial_unterminated:partial,record_cap_reached:capped,
 distinct_accounts_seen:accounts.size,
 limit_distinct_count:limitSet.size,limit_tokens:sorted(limitTokens),limit_non_integer_seen:nonInteger,
 limit_changes_within_cycle_count:changes,cycles_seen:cycles.size,
 records_without_cycle:unknownCycle,records_without_account:noAccount,
 usage_above_limit_seen:usageAbove,reduced_precision_seen:reduced,missing_limit_seen:missingLimit,
 unsupported_extra_credits_seen:extra,conflicting_reset_metadata_seen:conflictingReset,assumed_source_timezone_seen:assumedZone,source_timezone_origin:requestedZone===undefined?'device':'argument',
 subscription_type_tokens:sorted(subTokens),subscription_title_tokens:sorted(titleTokens),
 plan_token_agrees_with_nominal_limit:agrees,overage_status_tokens:sorted(overage),
},null,1)+'\n');
