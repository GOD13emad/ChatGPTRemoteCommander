// V2 R5 Linux Native Messaging owner-local candidate. No browser install on import.
// Existing owner extension ID and actual browser consent remain separate gates.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const HOST='com.chatgpt_remote_commander.v2';
const DIRS=Object.freeze({
  chrome:'.config/google-chrome/NativeMessagingHosts',
  chromium:'.config/chromium/NativeMessagingHosts',
  brave:'.config/BraveSoftware/Brave-Browser/NativeMessagingHosts',
  edge:'.config/microsoft-edge/NativeMessagingHosts'
});
const SOURCE=fileURLToPath(new URL('./v2-native-messaging-host.mjs',import.meta.url));
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const sha=(file)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function safeFile(file,extension){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||
    !file.endsWith(extension))fail('V2_LINUX_NATIVE_FILE_INVALID');
 let st;
 try{st=fs.lstatSync(file);}catch{fail('V2_LINUX_NATIVE_FILE_MISSING');}
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('V2_LINUX_NATIVE_FILE_UNTRUSTED');
 return file;
}
const quote=(value)=>"'"+value.replace(/'/g,"'\\''")+"'";
function noAliases(from,downTo){
 let current=path.resolve(from),guard=0;
 while(current!==downTo&&current!==path.dirname(current)&&guard++<32){
  if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())
   fail('V2_LINUX_NATIVE_ALIAS_FORBIDDEN');
  current=path.dirname(current);
 }
 if(current!==downTo)fail('V2_LINUX_NATIVE_ROOT_REQUIRED');
}
export function planV2LinuxNativeHost({home=os.homedir(),browser,extensionId,nodePath=process.execPath,
 hostScriptPath=SOURCE}={}){
 if(process.platform!=='linux')fail('V2_LINUX_NATIVE_PLATFORM_REQUIRED');
 if(typeof home!=='string'||!path.isAbsolute(home)||home==='/'||
    typeof browser!=='string'||!Object.hasOwn(DIRS,browser)||
    typeof extensionId!=='string'|| !/^[a-p]{32}$/.test(extensionId))
   fail('V2_LINUX_NATIVE_EXACT_ID_REQUIRED');
 const browserHome=path.join(home,DIRS[browser]),userStore=path.join(home,'.local','share',
  'ChatGPTRemoteCommanderV2','NativeMessaging');
 const origin='chrome-extension://'+extensionId+'/';
 const node=safeFile(nodePath,'node'),host=safeFile(hostScriptPath,'.mjs');
 if(path.resolve(host)!==path.resolve(SOURCE))fail('V2_LINUX_NATIVE_CANONICAL_HOST_REQUIRED');
 const launcher=path.join(userStore,'rcv2-native-host');
 const manifest=path.join(browserHome,HOST+'.json');
 const script=[
  '#!/bin/sh',
  '# Commander V2 owner-scoped bridge; generated with exact pinned extension origin.',
  'if [ "$#" -ne 1 ] || [ "$1" != '+quote(origin)+' ]; then',
  '  printf "V2_NATIVE_LINUX_DENIED\\n" >&2',
  '  exit 2',
  'fi',
  'RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN='+quote(origin),
  'export RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN',
  'exec '+quote(node)+' '+quote(host)+' "$1"',
  ''
 ].join('\n');
 const nativeManifest={name:HOST,description:'Commander V2 owner-only preflight candidate',
  path:launcher,type:'stdio',allowed_origins:[origin]};
 return Object.freeze({schema:1,browser,origin,launcher,manifest,script,
  manifestContent:JSON.stringify(nativeManifest,null,2)+'\n',
  nodePath:node,hostScriptPath:host,
  nodeSha256:sha(node),hostSha256:sha(host),mutationPerformed:false,
  paired:false,chatAuthorized:false,toolsAuthorized:false});
}
export function installV2LinuxNativeHost(plan,{
 expectedNodeSha256,expectedHostSha256,home=os.homedir()
}={}){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()===0||
    home!==os.homedir())fail('V2_LINUX_NATIVE_OWNER_REQUIRED');
 if(!plan||plan.schema!==1||typeof plan.launcher!=='string'||
    !plan.launcher.startsWith(path.join(home,'.local','share','ChatGPTRemoteCommanderV2','NativeMessaging')+path.sep)||
    !Object.values(DIRS).some(dir=>plan.manifest.startsWith(path.join(home,dir)+path.sep))||
    !/^[a-f0-9]{64}$/.test(expectedNodeSha256??'')||
    !/^[a-f0-9]{64}$/.test(expectedHostSha256??'')||
    expectedNodeSha256!==plan.nodeSha256||expectedHostSha256!==plan.hostSha256)
   fail('V2_LINUX_NATIVE_PINNED_OWNER_PLAN_REQUIRED');
 // Never treat an arbitrary caller-supplied plan object as an installer authority.
 // Recompute the canonical content and destinations from current owned inputs.
 const pinned=planV2LinuxNativeHost({home,browser:plan.browser,
  extensionId:typeof plan.origin==='string' &&
    /^chrome-extension:\/\/[a-p]{32}\/$/.test(plan.origin)?
    plan.origin.slice('chrome-extension://'.length,-1):undefined,
  nodePath:plan.nodePath,hostScriptPath:plan.hostScriptPath});
 for(const field of ['origin','launcher','manifest','script','manifestContent',
   'nodePath','hostScriptPath','nodeSha256','hostSha256']){
  if(plan[field]!==pinned[field])
   fail('V2_LINUX_NATIVE_PINNED_OWNER_PLAN_REQUIRED');
 }
 if(sha(safeFile(plan.nodePath,'node'))!==plan.nodeSha256||
    sha(safeFile(plan.hostScriptPath,'.mjs'))!==plan.hostSha256)
   fail('V2_LINUX_NATIVE_PINNED_ARTIFACT_CHANGED');
 // No attempt to reuse other app roots, existing manifests or aliases.
 const store=path.dirname(plan.launcher),config=path.dirname(plan.manifest);
 noAliases(store,home);noAliases(config,home);
 if(fs.existsSync(plan.launcher)||fs.existsSync(plan.manifest))
  fail('V2_LINUX_NATIVE_EXISTING_INSTALL_RECONCILIATION_REQUIRED');
 fs.mkdirSync(store,{recursive:true,mode:0o700});
 fs.mkdirSync(config,{recursive:true,mode:0o700});
 noAliases(store,home);noAliases(config,home);
 const temp=plan.launcher+'.stage-'+crypto.randomBytes(8).toString('hex');
 try{
  fs.writeFileSync(temp,plan.script,{mode:0o700,flag:'wx'});
  fs.chmodSync(temp,0o700);
  fs.renameSync(temp,plan.launcher);
  // Host manifest is written last, with the browser yet to grant user approval.
  fs.writeFileSync(plan.manifest,plan.manifestContent,{mode:0o600,flag:'wx'});
 }catch{
  try{fs.unlinkSync(temp);}catch{}
  // A launcher without a manifest does not expose a host; preserve for reconciliation.
  throw Object.assign(new Error('V2_LINUX_NATIVE_INSTALL_INCOMPLETE'),{
   code:'V2_LINUX_NATIVE_INSTALL_INCOMPLETE'});
 }
 return Object.freeze({schema:1,installed:true,browser:plan.browser,
  exactOriginOnly:true,manifest:plan.manifest,
  browserConsentVerified:false,chatAuthorized:false,toolsAuthorized:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode='plan',browser,extensionId,nodeHash,hostHash]=process.argv.slice(2);
  if(!['plan','install'].includes(mode))fail('V2_LINUX_NATIVE_MODE_INVALID');
  const plan=planV2LinuxNativeHost({browser,extensionId});
  if(mode==='plan')console.log(JSON.stringify({schema:1,mode:'plan',browser,
   path:plan.manifest,launcher:plan.launcher,origin:plan.origin,
   nodeSha256:plan.nodeSha256,hostSha256:plan.hostSha256,
   installed:false,requiresOwnerBrowserConsent:true,chatAuthorized:false}));
  else console.log(JSON.stringify(installV2LinuxNativeHost(plan,{
   expectedNodeSha256:nodeHash,expectedHostSha256:hostHash})));
 }catch(e){console.error('V2_LINUX_NATIVE_INSTALL_DENIED '+e.code);process.exitCode=2;}
}
