import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

// Windows PowerShell 5.1 exposes the .NET Framework CreateDirectory(path, security)
// overload: the private DACL is applied at creation, never after writing data.
// Paths travel as environment data, never as interpolated PowerShell source.
// No SIDs, ACLs, paths or child-process diagnostics cross this boundary.
const script = String.raw`
$ErrorActionPreference = 'Stop'
try {
 $p = $env:CYCLEGAUGE_ACL_PATH
 $directory = $env:CYCLEGAUGE_ACL_DIRECTORY -eq '1'
 $volume = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($p))
 if ($volume.DriveType -ne 'Fixed' -or $volume.DriveFormat -ne 'NTFS') { exit 1 }
 $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
 $cursor = $p
 while ($cursor) {
  if ([System.IO.File]::Exists($cursor) -or [System.IO.Directory]::Exists($cursor)) {
   if (([System.IO.File]::GetAttributes($cursor) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }
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
 if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]) -ne $sid) { exit 1 }
 if ($directory -and !$acl.AreAccessRulesProtected) { exit 1 }
 $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
 if ($rules.Count -ne 1) { exit 1 }
 $rule = $rules[0]
 if ($rule.IdentityReference -ne $sid -or $rule.AccessControlType -ne 'Allow' -or
     $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
     $rule.PropagationFlags -ne 'None') { exit 1 }
 if ($directory -and ([int]$rule.InheritanceFlags -ne 3 -or $rule.IsInherited)) { exit 1 }
 exit 0
} catch { exit 1 }
`;

export function windowsStorageAccess(path: string, directory = false): void {
 // Remote shares and device namespaces have not established local NTFS semantics.
 if (!/^[a-z]:\\/i.test(path)) throw new Error('UNSAFE_STORAGE');
 const systemRoot = process.env.SystemRoot;
 if (!systemRoot || !isAbsolute(systemRoot)) throw new Error('UNSAFE_STORAGE');
 const result = spawnSync(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
   env: { ...process.env, CYCLEGAUGE_ACL_PATH: path, CYCLEGAUGE_ACL_DIRECTORY: directory ? '1' : '0' },
   windowsHide: true, stdio: 'ignore', timeout: 10_000,
  });
 if (result.error || result.signal || result.status !== 0) throw new Error('UNSAFE_STORAGE');
}
