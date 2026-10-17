// Chooses the parent folder for the synthetic demo. Pure helper so it can be unit-tested.
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// macOS limits Unix socket paths to 103 bytes; keep a margin below that for Kiro's IPC socket names.
export const SOCKET_PATH_BUDGET = 100;
const MKDTEMP_TEMPLATE = 'synthetic-cyclegauge-demo-XXXXXX';

export function demoParentDir({
 platform = process.platform,
 tmp = tmpdir(),
 realpath = (path) => realpathSync.native(path),
} = {}) {
 if (platform !== 'darwin') return tmp;
 const socketPath = join(realpath(tmp), MKDTEMP_TEMPLATE, 'user-data', '1.000-main.sock');
 if (socketPath.length <= SOCKET_PATH_BUDGET) return tmp;
 return realpath('/tmp');
}
