import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../../src/store.ts';
import { parseLine } from '../../src/projection.ts';
import { windowsStorageCheck } from '../../src/windows-storage.ts';

const windows = { skip: process.platform !== 'win32' ? 'Windows DACL enforcement requires Windows' : false };
function fixture(t: { after(fn: () => void): void; skip(message?: string): void }) {
 const base = mkdtempSync(join(tmpdir(), 'synthetic-acl-'));
 t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
 return { base, source: join(base, 'source'), storage: join(base, "owned ü ' space") };
}
// .NET calls only: Windows PowerShell cannot autoload cmdlet modules when started from PowerShell 7.
// Mutate only invented temporary storage. Never print a path, SID, ACL or child-process error.
function acl(path: string, command: string): void {
 const result = spawnSync(join(process.env.SystemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; try { $p=$env:SYNTHETIC_ACL_PATH; ${command} } catch { exit 1 }`],
  { env: { ...process.env, SYNTHETIC_ACL_PATH: path }, stdio: 'ignore' });
 assert.equal(result.status, 0, 'synthetic ACL setup failed');
}
test('Windows verifies a created directory and the files this process writes into it', windows, t => {
 const f = fixture(t);
 assert.equal(windowsStorageCheck(f.storage, true), 0);
 const file = join(f.storage, 'synthetic-file'); writeFileSync(file, 'synthetic');
 // Fixed codes only: 4 means the owner is neither the user nor this process's default owner.
 assert.equal(windowsStorageCheck(file), 0);
});
test('Windows creates an owner-only inheritable DACL and persists across restarts', windows, t => {
 const f = fixture(t); let store = new Store(f.storage, f.source);
 const record = parseLine('2030-01-01T00:00:00Z [info] synthetic {"commandName":"GetUsageLimitsCommand","output":{"userInfo":{"userId":"synthetic-windows"},"nextDateReset":"2030-02-01T00:00:00Z","usageBreakdownList":[{"resourceType":"CREDIT","currentUsageWithPrecision":1.25,"usageLimitWithPrecision":100}]},"metadata":{"httpStatusCode":200}}', 'UTC');
 assert.equal(record.status, 'accepted');
 store.transaction(() => store.insert(record.snapshot!, record.identity, 'synthetic-source', '2030-01-01T00:00:01Z'));
 store.close(); store = new Store(f.storage, f.source);
 assert.equal(store.snapshots()[0].usage, '1.25'); store.close();
 acl(f.storage, `$a=[System.IO.Directory]::GetAccessControl($p); $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; if (!$a.AreAccessRulesProtected -or $a.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $sid) {exit 2}; $r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])); if ($r.Count -ne 1 -or $r[0].IdentityReference -ne $sid -or [int]$r[0].InheritanceFlags -ne 3) {exit 3}`);
 const bytes = readFileSync(join(f.storage, 'usage.sqlite'));
 assert.equal(bytes.includes('synthetic-windows'), false);
});
test('Windows rejects inherited permissive storage without creating sensitive files', windows, t => {
 const f = fixture(t); mkdirSync(f.storage);
 // 5 inheriting directory; 4 when an elevated process's default owner is not the user.
 assert.ok([4, 5].includes(windowsStorageCheck(f.storage, true)));
 assert.throws(() => new Store(f.storage, f.source), /^Error: UNSAFE_STORAGE$/);
 assert.equal(existsSync(join(f.storage, 'device.key')), false);
});
for (const name of ['device.key', 'usage.sqlite', 'usage.sqlite-journal', 'usage.sqlite-wal', 'usage.sqlite-shm']) {
 test(`Windows rejects an additional read ACE on ${name} without repairing it`, windows, t => {
  const f = fixture(t); new Store(f.storage, f.source).close();
  const file = join(f.storage, name); if (!existsSync(file)) writeFileSync(file, 'synthetic');
  const before = readFileSync(file);
  acl(file, `$a=[System.IO.File]::GetAccessControl($p); $a.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow')); [System.IO.File]::SetAccessControl($p,$a)`);
  assert.equal(windowsStorageCheck(file), 6);
  assert.throws(() => new Store(f.storage, f.source), /^Error: UNSAFE_STORAGE$/);
  assert.deepEqual(readFileSync(file), before);
  acl(file, `$a=[System.IO.File]::GetAccessControl($p); if (@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object {$_.IdentityReference.Value -eq 'S-1-1-0'}).Count -ne 1) {exit 2}`);
 });
}
test('Windows rejects a file owned by another principal', windows, t => {
 const f = fixture(t); new Store(f.storage, f.source).close();
 const file = join(f.storage, 'device.key');
 // LocalService is neither the user nor an elevated default owner; setting it needs an elevated runner.
 const result = spawnSync(join(process.env.SystemRoot!, 'System32', 'icacls.exe'), [file, '/setowner', '*S-1-5-19'], { stdio: 'ignore' });
 if (result.status !== 0) return t.skip('changing a file owner requires elevation');
 assert.equal(windowsStorageCheck(file), 4);
 assert.throws(() => new Store(f.storage, f.source), /^Error: UNSAFE_STORAGE$/);
});
test('Windows rejects hard-linked keys and directory junctions', windows, t => {
 const f = fixture(t); new Store(f.storage, f.source).close();
 linkSync(join(f.storage, 'device.key'), join(f.base, 'synthetic-hardlink'));
 assert.throws(() => new Store(f.storage, f.source), /UNSAFE_STORAGE/);
 symlinkSync(f.storage, join(f.base, 'synthetic-junction'), 'junction');
 assert.equal(windowsStorageCheck(join(f.base, 'synthetic-junction'), true), 3);
 assert.throws(() => new Store(join(f.base, 'synthetic-junction'), f.source), /UNSAFE_STORAGE/);
});
