import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/**
 * True when `metaUrl` is the script node was started with. Both sides are resolved through the file
 * system, so a symlinked or junctioned path cannot make a release gate silently run nothing.
 */
export function isMain(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
 if (!argv1) return false;
 try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
