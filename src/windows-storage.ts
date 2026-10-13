import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

// Windows PowerShell 5.1 exposes the .NET Framework CreateDirectory(path, security)
// overload: the private DACL is applied at creation, never after writing data.
// Paths travel as environment data, never as interpolated PowerShell source.
// No SIDs, ACLs, paths or child-process diagnostics cross this boundary: only a fixed exit code.
// 0 verified, 1 unavailable, 2 volume, 3 reparse point, 4 owner, 5 inheriting directory,
// 6 access entry count, 7 access entry content, 8 directory inheritance flags.
const script = String.raw`
$ErrorActionPreference = 'Stop'
try {
 $p = $env:CYCLEGAUGE_ACL_PATH
 $directory = $env:CYCLEGAUGE_ACL_DIRECTORY -eq '1'
 $volume = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($p))
 if ($volume.DriveType -ne 'Fixed' -or $volume.DriveFormat -ne 'NTFS') { exit 2 }
 $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
 $cursor = $p
 while ($cursor) {
  if ([System.IO.File]::Exists($cursor) -or [System.IO.Directory]::Exists($cursor)) {
   if (([System.IO.File]::GetAttributes($cursor) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 3 }
  }
  $cursor = [System.IO.Path]::GetDirectoryName($cursor)
 }
 if ($directory -and ![System.IO.Directory]::Exists($p)) {
  $security = [System.Security.AccessControl.DirectorySecurity]::new()
  $security.SetOwner($sid)
  $security.SetAccessRuleProtection($true, $false)
  $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
   $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
  [void][System.IO.Directory]::CreateDirectory($p, $security)
 }
 if ($directory) { $acl = [System.IO.Directory]::GetAccessControl($p) }
 else { $acl = [System.IO.File]::GetAccessControl($p) }
 if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $sid) { exit 4 }
 if ($directory -and !$acl.AreAccessRulesProtected) { exit 5 }
 # The raw list also counts entries that GetAccessRules cannot represent.
 $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorSddlForm('Access'))
 if ($null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -ne 1) { exit 6 }
 $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
 if ($rules.Count -ne 1) { exit 6 }
 $rule = $rules[0]
 if ($rule.IdentityReference -ne $sid -or $rule.AccessControlType -ne 'Allow' -or
     $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
     $rule.PropagationFlags -ne 'None') { exit 7 }
 if ($directory -and ([int]$rule.InheritanceFlags -ne 3 -or $rule.IsInherited)) { exit 8 }
 exit 0
} catch { exit 1 }
`;

/** Fixed check code (see above); never a path, SID, ACL or child-process message. */
export function windowsStorageCheck(path: string, directory = false): number {
 // Remote shares and device namespaces have not established local NTFS semantics.
 if (!/^[a-z]:\\/i.test(path)) return 2;
 const systemRoot = process.env.SystemRoot;
 if (!systemRoot || !isAbsolute(systemRoot)) return 1;
 const result = spawnSync(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
   env: { ...process.env, CYCLEGAUGE_ACL_PATH: path, CYCLEGAUGE_ACL_DIRECTORY: directory ? '1' : '0' },
   windowsHide: true, stdio: 'ignore', timeout: 10_000,
  });
 return result.error || result.signal || typeof result.status !== 'number' ? 1 : result.status;
}
export function windowsStorageAccess(path: string, directory = false): void {
 if (windowsStorageCheck(path, directory) !== 0) throw new Error('UNSAFE_STORAGE');
}
