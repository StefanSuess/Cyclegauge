#!/usr/bin/env node
// SYNTHETIC DEMO DATA — invented from scratch, never derived from any real Kiro log or account.
// Writes a Kiro-shaped q-client.log with about six weeks of account snapshots (one complete billing cycle, a reset,
// and the current partial cycle) so the real collector, store, projection, forecast and Cost Advisor can be viewed.
// Nothing is inserted into any store or database: the application ingests the log like any other source.
//
// usage: node scripts/demo/generate-demo-month.mjs --out <empty directory> [--zone Europe/Berlin] [--seed 7] [--limit 1000]
// Output: <out>/logs/synthetic-demo-run/synthetic-demo-window/exthost/kiro.kiroAgent/q-client.log
import {mkdirSync,writeFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';

const args=process.argv.slice(2);
const flag=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
if(!flag('--out')){process.stdout.write('usage: node scripts/demo/generate-demo-month.mjs --out <empty directory> [--zone <IANA zone>] [--seed <n>] [--limit <credits>]\n');process.exit(1);}
if(args.includes('--out')&&String(flag('--out')).startsWith('--')){process.stdout.write('OUT_INVALID\n');process.exit(1);}
const out=resolve(flag('--out')),zone=flag('--zone')??'Europe/Berlin';
try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();}catch{process.stdout.write('ZONE_INVALID\n');process.exit(1);}
let seed=Number(flag('--seed')??7)>>>0;
if(existsSync(out)&&!statSync(out).isDirectory()){process.stdout.write('OUT_INVALID\n');process.exit(1);}
if(existsSync(out)&&readdirSync(out).length){process.stdout.write('OUT_NOT_EMPTY\n');process.exit(1);}
// Small deterministic PRNG (mulberry32) so the demo is reproducible.
const rand=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
const between=(a,b)=>a+(b-a)*rand();

const now=Date.now(),end=now-10*60000; // last snapshot ten minutes ago, never in the future
const nowDate=new Date(now);
const cycleStart=Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth(),1); // current cycle begins on the 1st, 00:00Z
const prevStart=Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth()-1,1);
const LIMITS=['50','1000','2000','5000','10000'];
if(flag('--limit')!==undefined&&!LIMITS.includes(String(flag('--limit')))){process.stdout.write('LIMIT_INVALID\n');process.exit(1);}
const LIMIT=Number(flag('--limit')??1000); // reported credit limit; the invented consumption does not depend on it

const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const wall=ms=>{const p=Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.000`;};
const offsetHours=ms=>{const p=Object.fromEntries(fmt.formatToParts(new Date(ms+43200000)).map(x=>[x.type,x.value]));return (Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-(ms+43200000))/3600000;};
const dow=ms=>new Date(ms).getUTCDay();

// Daily consumption plan: weekdays vary, two heavy agent days per cycle, quiet weekends, a couple of days off.
function plan(start,stop){
 const days=[];
 for(let d=start;d<stop;d+=86400000){
  const wd=dow(d),weekend=wd===0||wd===6;
  let credits=weekend?between(0,9):between(24,58);
  if(!weekend&&rand()<0.09)credits=between(0,4);          // day off / meetings
  days.push({day:d,credits});
 }
 for(const i of [5,9].map(k=>Math.min(days.length-1,k+Math.floor(rand()*8)))) if(!(dow(days[i].day)%6===0))days[i].credits=between(120,170); // heavy agent sessions
 return days;
}
const lines=[];
const record=(ms,usage,reset)=>{
 const body={commandName:'GetUsageLimitsCommand',input:{syntheticIgnored:'SYNTHETIC_DEMO_INPUT_NOT_REAL'},output:{
  nextDateReset:reset,usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',displayName:'Credit',displayNamePlural:'Credits',
   currentUsage:Math.floor(usage),currentUsageWithPrecision:Number(usage.toFixed(2)),usageLimit:LIMIT,usageLimitWithPrecision:LIMIT,
   currentOverages:0,currentOveragesWithPrecision:0,overageCap:0,overageCapWithPrecision:0,overageCharges:0,overageRate:0.04,currency:'USD',
   nextDateReset:reset,bonuses:[],overageCredits:[]}],userInfo:{userId:'synthetic-demo-user-not-real'}},
  metadata:{httpStatusCode:200,requestId:'synthetic-demo-request-not-real'}};
 lines.push(`${wall(ms)} [info] synthetic-envelope ${JSON.stringify(body)}`);
};
function cycle(start,stop,scale){
 const reset=new Date(Date.UTC(new Date(start).getUTCFullYear(),new Date(start).getUTCMonth()+1,1)).toISOString().replace('.000Z','Z');
 let used=0,last=0; // the cumulative counter never decreases inside a cycle
 const days=plan(start,stop);
 const first=start+Math.floor(between(8,12)*3600000);
 if(first<=end)record(first,0.3,reset); // first look in the new cycle, never in the future
 for(const {day,credits} of days){
  const target=credits*scale;
  if(day>=end)break;
  // 3-6 observations during working hours (local), each shows the cumulative counter of that moment.
  const n=credits<5?1:3+Math.floor(rand()*4);
  let spent=0;
  for(let i=0;i<n;i++){
   const hour=9+(10*(i+1)/n)+between(-0.4,0.4); // local hours 9..19, in UTC approximation by zone offset below
   const ms=day+Math.floor((hour-offsetHours(day))*3600000); // place local working hours using the zone's UTC offset that day
   if(ms>end||ms<start)continue;
   spent=target*((i+1)/n)*between(0.9,1.05);
   last=Math.max(last+0.01,Math.min(used+spent,LIMIT*1.15));
   record(ms,last,reset);
  }
  used=Math.max(Math.min(used+target,LIMIT*1.15),last);
 }
 return used;
}
cycle(prevStart,cycleStart,0.92);   // a complete cycle, ends at the reset
cycle(cycleStart,end,1.1);          // the current cycle, a little busier
lines.sort();
const dir=join(out,'logs','synthetic-demo-run','synthetic-demo-window','exthost','kiro.kiroAgent');
mkdirSync(dir,{recursive:true});
writeFileSync(join(dir,'q-client.log'),lines.join('\n')+'\n',{mode:0o600});
writeFileSync(join(out,'README-SYNTHETIC-DEMO.txt'),'SYNTHETIC DEMO DATA. Invented by scripts/demo/generate-demo-month.mjs. Not real usage, not real accounts.\n',{mode:0o600});
process.stdout.write(JSON.stringify({schema:'ekg-demo-generator.1',records:lines.length,zone_origin:flag('--zone')?'argument':'default'})+'\n');
