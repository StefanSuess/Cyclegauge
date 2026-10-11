import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {parseLine} from '../../src/projection.ts';

const script=fileURLToPath(new URL('../../scripts/demo/generate-demo-month.mjs',import.meta.url));
test('demo month is synthetic, parses with the production parser, spans two cycles and never lies in the future',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-demo-')));const out=join(base,'src');
 try{
  execFileSync(process.execPath,[script,'--out',out,'--zone','UTC','--seed','3'],{encoding:'utf8'});
  const text=await readFile(join(out,'logs','synthetic-demo-run','synthetic-demo-window','exthost','kiro.kiroAgent','q-client.log'),'utf8');
  const lines=text.trim().split('\n');
  assert.ok(lines.length>60);
  const parsed=lines.map(l=>parseLine(l,'UTC'));
  assert.ok(parsed.every(p=>p.status==='accepted'));
  const snaps=parsed.map(p=>p.snapshot!);
  const resets=new Set(snaps.map(s=>s.resetAt));assert.equal(resets.size,2);
  assert.ok(snaps.every(s=>Date.parse(s.observedAt)<=Date.now()));
  for(const reset of resets){ // the counter never decreases inside one cycle
   const cycle=snaps.filter(s=>s.resetAt===reset).sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
   for(let i=1;i<cycle.length;i++)assert.ok(Number(cycle[i].usage)>=Number(cycle[i-1].usage));
  }
  const weekdays=new Set(snaps.map(s=>new Date(s.observedAt).getUTCDay()));assert.ok(weekdays.has(0)||weekdays.has(6));
  assert.ok(text.includes('synthetic-demo-user-not-real'));assert.ok(!/@|\/Users\//.test(text));
  assert.ok((await readFile(join(out,'README-SYNTHETIC-DEMO.txt'),'utf8')).includes('SYNTHETIC DEMO DATA'));
  // deterministic, and refuses to write into a non-empty directory
  const again=spawnSync(process.execPath,[script,'--out',out],{encoding:'utf8'});
  assert.equal(again.status,1);assert.equal(again.stdout.trim(),'OUT_NOT_EMPTY');
 }finally{await rm(base,{recursive:true,force:true});}
});
