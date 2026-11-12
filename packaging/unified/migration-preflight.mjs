// Read-only deployment preflight. Never installs, uninstalls, grants access,
// reads credentials, or authorizes release. One shared path for Windows/Linux.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const expectedPackage='chatgpt-remote-commander';
const safeUnit=/^chatgpt-remote-commander[a-z0-9@._:-]*\.service$/i;
const sha=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
// The owner-selected tunnel profile is input, not a ChatGPT identity proof.
// Never print/retain the YAML: it may contain the runtime API key.
export function parseMainTunnelBinding(yaml){
  if(typeof yaml!=='string'||Buffer.byteLength(yaml,'utf8')>16384)return null;
  const lines=yaml.split(/\r?\n/);
  let inMcp=false,inUrls=false,inMain=false,seenMain=0;
  const targets=[];
  for(const line of lines){
    if(/^(?:#.*|\s*)$/.test(line))continue;
    if(/^\S/.test(line)){
      inMcp=/^mcp:\s*(?:#.*)?$/.test(line);
      inUrls=false;inMain=false;continue;
    }
    if(!inMcp)continue;
    if(/^ {2}server_urls:\s*(?:#.*)?$/.test(line)){
      inUrls=true;inMain=false;continue;
    }
    if(/^ {2}[a-zA-Z][\w.-]*:/.test(line)){
      inUrls=false;inMain=false;continue;
    }
    if(!inUrls)continue;
    const channel=/^ {4}- channel:\s*([a-zA-Z0-9._-]+)\s*$/.exec(line);
    if(channel){
      inMain=channel[1]==='main';
      if(inMain)seenMain++;
      continue;
    }
    if(inMain){
      const raw=/^ {6}url:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*$/.exec(line);
      if(raw)targets.push(raw[1]??raw[2]??raw[3]);
    }
  }
  if(seenMain!==1||targets.length!==1)return null;
  let url;
  try{url=new URL(targets[0]);}catch{return null;}
  const port=Number(url.port);
  if(!['http:','https:'].includes(url.protocol)||url.hostname!=='127.0.0.1'
    ||url.pathname!=='/mcp'||url.search||url.hash
    ||url.username||url.password||!Number.isSafeInteger(port)
    ||port<1024||port>65535)return null;
  return Object.freeze({port,channel:'main',path:'/mcp',tls:url.protocol==='https:'});
}
function readOwnerTunnelBinding(){
  const appData=process.env.APPDATA;
  if(typeof appData!=='string'||!path.isAbsolute(appData))
    return {profilePresent:false,valid:false};
  const file=path.join(appData,'tunnel-client','chatgpt-remote-commander.yaml');
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)
      return {profilePresent:true,valid:false};
    const binding=parseMainTunnelBinding(fs.readFileSync(file,'utf8'));
    return {profilePresent:true,valid:!!binding,port:binding?.port??null,tls:binding?.tls??false};
  }catch(error){
    if(error?.code==='ENOENT')return {profilePresent:false,valid:false};
    return {profilePresent:true,valid:false};
  }
}
function probeLoopbackCoreVersion(port){
  if(!Number.isSafeInteger(port)||port<1024||port>65535)return null;
  // Isolated bounded local GET. Never forwards the tunnel credential.
  const script=String.raw`
const http=require('node:http');
const port=Number(process.argv[1]);
let body='';
const req=http.get({hostname:'127.0.0.1',port,path:'/health',timeout:1200},res=>{
  if(res.statusCode!==200){res.resume();process.exitCode=2;return;}
  res.setEncoding('utf8');
  res.on('data',chunk=>{body+=chunk;if(body.length>2048)req.destroy();});
  res.on('end',()=>{try{
    const obj=JSON.parse(body);
    if(typeof obj.version==='string'&&/^0\.(?:11|12)\.[A-Za-z0-9.-]+$/.test(obj.version))
      process.stdout.write(obj.version);
    else process.exitCode=2;
  }catch{process.exitCode=2;}});
});
req.on('timeout',()=>req.destroy());
req.on('error',()=>{process.exitCode=2;});
`;
  const result=exec(process.execPath,['-e',script,String(port)]);
  const version=result.stdout.trim();
  return result.ok && /^0\.(?:11|12)\.[A-Za-z0-9.-]+$/.test(version)
    ?version:null;
}

function exec(program,args){
  try{
    const r=spawnSync(program,args,{encoding:'utf8',windowsHide:true,timeout:7000,
      maxBuffer:512*1024,stdio:['ignore','pipe','pipe']});
    return {ok:r.status===0,stdout:r.stdout||''};
  }catch{return {ok:false,stdout:''};}
}
export function assessMigration(facts){
  if(!facts||!['linux','win32'].includes(facts.platform))throw Error('RC012_MIGRATION_PLATFORM_INVALID');
  if(facts.connectionMode!==undefined&&!['private-tunnel','managed-oauth'].includes(facts.connectionMode))
    throw Error('RC012_MIGRATION_CONNECTION_MODE_INVALID');
  const privateTunnel=facts.connectionMode==='private-tunnel';
  const blocked=[];
  const oldPresent=facts.platform==='win32'?facts.legacyInnoPresent===true:facts.nativePackageInstalled===true;
  const units=Array.isArray(facts.units)?facts.units:[];
  if(!facts.inventoryReliable)blocked.push('INVENTORY_UNAVAILABLE');
  if(facts.platform==='win32'&&facts.routerDetected===true
    &&facts.routerMappingMatches!==true)
    blocked.push('OWNER_STABLE_ROUTER_BACKEND_MISMATCH');
  // The existing Stable Router uses HTTP input and HTTP forwarding. It cannot
  // terminate tunnel-client mTLS or pass verified TLS peer identity to G1.
  // Changing only its backend port would silently preserve legacy plaintext.
  if(!privateTunnel&&facts.platform==='win32'&&facts.routerDetected===true)
    blocked.push('G1_STABLE_ROUTER_PLAINTEXT_MTLS_INCOMPATIBLE');
  if(!privateTunnel&&facts.platform==='win32'&&facts.tunnelProfilePresent===true
    &&facts.tunnelProfileValid===true&&facts.tunnelTargetTls!==true)
    blocked.push('G1_TUNNEL_HTTPS_MTLS_ROUTE_REQUIRED');
  if(facts.platform==='win32'&&facts.tunnelProfilePresent===true){
    if(facts.tunnelProfileValid!==true)
      blocked.push('OWNER_TUNNEL_MAIN_BINDING_UNVERIFIED');
    else if(typeof facts.tunnelTargetVersion!=='string'
      ||!facts.tunnelTargetVersion.startsWith('0.12.'))
      blocked.push('OWNER_TUNNEL_STILL_TARGETS_LEGACY_OR_UNKNOWN_CORE');
  }
  if(facts.platform==='win32' && oldPresent){
    if(facts.ownerRegisteredInstallerFamily==='owner-managed-powershell')
      blocked.push('OWNER_MANAGED_TO_UNIFIED_NSIS_TRANSACTION_MISSING');
    else {
      blocked.push('LEGACY_INNO_TO_NSIS_TRANSACTION_MISSING');
      if(['unverified','multiple-or-unverified'].includes(facts.ownerRegisteredInstallerFamily))
        blocked.push('OWNER_INSTALLER_IDENTITY_UNVERIFIED');
    }
  }
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
  if(privateTunnel){
    // Per-user Plugin/Tunnel ownership and native ingress boundaries must be
    // positively proven; a loopback URL or a successful tunnel readiness check
    // is not an authenticated pair or an OS Full Access grant.
    if(facts.privatePairBindingVerified!==true)
      blocked.push('PRIVATE_PLUGIN_TUNNEL_PAIR_BINDING_UNVERIFIED');
    if(facts.privateLocalIngressIsolated!==true)
      blocked.push('PRIVATE_TUNNEL_LOOPBACK_ISOLATION_UNVERIFIED');
    if(facts.privateCredentialOwnershipVerified!==true)
      blocked.push('PRIVATE_RUNTIME_CREDENTIAL_OWNERSHIP_UNVERIFIED');
    // The v0.12 worker quarantines privileged /mcp unless an independently
    // authenticated owner-bound ingress is actually wired. Selecting private
    // mode does NOT bypass that runtime guard or grant Full Access.
    if(facts.privatePrivilegedIngressReady!==true)
      blocked.push('PRIVATE_PRIVILEGED_INGRESS_NOT_WIRED');
  }else if(!facts.g1AuthenticatedCurrentSession)
    blocked.push('G1_CURRENT_SESSION_UNVERIFIED');
  if(!facts.j01OwnerNativeConsent)blocked.push('J01_NATIVE_OWNER_CONSENT_UNVERIFIED');
  if(!facts.revocableFullAccessProven)blocked.push('FULL_ACCESS_REVOCATION_UNVERIFIED');
  if(!facts.trustedPublisherSignature)blocked.push('TRUSTED_RELEASE_SIGNATURE_MISSING');
  if(!facts.signedUpdateRollbackAccepted)blocked.push('SIGNED_UPDATE_ROLLBACK_UNVERIFIED');
  if(!facts.installedCanaryAccepted)blocked.push('NATIVE_INSTALLED_CANARY_NOT_ACCEPTED');
  // No positive "promotion" operation exists in this tool. Even complete
  // evidence needs the independent release authority and owner acceptance.
  return Object.freeze({schema:1,decision:'NO_PROMOTE',readOnly:true,
    platform:facts.platform,existingInstalled:oldPresent,
    connectionMode:facts.connectionMode??'managed-oauth',
    ownerRegisteredInstallerFamily:facts.platform==='win32'
      ?facts.ownerRegisteredInstallerFamily??'unknown':null,
    ownerTunnelProfileDetected:facts.tunnelProfilePresent===true,
    ownerTunnelTargetPort:facts.tunnelProfileValid===true?facts.tunnelTargetPort??null:null,
    ownerTunnelHttpsConfigured:facts.tunnelProfileValid===true&&facts.tunnelTargetTls===true,
    ownerStableRouterDetected:facts.routerDetected===true,
    ownerStableRouterBackendPort:facts.routerDetected===true?facts.routerBackendPort:null,
    ownerStableRouterBackendVersion:facts.routerDetected===true?facts.routerBackendVersion:null,
    ownerStableRouterMappingMatches:facts.routerDetected===true&&facts.routerMappingMatches===true,
    ownerTunnelTargetRuntimeVersion:facts.tunnelProfileValid===true?facts.tunnelTargetVersion??null:null,
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
  return {platform:'linux',connectionMode:'private-tunnel',
    inventoryReliable:packageQuery.ok&&listing.ok&&files.ok,
    nativePackageInstalled:exists,allNativePayloadPathsAvailable:nativeVersionOK&&knownNative.ok,
    units};
}
/** Router mapping is an observation, not authorization to change routing. */
export function classifyObservedRouterStatus(report,listenPort,backendHealthVersion){
  if(!report||typeof report!=='object'||Array.isArray(report)
    ||report.router!==true||report.listenPort!==listenPort
    ||typeof report.sourceSha256!=='string'
    ||!/^[a-f0-9]{64}$/.test(report.sourceSha256)
    ||report.profile!=='default'||report.schema!==1
    ||!Number.isSafeInteger(report.generation)||report.generation<1
    ||!Number.isSafeInteger(report.activePort)
    ||report.activePort<1024||report.activePort>65535
    ||report.activePort===listenPort
    ||typeof report.activeVersion!=='string'
    ||!/^0\.(?:11|12)\.[A-Za-z0-9.-]+$/.test(report.activeVersion))
    return Object.freeze({detected:false,mappingMatches:false});
  const match=backendHealthVersion===report.activeVersion;
  return Object.freeze({detected:true,mappingMatches:match,
    backendPort:report.activePort,backendVersion:report.activeVersion,
    generation:report.generation});
}
function probeLoopbackRouterStatus(port){
  if(!Number.isSafeInteger(port)||port<1024||port>65535)return null;
  // Constrain reading to the local router and emit only whitelisted fields.
  const script=String.raw`
const http=require('node:http');
const port=Number(process.argv[1]);
let body='',bytes=0;
const req=http.get({hostname:'127.0.0.1',port,path:'/router/status',timeout:1200},res=>{
 if(res.statusCode!==200){res.resume();process.exitCode=2;return;}
 res.setEncoding('utf8');
 res.on('data',chunk=>{
   bytes+=Buffer.byteLength(chunk);
   if(bytes>8192){req.destroy();return;}
   body+=chunk;
 });
 res.on('end',()=>{try{
   const raw=JSON.parse(body);
   if(raw.router!==true||!raw.state)throw Error('not_router');
   const state=raw.state;
   process.stdout.write(JSON.stringify({
     router:raw.router,listenPort:raw.listenPort,
     sourceSha256:raw.sourceSha256,
     profile:state.profile,schema:state.schema,
     generation:state.generation,
     activePort:state.active?.port,activeVersion:state.active?.version
   }));
 }catch{process.exitCode=2;}});
});
req.on('timeout',()=>req.destroy());
req.on('error',()=>{process.exitCode=2;});
`;
  const observed=exec(process.execPath,['-e',script,String(port)]);
  if(!observed.ok||observed.stdout.length>1024)return null;
  try{return JSON.parse(observed.stdout);}catch{return null;}
}
/**
 * Registry output is operator-managed untrusted text. Never report the
 * uninstall command, install path, username or arguments; only the family.
 * A script-based uninstaller is NOT proven safe to invoke automatically.
 */
export function classifyWindowsUninstallRegistryResponse(raw){
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>50000)
    return 'unverified';
  const lines=raw.split(/\r?\n/);
  const matches=lines.map(line=>
    /^\s*UninstallString\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i.exec(line))
    .filter(Boolean);
  if(matches.length!==1)return 'unverified';
  const command=matches[0][1];
  if(command.length>8192||/[\u0000-\u001f]/.test(command))
    return 'unverified';
  if(/(?:^|[\\/"\s])(?:pwsh|powershell)\.exe"?\s/i.test(command)
    &&/(?:^|\s)-File\s+(?:"[^"]*\\uninstall\.ps1"|[^\s"]*\\uninstall\.ps1)(?:\s|$)/i.test(command))
    return 'owner-managed-powershell';
  if(/(?:^|[\\/"\s])unins\d+\.exe"?\s*$/i.test(command))
    return 'inno-unverified';
  return 'unverified';
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
  const present=checks.filter(c=>c.ok);
  const installerFamily=present.length===1
    ?classifyWindowsUninstallRegistryResponse(present[0].stdout)
    :present.length===0?'none':'multiple-or-unverified';
  const tunnel=readOwnerTunnelBinding();
  const targetVersion=tunnel.valid?probeLoopbackCoreVersion(tunnel.port):null;
  const routerReport=tunnel.valid?probeLoopbackRouterStatus(tunnel.port):null;
  const backendVersion=routerReport?.activePort
    ?probeLoopbackCoreVersion(routerReport.activePort):null;
  const route=classifyObservedRouterStatus(routerReport,tunnel.port,backendVersion);
  return {platform:'win32',connectionMode:'private-tunnel',
    legacyInnoPresent:checks.some(c=>c.ok),
    ownerRegisteredInstallerFamily:installerFamily,
    inventoryReliable:!bad&&checks.length===3,
    tunnelProfilePresent:tunnel.profilePresent,tunnelProfileValid:tunnel.valid,
    tunnelTargetPort:tunnel.port??null,tunnelTargetTls:tunnel.tls===true,
    tunnelTargetVersion:targetVersion,
    routerDetected:route.detected,routerMappingMatches:route.mappingMatches,
    routerBackendPort:route.detected?route.backendPort:null,
    routerBackendVersion:route.detected?route.backendVersion:null,
    units:[]};
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
