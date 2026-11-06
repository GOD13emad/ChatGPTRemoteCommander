import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const fail = code => { throw new Error(code); };
const SID = /^S-1-[0-9]+(?:-[0-9]+)+$/;
// Same admission policy as the native Linux reader. A root-owned sticky /tmp
// may be shared; other group/world-writable ancestors are not safe anchors.
export function companionSafePosixAncestor({ mode, uid }) {
  if (!Number.isSafeInteger(mode) || mode < 0 || !Number.isSafeInteger(uid) || uid < 0) return false;
  return !(mode & 0o022) || (uid === 0 && Boolean(mode & 0o1000));
}
export function evaluateCompanionAcl(observation, expectedPath) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)
    || Object.keys(observation).sort().join(',') !== 'currentSid,ownerSid,path,rules,sddl'
    || typeof observation.path !== 'string' || path.win32.normalize(observation.path).toLowerCase() !== path.win32.normalize(expectedPath).toLowerCase()
    || !SID.test(observation.currentSid) || observation.ownerSid !== observation.currentSid
    || typeof observation.sddl !== 'string' || observation.sddl.length < 8 || observation.sddl.length > 32768
    || !Array.isArray(observation.rules) || !observation.rules.length || observation.rules.length > 256) fail('COMPANION_ACL_INVALID');
  const trusted = new Set([observation.currentSid, 'S-1-5-18', 'S-1-5-32-544']);
  let currentAllowed = false;
  for (const rule of observation.rules) {
    if (!rule || typeof rule !== 'object' || Object.keys(rule).sort().join(',') !== 'access,rights,sid'
      || !SID.test(rule.sid) || !['Allow', 'Deny'].includes(rule.access)
      || !Number.isSafeInteger(rule.rights) || rule.rights < 0) fail('COMPANION_ACL_RULE_INVALID');
    // Be conservative: broad allow rules are rejected even if a deny may cancel
    // them. This is a privacy check, not a general effective-access calculator.
    if (rule.access === 'Allow' && rule.rights > 0 && !trusted.has(rule.sid)) fail('COMPANION_DIRECTORY_NOT_PRIVATE');
    if (rule.access === 'Allow' && rule.sid === observation.currentSid && (rule.rights & 3) === 3) currentAllowed = true;
  }
  if (!currentAllowed) fail('COMPANION_OWNER_ACCESS_UNPROVEN');
  return { private: true, ownerSid: observation.ownerSid,
    aclSha256: createHash('sha256').update(observation.sddl).digest('hex') };
}

const aclScript = String.raw`
$ErrorActionPreference='Stop'
$taskPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RC_COMPANION_PATH_B64))
$taskItem=Get-Item -LiteralPath $taskPath -Force
$taskWantDirectory=$env:RC_COMPANION_KIND -eq 'directory'
if($taskItem.PSIsContainer -ne $taskWantDirectory -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Type or reparse-point guard'}
$taskAcl=Get-Acl -LiteralPath $taskItem.FullName
$taskOwner=$taskAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
$taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskRules=@($taskAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object {
  @{sid=$_.IdentityReference.Value;access=$_.AccessControlType.ToString();rights=[int64]$_.FileSystemRights}
})
@{path=$taskItem.FullName;ownerSid=$taskOwner;currentSid=$taskSid;sddl=$taskAcl.Sddl;rules=$taskRules} | ConvertTo-Json -Depth 5 -Compress
`;

/** A read-only OS proof. No Set-Acl, elevation, profile read, or UI is used. */
function proveCompanionPrivatePath(directory, kind) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('COMPANION_PRIVATE_DIRECTORY_REQUIRED');
  if (directory !== path.resolve(directory) || directory === path.parse(directory).root
    || /^(?:\\\\|\/\/)/.test(directory) || /[\x00-\x1f\x7f]/.test(directory)) fail('COMPANION_DIRECTORY_ALIAS');
  let ancestor = path.parse(directory).root;
  for (const part of directory.slice(ancestor.length).split(path.sep).filter(Boolean)) {
    ancestor = path.join(ancestor, part);
    const node = fs.lstatSync(ancestor);
    if (node.isSymbolicLink() || (ancestor === directory && kind === 'file' ? !node.isFile() : !node.isDirectory())) fail('COMPANION_DIRECTORY_ALIAS');
    if (process.platform !== 'win32' && node.isDirectory() && !companionSafePosixAncestor(node)) fail('COMPANION_PROFILE_ROOT_UNSAFE');
  }
  const real = fs.realpathSync.native(directory);
  const before = fs.lstatSync(real, { bigint: true });
  if ((kind === 'file' ? !before.isFile() || before.nlink !== 1n : !before.isDirectory()) || before.isSymbolicLink()) fail('COMPANION_DIRECTORY_ALIAS');
  if (process.platform !== 'win32') {
    if (before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n) fail('COMPANION_DIRECTORY_NOT_PRIVATE');
    return { private: true, path: real, dev: before.dev.toString(), ino: before.ino.toString(), aclSha256: null };
  }
  const run = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', aclScript], {
    env: { ...process.env, RC_COMPANION_PATH_B64: Buffer.from(real).toString('base64'), RC_COMPANION_KIND: kind },
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 65536
  });
  if (run.error || run.signal || run.status !== 0 || run.stderr.trim()) fail('COMPANION_PRIVATE_ACL_UNPROVEN');
  let observation;
  try { observation = JSON.parse(run.stdout); } catch { fail('COMPANION_PRIVATE_ACL_UNPROVEN'); }
  const proof = evaluateCompanionAcl(observation, real);
  const after = fs.lstatSync(real, { bigint: true });
  if (after.dev !== before.dev || after.ino !== before.ino) fail('COMPANION_DIRECTORY_DRIFT');
  return { ...proof, path: real, dev: after.dev.toString(), ino: after.ino.toString() };
}

export const proveCompanionPrivateDirectory = directory => proveCompanionPrivatePath(directory, 'directory');
export const proveCompanionPrivateFile = filePath => proveCompanionPrivatePath(filePath, 'file');

/** Constructor-only writer capability; never populated from an MCP argument. */
export function verifyCompanionPrivateDirectory({ directory, dev, ino }) {
  const proof = proveCompanionPrivateDirectory(directory);
  if (proof.dev !== dev || proof.ino !== ino || proof.path !== directory || !proof.aclSha256) fail('COMPANION_DIRECTORY_DRIFT');
  return { directory, dev, ino, ownerVerified: true, privatePermissionsVerified: true,
    observedAtEpochMs: Date.now(), descriptorSha256: proof.aclSha256 };
}

export function verifyCompanionPrivateFile({ filePath, dev, ino }) {
  const proof = proveCompanionPrivateFile(filePath);
  if (proof.dev !== dev || proof.ino !== ino || proof.path !== filePath || !proof.aclSha256) fail('COMPANION_FILE_DRIFT');
  return { filePath, dev, ino, ownerVerified: true, privatePermissionsVerified: true,
    observedAtEpochMs: Date.now(), descriptorSha256: proof.aclSha256 };
}
