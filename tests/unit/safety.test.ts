import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, chmod, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../src/store.ts';
import { collect } from '../../src/collector.ts';
import { parseLine } from '../../src/projection.ts';
import { readLog } from '../../src/source.ts';
import { view } from '../../src/view.ts';
async function setup() {
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-safety-')); const root = join(base, 'source');
 const dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent'); await mkdir(dir, {recursive:true});
 return {base, root, dir, file:join(dir,'q-client.log'), storage:join(base,'gauge')};
}
const envelope = (usage = '1.25') => `2030-06-29 18:00:00.000 [info] synthetic {"commandName":"GetUsageLimitsCommand","output":{"userInfo":{"userId":"synthetic-private"},"usageBreakdownList":[{"resourceType":"CREDIT","currentUsageWithPrecision":${usage},"usageLimitWithPrecision":100}],"nextDateReset":"2030-07-01T00:00:00Z"},"metadata":{"httpStatusCode":200}}`;
test('same-size in-place replacement is reread and recorded as source change', async () => {
 const f = await setup(); const s = new Store(f.storage, f.root);
 await writeFile(f.file, envelope('1.25') + '\n'); await collect(f.root,s,'UTC');
 await writeFile(f.file, envelope('2.25') + '\n'); const r = await collect(f.root,s,'UTC');
 assert.equal(r.imported,1); assert.equal(r.codes.source_changed,1); assert.equal(view(s.snapshots(),'2030-06-29T18:00:00Z').status,'conflicting_snapshots');
 s.close(); await rm(f.base,{recursive:true});
});
test('invalid UTF-8 never produces a fabricated identity or observation', async () => {
 const f = await setup(); const data = Buffer.from(envelope() + '\n'); const position = data.indexOf('synthetic-private'); data[position] = 0xff;
 await writeFile(f.file,data); const r = await readLog(f.file,'UTC'); assert.equal(r.records.length,0); assert.equal(r.codes.malformed_record,1);
 await rm(f.base,{recursive:true});
});
test('store transaction rolls back checkpoint and billing observations together', async () => {
 const f = await setup(); const s = new Store(f.storage,f.root); const r = parseLine(envelope(),'UTC');
 assert.throws(() => s.transaction(() => {s.insert(r.snapshot!,r.identity,'synthetic-source','2030-06-29T18:00:01Z'); s.checkpoint('synthetic-source','synthetic-fingerprint',12); throw new Error('SYNTHETIC_SECRET');}), /STORAGE_UNAVAILABLE/);
 assert.equal(s.snapshots().length,0); assert.equal(s.checkpoint('synthetic-source','synthetic-new',12),false);
 s.close(); await rm(f.base,{recursive:true});
});
test('read-only source directory gains no sidecars; POSIX storage is owner-only', async () => {
 const f = await setup(); await writeFile(f.file,envelope()+'\n'); await chmod(f.file,0o400); await chmod(f.dir,0o500);
 const before = await stat(f.dir); const s = new Store(f.storage,f.root); assert.equal((await collect(f.root,s,'UTC')).imported,1); s.close();
 assert.equal((await stat(f.dir)).mtimeMs,before.mtimeMs); assert.deepEqual(await readdir(f.dir),['q-client.log']);
 // Mode bits are POSIX; Windows DACLs are asserted in windows-storage.test.ts.
 if (process.platform !== 'win32') {
  assert.equal((await stat(f.storage)).mode & 0o777,0o700);
  for (const file of ['device.key','usage.sqlite']) assert.equal((await stat(join(f.storage,file))).mode & 0o777,0o600);
 }
 await chmod(f.file,0o600); await chmod(f.dir,0o700); await rm(f.base,{recursive:true});
});
test('corrupted persisted projection fails closed without leaking stored text', async () => {
 const f = await setup(); await writeFile(f.file,envelope()+'\n'); const s = new Store(f.storage,f.root); await collect(f.root,s,'UTC'); s.close();
 const db = new DatabaseSync(join(f.storage,'usage.sqlite')); db.prepare('UPDATE snapshots SET body=?').run('{"usage":"SYNTHETIC_SECRET_DO_NOT_PRINT"}'); db.close();
 const reader = new Store(f.storage,f.root); assert.throws(()=>reader.snapshots(),/STORAGE_UNAVAILABLE/); reader.close();
 const cli = spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',resolve('src/cli.ts'),'--source-root',f.root,'--store-dir',f.storage,'--source-timezone','UTC'],{encoding:'utf8'});
 assert.equal(cli.status,1); assert.equal(cli.stdout.trim(),'STORAGE_UNAVAILABLE'); assert.equal(cli.stderr,'');
 await rm(f.base,{recursive:true});
});
test('invalid/unsafe store emits only fixed CLI failure codes', async () => {
 const f = await setup(); await mkdir(f.storage,{mode:0o755});
 const r = spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',resolve('src/cli.ts'),'--source-root',f.root,'--store-dir',f.storage],{encoding:'utf8'});
 assert.equal(r.status,1); assert.equal(r.stdout.trim(),'STORAGE_UNAVAILABLE'); assert.equal(r.stderr,''); await rm(f.base,{recursive:true});
});
test('unknown fields never reach SQLite files, even in persistent keys', async () => {
 const f=await setup(); await writeFile(f.file,envelope().replace('"userInfo"','"prompt":"SYNTHETIC_PROMPT_PRIVATE","userInfo"')+'\n');
 const s=new Store(f.storage,f.root);await collect(f.root,s,'UTC');s.close();
 const bytes=await readFile(join(f.storage,'usage.sqlite'));
 for(const marker of ['synthetic-private','SYNTHETIC_PROMPT_PRIVATE',f.root])assert.ok(!bytes.includes(Buffer.from(marker)));
 await rm(f.base,{recursive:true});
});
test('concurrent source writes discard the unstable read without importing projections', async () => {
 const f = await setup(); await writeFile(f.file,(envelope()+'\n').repeat(3000));
 const { open } = await import('node:fs/promises'); const writer=await open(f.file,'r+'); let running=true;
 const writes=(async()=>{while(running){await writer.write(Buffer.from('2'),0,1,10);}})();
 const r=await readLog(f.file,'UTC'); running=false;await writes;await writer.close();
 assert.equal(r.records.length,0);assert.equal(r.codes.source_unstable,1);await rm(f.base,{recursive:true});
});
test('independent store connections serialize and deduplicate shared imports', async () => {
 const f=await setup();await writeFile(f.file,envelope()+'\n');const a=new Store(f.storage,f.root),b=new Store(f.storage,f.root);
 const results=await Promise.all([collect(f.root,a,'UTC'),collect(f.root,b,'UTC')]);
 assert.equal(results.reduce((n,r)=>n+r.imported,0),1);assert.equal(a.snapshots().length,1);
 a.close();b.close();await rm(f.base,{recursive:true});
});
test('absent source produces unavailable evidence rather than zero usage', async () => {
 const f=await setup();const s=new Store(f.storage,f.root);await rm(join(f.root,'logs'),{recursive:true});
 const r=await collect(f.root,s,'UTC');assert.equal(r.codes.source_unavailable,1);assert.equal(view(s.snapshots()).usage,null);s.close();await rm(f.base,{recursive:true});
});
test('imports the existing wholly synthetic fixture with original observations and reset gap', async () => {
 const f=await setup();await writeFile(f.file,await readFile('tests/fixtures/kiro/account-snapshots.log'));
 const s=new Store(f.storage,f.root);const r=await collect(f.root,s,'Europe/Berlin','2030-07-02T10:01:00Z');
 assert.equal(r.imported,3);assert.equal(r.duplicates,1);
 const v=view(s.snapshots(),'2030-07-02T10:01:00Z');assert.equal(v.usage,'0.8');assert.equal(v.observedAt,'2030-07-02T10:00:00.000Z');assert.equal(v.interval.status,'cycle_change_observed');assert.equal(v.interval.netChange,null);assert.equal(v.dailyConsumption,null);
 s.close();await rm(f.base,{recursive:true});
});
test('dot-prefixed source descendants cannot be used as owned storage', async()=>{
 const f=await setup();assert.throws(()=>new Store(join(f.root,'..gauge'),f.root),/UNSAFE_STORAGE/);
 await assert.rejects(stat(join(f.root,'..gauge')));await rm(f.base,{recursive:true});
});
test('corrupted timezone on an explicit-offset observation fails private output projection', async()=>{
 const f=await setup();await writeFile(f.file,envelope().replace('2030-06-29 18:00:00.000','2030-06-29T18:00:00.000Z')+'\n');
 const s=new Store(f.storage,f.root);await collect(f.root,s,'UTC');s.close();
 const db=new DatabaseSync(join(f.storage,'usage.sqlite'));const row=db.prepare('SELECT body FROM snapshots').get()!;
 const body=JSON.parse(row.body as string);body.sourceTimezone='SYNTHETIC_PRIVATE_SENTINEL';db.prepare('UPDATE snapshots SET body=?').run(JSON.stringify(body));db.close();
 const reader=new Store(f.storage,f.root);assert.throws(()=>reader.snapshots(),/STORAGE_UNAVAILABLE/);reader.close();
 const r=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',resolve('src/cli.ts'),'--source-root',f.root,'--store-dir',f.storage,'--json','--source-timezone','UTC'],{encoding:'utf8'});
 assert.equal(r.stdout.trim(),'STORAGE_UNAVAILABLE');assert.equal(r.status,1);assert.equal(r.stderr,'');await rm(f.base,{recursive:true});
});
test('exponent expansion cannot poison stored billing observations', async()=>{
 const f=await setup();await writeFile(f.file,envelope('1'.repeat(250)+'e100')+'\n'+envelope()+'\n');
 const s=new Store(f.storage,f.root);const r=await collect(f.root,s,'UTC');assert.equal(r.codes.invalid_billing,1);assert.equal(r.imported,1);
 assert.equal(view(s.snapshots(),'2030-06-29T18:00:00Z').usage,'1.25');s.close();await rm(f.base,{recursive:true});
});
