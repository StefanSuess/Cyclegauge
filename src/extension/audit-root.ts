import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { inside } from '../paths.ts';
import { PRUNE } from '../audit/walk.ts';
// Folders that must never be audited: broad roots and anything holding Kiro's or Cyclegauge's own data. No vscode import.
// The caller passes every spelling it knows (as given and symlink-resolved) of the root and of each protected path; the
// folder is refused when ANY spelling of the root overlaps ANY spelling of a protected path.
// Returns a short fixed reason, or undefined when the folder may be audited.
export function refusal(roots: string[], kiroData: string[], ownStorage: string[], home: string | string[] = homedir()): string | undefined {
 const ci = process.platform === 'darwin' || process.platform === 'win32';
 const fold = (p: string) => ci ? resolve(p).toLowerCase() : resolve(p);
 const rs = roots.map(fold), homes = (Array.isArray(home) ? home : [home]).map(fold);
 const related = (list: string[]) => list.some(other => other !== '' && rs.some(r => inside(r, fold(other)) || inside(fold(other), r)));
 if (rs.some(r => dirname(r) === r)) return 'it is the filesystem root';
 if (rs.some(r => homes.some(h => inside(h, r)))) return 'it is your home folder or contains it';
 if (related(kiroData)) return 'it overlaps Kiro data';
 if (related(ownStorage)) return 'it overlaps Cyclegauge storage';
 const segments = rs.flatMap(r => r.split(/[\\/]/));
 if (segments.some(s => s.toLowerCase() === '.kiro')) return 'it is inside a .kiro folder';
 if (segments.some(s => PRUNE.has(s.toLowerCase()) || (ci ? s.toLowerCase() : s) === 'kiro-cli')) return 'it is inside a folder that is never audited';
 return undefined;
}

// Shared guard for both the filename audit and the separate configuration review. Resolve protected aliases as well as
// the chosen folder, before any scan. The caller supplies its current configured paths; no editor API or contents read.
export function folderCheck(chosen: string, kiroData: string[], ownStorage: string[]): { chosen: string; resolved: string } | { reason: string } {
 const forms = (path: string): string[] => { if (path === '') return []; try { const real = realpathSync.native(path); return real === path ? [path] : [path, real]; } catch { return [path]; } };
 let resolved: string | undefined;
 try { resolved = realpathSync.native(chosen); } catch { /* refused below */ }
 const reason = resolved === undefined ? 'its real location could not be resolved'
  : refusal([chosen, resolved], kiroData.flatMap(forms), ownStorage.flatMap(forms), forms(homedir()));
 return reason || resolved === undefined ? { reason: reason ?? 'its real location could not be resolved' } : { chosen, resolved };
}
