import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseCompanionJson } from './companion-json.mjs';
import { verifyCompanionPrivateDirectory, verifyCompanionPrivateFile } from './companion-private-directory.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const HASH = /^[a-f0-9]{64}$/, DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/;
const TEMP = /^\.commander-companion-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/;
const LOCK = '.commander-companion-export.lock';
const VERSIONS = Object.freeze({ '22.23.3': '1.51.0', '24.19.0': '1.52.1' });
export const COMPANION_CREATE_WIRE_LIMITS = Object.freeze({ maxBytes: 8192, maxDepth: 3, maxNodes: 128 });
const SUCCESS_KEYS = ['schemaVersion', 'outcome', 'requestId', 'purpose', 'basename', 'canonicalPathSha256',
  'parentCanonicalPathSha256', 'parentDev', 'parentIno', 'parentDescriptorSha256', 'filesystem', 'dev', 'ino',
  'size', 'nlink', 'regular', 'reparsePoint', 'ownerMatchesCurrentUser', 'privatePermissionsVerified',
  'descriptorSha256', 'observedAtEpochMs', 'proofOrigin', 'parentNodeTokenOwner'];
const FAILURE_KEYS = ['schemaVersion', 'outcome', 'requestId', 'phase', 'creationAttempted', 'code'];
const fold = value => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const pathHash = value => hash(fold(path.win32.normalize(value)));
function fail(code, create = null) {
  const error = Object.assign(new Error(code), { companionCode: code });
  if (create) error.companionCreate = create;
  throw error;
}
function record(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('COMPANION_CREATE_SCHEMA_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string'
    || !keys.includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)
    || Object.keys(descriptors).length !== keys.length) fail('COMPANION_CREATE_SCHEMA_INVALID');
}
export function validateCompanionCreateRequest(request) {
  record(request, ['filePath', 'directory', 'dev', 'ino', 'descriptorSha256', 'purpose']);
  const { filePath, directory, dev, ino, descriptorSha256, purpose } = request;
  if (typeof filePath !== 'string' || typeof directory !== 'string' || filePath.length > 2048 || directory.length > 2048
    || !/^[A-Za-z]:\\/.test(directory) || directory !== path.win32.resolve(directory)
    || directory === path.win32.parse(directory).root || filePath !== path.win32.join(directory, path.win32.basename(filePath))
    || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(filePath)
    || typeof dev !== 'string' || typeof ino !== 'string' || typeof descriptorSha256 !== 'string'
    || !DECIMAL.test(dev) || !DECIMAL.test(ino) || !HASH.test(descriptorSha256)) fail('COMPANION_CREATE_REQUEST_INVALID');
  const basename = path.win32.basename(filePath);
  if ((purpose === 'LOCK' && basename !== LOCK) || (purpose === 'TEMP' && !TEMP.test(basename))
    || (purpose === 'TEST_BINDING' && (basename !== 'commander-binding.json'
      || !/^rc-companion-private-test-[A-Za-z0-9]+$/.test(path.win32.basename(directory))))
    || !['LOCK', 'TEMP', 'TEST_BINDING'].includes(purpose)) fail('COMPANION_CREATE_REQUEST_INVALID');
  return { ...request, basename };
}
export function companionCreateUncertainty(filePath, purpose) {
  return { outcome: 'CreatedButOpenUncertain', reconciliationRequired: true,
    basename: path.win32.basename(filePath), purpose };
}
/** Pure production decoder shared by the creator and wire regressions. The
 * parser's node budget counts punctuation tokens, not just semantic members. */
export function decodeCompanionCreateWire(bytes) {
  const value = parseCompanionJson(bytes, COMPANION_CREATE_WIRE_LIMITS);
  const success = value?.outcome === 'CREATED_EMPTY';
  record(value, success ? SUCCESS_KEYS : FAILURE_KEYS);
  if (value.schemaVersion !== 1 || typeof value.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(value.requestId)) fail('COMPANION_CREATE_SCHEMA_INVALID');
  if (!success) {
    const known = value.outcome === 'NOT_CREATED' && value.phase === 'PREFLIGHT' && value.creationAttempted === false && value.code === 'PREFLIGHT_FAILED'
      || value.outcome === 'NOT_CREATED_COLLISION' && value.phase === 'PREFLIGHT' && value.creationAttempted === false && value.code === 'TARGET_PRESENT'
      || value.outcome === 'CreatedButOpenUncertain' && ['CREATE', 'HANDLE_PROOF', 'CLOSE'].includes(value.phase)
        && value.creationAttempted === true && value.code === 'CREATE_OUTCOME_UNCERTAIN';
    if (!known) fail('COMPANION_CREATE_SCHEMA_INVALID');
  }
  return value;
}
export function validateCompanionCreateReceipt(value, request, requestId, { now = Date.now() } = {}) {
  const expected = validateCompanionCreateRequest(request);
  record(value, SUCCESS_KEYS);
  if (value.schemaVersion !== 1 || value.outcome !== 'CREATED_EMPTY' || value.requestId !== requestId
    || !/^[a-f0-9]{32}$/.test(requestId) || value.purpose !== expected.purpose || value.basename !== expected.basename
    || value.canonicalPathSha256 !== pathHash(expected.filePath) || value.parentCanonicalPathSha256 !== pathHash(expected.directory)
    || value.parentDev !== expected.dev || value.parentIno !== expected.ino
    || value.parentDescriptorSha256 !== expected.descriptorSha256 || value.filesystem !== 'NTFS'
    || typeof value.dev !== 'string' || typeof value.ino !== 'string' || !DECIMAL.test(value.dev) || !DECIMAL.test(value.ino) || value.size !== '0' || value.nlink !== 1
    || value.regular !== true || value.reparsePoint !== false || value.ownerMatchesCurrentUser !== true
    || value.privatePermissionsVerified !== true || !HASH.test(value.descriptorSha256)
    || !Number.isSafeInteger(value.observedAtEpochMs) || value.observedAtEpochMs < 0 || !Number.isSafeInteger(now) || now < 0
    || now < value.observedAtEpochMs || now - value.observedAtEpochMs > 5000
    || value.proofOrigin !== 'ORIGINAL_CREATOR_HANDLE' || value.parentNodeTokenOwner !== 'UNPROVEN') fail('COMPANION_CREATE_RECEIPT_INVALID');
  return Object.freeze({ ...value });
}

// Side-effect free on import. This child creates no data: only a new empty file.
// .NET Create passes FileSecurity into the native creation operation. Any
// exception after the attempt is conservatively uncertain, even FILE_EXISTS.
export const companionPrivateCreateWindowsScript = String.raw`
$ErrorActionPreference='Stop'
$taskAttempted=$false;$taskStream=$null;$taskParent=$null;$taskPhase='PREFLIGHT'
$taskRequestId=$env:RC_PRIVATE_CREATE_ID
try {
 if([Environment]::Version.Major -lt 8){throw 'Runtime'}
 if(-not ([IO.FileSystemAclExtensions].GetMethods() | Where-Object {$_.Name -eq 'Create' -and $_.GetParameters().Length -eq 7})){throw 'API'}
 $taskDirectory=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RC_PRIVATE_CREATE_PARENT))
 $taskFile=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RC_PRIVATE_CREATE_PATH))
 $taskPurpose=$env:RC_PRIVATE_CREATE_PURPOSE
 if($taskDirectory.Length -gt 2048 -or $taskFile.Length -gt 2048 -or $taskDirectory -notmatch '^[A-Za-z]:\\' -or [IO.Path]::GetFullPath($taskDirectory) -cne $taskDirectory -or [IO.Path]::GetDirectoryName($taskFile) -cne $taskDirectory){throw 'Request'}
 $taskName=[IO.Path]::GetFileName($taskFile)
 if($taskPurpose -eq 'LOCK'){$taskValid=$taskName -ceq '.commander-companion-export.lock'}
 elseif($taskPurpose -eq 'TEMP'){$taskValid=$taskName -cmatch '^\.commander-companion-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$'}
 elseif($taskPurpose -eq 'TEST_BINDING'){$taskValid=$taskName -ceq 'commander-binding.json' -and [IO.Path]::GetFileName($taskDirectory) -cmatch '^rc-companion-private-test-[A-Za-z0-9]+$'}
 else{$taskValid=$false}
 if(-not $taskValid -or $taskRequestId -cnotmatch '^[a-f0-9]{32}$'){throw 'Request'}
 Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
public static class CompanionEmptyCreator {
 [StructLayout(LayoutKind.Sequential,Pack=4)] public struct Info {
  public uint Attributes; public long Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder name,uint length,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,StringBuilder label,uint labelSize,out uint serial,out uint maxName,out uint flags,StringBuilder fs,uint fsSize);
 [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(SafeFileHandle handle,uint kind,uint sections,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
 [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
 [DllImport("advapi32.dll")] static extern bool IsValidSecurityDescriptor(IntPtr descriptor);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public static string Fold(string value) { var b=new StringBuilder(); foreach(char c in value)b.Append(c>='A'&&c<='Z'?(char)(c+32):c); return b.ToString(); }
 public static string Hash(string value) { return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant(); }
 public static Info Identity(SafeFileHandle handle) { Info info;if(!GetFileInformationByHandle(handle,out info))throw new IOException("Identity"); return info; }
 public static string Dev(Info info) { return info.Volume.ToString(System.Globalization.CultureInfo.InvariantCulture); }
 public static string Ino(Info info) { return (((ulong)info.IndexHigh<<32)|info.IndexLow).ToString(System.Globalization.CultureInfo.InvariantCulture); }
 public static string Final(SafeFileHandle handle) {
  var b=new StringBuilder(4096);uint count=GetFinalPathNameByHandleW(handle,b,4096,0);
  if(count==0||count>=4096)throw new IOException("Canonical"); string p=b.ToString();
  if(!p.StartsWith(@"\\?\",StringComparison.Ordinal)||p.Length<7||p[5]!=':'||p[6]!='\\'||!((p[4]>='A'&&p[4]<='Z')||(p[4]>='a'&&p[4]<='z')))throw new IOException("Alias");
  return p.Substring(4);
 }
 public static void Ancestors(string directory) {
  string at=Path.GetPathRoot(directory); foreach(string part in directory.Substring(at.Length).Split('\\')) {
   at=Path.Combine(at,part);var a=File.GetAttributes(at);
   if((a&FileAttributes.Directory)==0||(a&FileAttributes.ReparsePoint)!=0)throw new IOException("Ancestor");
  }
 }
 public static SafeFileHandle Parent(string directory) {
  if(Marshal.SizeOf<Info>()!=52)throw new IOException("ABI");
  Ancestors(directory); var h=CreateFileW(directory,0x20080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
  if(h.IsInvalid){h.Dispose();throw new IOException("Parent");}return h;
 }
 public static void Ntfs(SafeFileHandle handle) {
  uint serial,maxName,flags;var label=new StringBuilder(256);var name=new StringBuilder(256);
  if(!GetVolumeInformationByHandleW(handle,label,256,out serial,out maxName,out flags,name,256)||name.ToString()!="NTFS"||(flags&8)==0)throw new IOException("Filesystem");
 }
 public static string Private(FileSystemSecurity security) {
  var user=WindowsIdentity.GetCurrent().User; if(user==null||security.GetOwner(typeof(SecurityIdentifier)).Value!=user.Value)throw new IOException("Owner");
  var rules=security.GetAccessRules(true,true,typeof(SecurityIdentifier));if(rules.Count==0||rules.Count>256)throw new IOException("Rules");bool rw=false;
  foreach(FileSystemAccessRule rule in rules) {
   string sid=rule.IdentityReference.Value;long rights=(long)rule.FileSystemRights;
   if(rights<0)throw new IOException("Rights");
   if(rule.AccessControlType==AccessControlType.Allow&&rights>0&&sid!=user.Value&&sid!="S-1-5-18"&&sid!="S-1-5-32-544")throw new IOException("Broad");
   if(rule.AccessControlType==AccessControlType.Allow&&sid==user.Value&&(rights&3)==3)rw=true;
  }
  if(!rw)throw new IOException("Rights");return Hash(security.GetSecurityDescriptorSddlForm(AccessControlSections.All));
 }
 public static DirectorySecurity ParentSecurity(SafeFileHandle handle) {
  IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
  try {
   uint status=GetSecurityInfo(handle,1,7,out owner,out group,out dacl,out sacl,out descriptor);
   if(status!=0||descriptor==IntPtr.Zero||!IsValidSecurityDescriptor(descriptor))throw new IOException("ParentSecurity");
   uint length=GetSecurityDescriptorLength(descriptor);if(length<20||length>32768)throw new IOException("DescriptorLimit");
   var bytes=new byte[(int)length];Marshal.Copy(descriptor,bytes,0,(int)length);
   // New in-memory container-correct object; never persisted to any path.
   var security=new DirectorySecurity();security.SetSecurityDescriptorBinaryForm(bytes,AccessControlSections.Access|AccessControlSections.Owner|AccessControlSections.Group);return security;
  } finally {if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
 }
 public static string ParentProof(SafeFileHandle h,string directory,string dev,string ino,string descriptor) {
  var i=Identity(h);if((i.Attributes&16)==0||(i.Attributes&1024)!=0||Dev(i)!=dev||Ino(i)!=ino||Fold(Final(h))!=Fold(directory))throw new IOException("ParentDrift");
  Ntfs(h);string sha=Private(ParentSecurity(h));
  if(sha!=descriptor)throw new IOException("ParentDescriptor");return sha;
 }
 public static bool ExistsBeforeAttempt(string path) { try{File.GetAttributes(path);return true;}catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;} }
}
'@
 $taskParent=[CompanionEmptyCreator]::Parent($taskDirectory)
 $taskParentSha=[CompanionEmptyCreator]::ParentProof($taskParent,$taskDirectory,$env:RC_PRIVATE_CREATE_DEV,$env:RC_PRIVATE_CREATE_INO,$env:RC_PRIVATE_CREATE_ACL)
 if([CompanionEmptyCreator]::ExistsBeforeAttempt($taskFile)){
  @{schemaVersion=1;outcome='NOT_CREATED_COLLISION';requestId=$taskRequestId;phase='PREFLIGHT';creationAttempted=$false;code='TARGET_PRESENT'} | ConvertTo-Json -Compress
 } else {
  $taskSecurity=[Security.AccessControl.FileSecurity]::new()
  $taskUser=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskSecurity.SetOwner($taskUser);$taskSecurity.SetAccessRuleProtection($true,$false)
  foreach($taskWho in @($taskUser,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$taskSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskWho,'FullControl','Allow'))}
  $taskRights=[Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Synchronize
  $taskPhase='CREATE';$taskAttempted=$true
  $taskStream=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($taskFile),[IO.FileMode]::CreateNew,$taskRights,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$taskSecurity)
  $taskPhase='HANDLE_PROOF'
  $taskInfo=[CompanionEmptyCreator]::Identity($taskStream.SafeFileHandle)
  if(($taskInfo.Attributes -band 1040) -ne 0 -or $taskInfo.SizeHigh -ne 0 -or $taskInfo.SizeLow -ne 0 -or $taskInfo.Links -ne 1 -or [CompanionEmptyCreator]::Fold([CompanionEmptyCreator]::Final($taskStream.SafeFileHandle)) -cne [CompanionEmptyCreator]::Fold($taskFile)){throw 'File proof'}
  $taskActual=[IO.FileSystemAclExtensions]::GetAccessControl($taskStream)
  $taskActualSha=[CompanionEmptyCreator]::Private($taskActual)
  $taskParentSha=[CompanionEmptyCreator]::ParentProof($taskParent,$taskDirectory,$env:RC_PRIVATE_CREATE_DEV,$env:RC_PRIVATE_CREATE_INO,$env:RC_PRIVATE_CREATE_ACL)
  $taskReceipt=@{schemaVersion=1;outcome='CREATED_EMPTY';requestId=$taskRequestId;purpose=$taskPurpose;basename=$taskName;canonicalPathSha256=[CompanionEmptyCreator]::Hash([CompanionEmptyCreator]::Fold($taskFile));parentCanonicalPathSha256=[CompanionEmptyCreator]::Hash([CompanionEmptyCreator]::Fold($taskDirectory));parentDev=$env:RC_PRIVATE_CREATE_DEV;parentIno=$env:RC_PRIVATE_CREATE_INO;parentDescriptorSha256=$taskParentSha;filesystem='NTFS';dev=[CompanionEmptyCreator]::Dev($taskInfo);ino=[CompanionEmptyCreator]::Ino($taskInfo);size='0';nlink=1;regular=$true;reparsePoint=$false;ownerMatchesCurrentUser=$true;privatePermissionsVerified=$true;descriptorSha256=$taskActualSha;observedAtEpochMs=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();proofOrigin='ORIGINAL_CREATOR_HANDLE';parentNodeTokenOwner='UNPROVEN'}
  $taskPhase='CLOSE';$taskStream.Dispose();$taskStream=$null;$taskParent.Dispose();$taskParent=$null
  $taskReceipt | ConvertTo-Json -Depth 3 -Compress
 }
} catch {
 @{schemaVersion=1;outcome=$(if($taskAttempted){'CreatedButOpenUncertain'}else{'NOT_CREATED'});requestId=$taskRequestId;phase=$taskPhase;creationAttempted=$taskAttempted;code=$(if($taskAttempted){'CREATE_OUTCOME_UNCERTAIN'}else{'PREFLIGHT_FAILED'})} | ConvertTo-Json -Compress
} finally { if($null -ne $taskStream){$taskStream.Dispose()};if($null -ne $taskParent){$taskParent.Dispose()} }
`;

function parentStable(request) {
  const pin = fs.lstatSync(request.directory, { bigint: true });
  if (!pin.isDirectory() || pin.isSymbolicLink() || pin.dev.toString() !== request.dev || pin.ino.toString() !== request.ino
    || fs.realpathSync.native(request.directory) !== request.directory) fail('COMPANION_CREATE_PARENT_DRIFT');
  const proof = verifyCompanionPrivateDirectory({ directory: request.directory, dev: request.dev, ino: request.ino });
  if (proof.descriptorSha256 !== request.descriptorSha256) fail('COMPANION_CREATE_PARENT_DRIFT');
}
/** Returns ownership of one already opened O_WRONLY fd to the caller. No bytes
 * are written here. Pre-adoption failures preserve the unknown/empty target. */
export function createCompanionPrivateFileWindows(request) {
  const expected = validateCompanionCreateRequest(request);
  if (process.platform !== 'win32' || VERSIONS[process.versions.node] !== process.versions.uv) fail('COMPANION_CREATE_RUNTIME_UNSUPPORTED');
  try { parentStable(expected); } catch { fail('COMPANION_CREATE_PARENT_UNPROVEN'); }
  const requestId = randomBytes(16).toString('hex');
  const run = spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', companionPrivateCreateWindowsScript], {
    env: { ...process.env, RC_PRIVATE_CREATE_ID: requestId, RC_PRIVATE_CREATE_PARENT: Buffer.from(expected.directory).toString('base64'),
      RC_PRIVATE_CREATE_PATH: Buffer.from(expected.filePath).toString('base64'), RC_PRIVATE_CREATE_DEV: expected.dev,
      RC_PRIVATE_CREATE_INO: expected.ino, RC_PRIVATE_CREATE_ACL: expected.descriptorSha256, RC_PRIVATE_CREATE_PURPOSE: expected.purpose },
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 5000, maxBuffer: 8192
  });
  let descriptor;
  try {
    if (run.error || run.signal || run.status !== 0 || run.stderr.trim()) fail('COMPANION_CREATE_OUTCOME_UNCERTAIN');
    const receipt = decodeCompanionCreateWire(Buffer.from(run.stdout));
    if (receipt.outcome !== 'CREATED_EMPTY') {
      record(receipt, FAILURE_KEYS);
      if (receipt.schemaVersion === 1 && receipt.requestId === requestId && receipt.phase === 'PREFLIGHT' && receipt.creationAttempted === false) {
        if (receipt.outcome === 'NOT_CREATED_COLLISION' && receipt.code === 'TARGET_PRESENT') {
          const error = Object.assign(new Error('COMPANION_CREATE_COLLISION'), { companionCode: 'COMPANION_CREATE_COLLISION',
            companionCreate: { outcome: 'NOT_CREATED_COLLISION', reconciliationRequired: false, basename: expected.basename, purpose: expected.purpose } });
          throw error;
        }
        if (receipt.outcome === 'NOT_CREATED' && receipt.code === 'PREFLIGHT_FAILED') {
          const error = Object.assign(new Error('COMPANION_CREATE_PREFLIGHT_FAILED'), { companionCode: 'COMPANION_CREATE_PREFLIGHT_FAILED',
            companionCreate: { outcome: 'NOT_CREATED', reconciliationRequired: false, basename: expected.basename, purpose: expected.purpose } });
          throw error;
        }
      }
      fail('COMPANION_CREATE_OUTCOME_UNCERTAIN');
    }
    const proved = validateCompanionCreateReceipt(receipt, request, requestId);
    parentStable(expected);
    // Existing-only adoption: never creation, truncation, or failed-proof fallback.
    descriptor = fs.openSync(expected.filePath, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true }), entry = fs.lstatSync(expected.filePath, { bigint: true });
    for (const stat of [opened, entry]) if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size !== 0n
      || stat.dev.toString() !== proved.dev || stat.ino.toString() !== proved.ino) fail('COMPANION_CREATE_ADOPTION_DRIFT');
    const proof = verifyCompanionPrivateFile({ filePath: expected.filePath, dev: proved.dev, ino: proved.ino });
    if (proof.descriptorSha256 !== proved.descriptorSha256) fail('COMPANION_CREATE_DESCRIPTOR_DRIFT');
    const after = fs.fstatSync(descriptor, { bigint: true }), afterEntry = fs.lstatSync(expected.filePath, { bigint: true });
    for (const stat of [after, afterEntry]) if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size !== 0n
      || stat.dev !== opened.dev || stat.ino !== opened.ino || stat.mtimeNs !== opened.mtimeNs) fail('COMPANION_CREATE_ADOPTION_DRIFT');
    parentStable(expected);
    const owned = descriptor; descriptor = undefined;
    return { descriptor: owned, dev: proved.dev, ino: proved.ino, descriptorSha256: proved.descriptorSha256 };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error.companionCreate?.reconciliationRequired === false) throw error;
    fail('COMPANION_CREATE_OUTCOME_UNCERTAIN', companionCreateUncertainty(expected.filePath, expected.purpose));
  }
}
