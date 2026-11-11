// Read-only deployment preflight. Never installs, uninstalls, grants access,
// reads credentials, or authorizes release. One shared path for Windows/Linux.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const expectedPackage='chatgpt-remote-commander';
const safeUnit=/^chatgpt-remote-commander[a-z0-9@._:-]*\.service$/i;
const sha=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
function exec(program,args){
  try{
    const r=spawnSync(program,args,{encoding:'utf8',windowsHide:true,timeout:7000,
      maxBuffer:512*1024,stdio:['ignore','pipe','pipe']});
    return {ok:r.status===0,stdout:r.stdout||''};
  }catch{return {ok:false,stdout:''};}
}
export function assessMigration(facts){
  if(!facts||!['linux','win32'].includes(facts.platform))throw Error('RC012_MIGRATION_PLATFORM_INVALID');
  const blocked=[];
  const oldPresent=facts.platform==='win32'?facts.legacyInnoPresent===true:facts.nativePackageInstalled===true;
  const units=Array.isArray(facts.units)?facts.units:[];
  if(!facts.inventoryReliable)blocked.push('INVENTORY_UNAVAILABLE');
  if(facts.platform==='win32' && oldPresent)blocked.push('LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING');
  if(facts.platform==='linux' && oldPresent && !facts.allNativePayloadPathsAvailable)
    blocked.push('NATIVE_RUNTIME_TUNNEL_SERVICE_CONTINUITY_UNPROVEN');
  if(units.some(u=>u.active && !u.knownExecutable))
    blocked.push('ACTIVE_SERVICE_EXECUTABLE_UNMAPPED');
  if(units.some(u=>u.enabled && !u.knownExecutable))
    blocked.push('ENABLED_AUTOSTART_EXECUTABLE_UNMAPPED');
  if(units.some(u=>u.kind==='tunnel' && (u.active||u.enabled) && !u.nativeTunnelCompatible))
    blocked.push('TUNNEL_CUTOVER_UNVERIFIED');
  if(units.some(u=>u.active) && !facts.activeServiceRestoreTested)
    blocked.push('ACTIVE_SERVICE_ROLLBACK_NOT_TESTED');
  if(!facts.profileBackupReceiptVerified)blocked.push('PROFILE_BACKUP_NOT_VERIFIED');
  if(!facts.featureParityVerified)blocked.push('LEGACY_CAPABILITY_PARITY_NOT_PROVEN');
  if(!facts.g1AuthenticatedCurrentSession)blocked.push('G1_CURRENT_SESSION_UNVERIFIED');
  if(!facts.j01OwnerNativeConsent)blocked.push('J01_NATIVE_OWNER_CONSENT_UNVERIFIED');
  if(!facts.revocableFullAccessProven)blocked.push('FULL_ACCESS_REVOCATION_UNVERIFIED');
  if(!facts.trustedPublisherSignature)blocked.push('TRUSTED_RELEASE_SIGNATURE_MISSING');
  if(!facts.signedUpdateRollbackAccepted)blocked.push('SIGNED_UPDATE_ROLLBACK_UNVERIFIED');
  if(!facts.installedCanaryAccepted)blocked.push('NATIVE_INSTALLED_CANARY_NOT_ACCEPTED');
  // No positive "promotion" operation exists in this tool. Even complete
  // evidence needs the independent release authority and owner acceptance.
  return Object.freeze({schema:1,decision:'NO_PROMOTE',readOnly:true,
    platform:facts.platform,existingInstalled:oldPresent,
    activeCoreUnits:units.filter(u=>u.kind==='core'&&u.active).length,
    activeTunnelUnits:units.filter(u=>u.kind==='tunnel'&&u.active).length,
    enabledCoreUnits:units.filter(u=>u.kind==='core'&&u.enabled).length,
    enabledTunnelUnits:units.filter(u=>u.kind==='tunnel'&&u.enabled).length,
    unmappedUnits:units.filter(u=>(u.active||u.enabled)&&!u.knownExecutable).length,
    blocked:[...new Set(blocked)],promotionAuthority:'EXTERNAL_REQUIRED'});
}
function linuxFacts(){
  const packageQuery=exec('dpkg-query',['-W','-f=${Package}|${Version}|${Status}',expectedPackage]);
  const [name,version,status]=packageQuery.stdout.trim().split('|');
  const exists=packageQuery.ok&&name===expectedPackage&&status==='install ok installed';
  const units=[];
  const listing=exec('systemctl',['--user','list-units','--all','--no-legend','--plain','chatgpt-remote-commander*.service']);
  const files=exec('systemctl',['--user','list-unit-files','--no-legend','--plain','chatgpt-remote-commander*.service']);
  if(listing.ok&&files.ok){
    const names=new Set();
    const enabled=new Set();
    for(const line of listing.stdout.split(/\r?\n/)){
      const unit=line.trim().split(/\s+/)[0];
      if(unit&&safeUnit.test(unit))names.add(unit);
    }
    for(const line of files.stdout.split(/\r?\n/)){
      const [unit,state]=line.trim().split(/\s+/);
      if(!unit||!safeUnit.test(unit))continue;
      names.add(unit);
      if(['enabled','enabled-runtime','linked','linked-runtime'].includes(state))enabled.add(unit);
    }
    for(const name of [...names].sort().slice(0,48)){
      const result=exec('systemctl',['--user','show',name,'-p','ActiveState','-p','ExecStart']);
      const execStart=result.stdout.match(/^ExecStart=(.*)$/m)?.[1]||'';
      const active=result.stdout.includes('ActiveState=active');
      const nativeTunnel=execStart.includes('/usr/lib/chatgpt-remote-commander/tunnel/native-tunnel-launch.sh');
      const nativeCore=execStart.includes('/usr/lib/chatgpt-remote-commander/runtime/node');
      units.push({id:sha(name),kind:name.includes('-tunnel')?'tunnel':'core',active,
        enabled:enabled.has(name),knownExecutable:!!result.ok&&(nativeTunnel||nativeCore),
        nativeTunnelCompatible:nativeTunnel});
    }
  }
  const nativeVersionOK=exists&&/^0\.12\.0~dev/.test(version||'');
  const knownNative=exec('test',['-f','/usr/lib/chatgpt-remote-commander/tunnel/native-tunnel-launch.sh']);
  return {platform:'linux',inventoryReliable:packageQuery.ok&&listing.ok&&files.ok,
    nativePackageInstalled:exists,allNativePayloadPathsAvailable:nativeVersionOK&&knownNative.ok,
    units};
}
function windowsFacts(){
  const paths=[
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RemoteCommander',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RemoteCommander',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RemoteCommander'
  ];
  const checks=paths.map(p=>exec('reg.exe',['query',p,'/v','UninstallString']));
  // reg.exe exit 1 means precisely that a fixed key/value is absent.
  const bad=checks.some(c=>c.stdout.length>50000);
  return {platform:'win32',legacyInnoPresent:checks.some(c=>c.ok),
    inventoryReliable:!bad&&checks.length===3,units:[]};
}
export function inspectLocalPlatform(platform=process.platform){
  if(platform==='linux')return linuxFacts();
  if(platform==='win32')return windowsFacts();
  throw Error('RC012_MIGRATION_UNSUPPORTED_PLATFORM');
}
export function localReport(platform=process.platform){
  const f=inspectLocalPlatform(platform);
  return assessMigration(f);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const argv=process.argv.slice(2);
  if(argv.length!==1||argv[0]!=='--read-only')
    throw Error('RC012_MIGRATION_PREFLIGHT_READ_ONLY_ONLY');
  const report=localReport(os.platform());
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(report.blocked.length)process.exitCode=2;
}
