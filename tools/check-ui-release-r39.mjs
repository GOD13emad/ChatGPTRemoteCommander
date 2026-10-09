'use strict';
// R39 is a READ-ONLY paper/evidence gate. Never downloads, launches or installs.
// Signature fields alone cannot validate Authenticode; independent platform verification required.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url));
const hex40=/^[0-9a-f]{40}$/;
const hex64=/^[0-9a-f]{64}$/;
function guard(ok,label){if(!ok)throw Error('R39_UNSAFE_MANIFEST_'+label);}
export function validate(m){
 guard(m?.schema===1&&m.revision==='R39'&&m.productStatus==='PARTIAL_NOT_FINAL','IDENTITY');
 guard(m.baseline?.version==='0.10.20'&&m.baseline.commit==='362375c464948be3001b307650c13fc3353ed05b'&&m.baseline.saeidRouterGeneration===34&&m.baseline.saeidRouterSha256==='1de7e13638cecac0be939e8a3dcafce153f8a20b51f3c460d316dfa608812c04','BASELINE');
 guard(m.openCriticalProductGates===8,'PRODUCT_GATES');
 for(const k of ['browser','controlWindows','controlLinux'])guard(hex40.test(m.components?.[k]?.sha??''),'SOURCE_'+k);
 guard(m.components.browser.version==='0.8.2','BROWSER_VERSION');
 const identities=[['saeid-windows','windows'],['emad-windows','windows'],['emad-linux','linux'],['mmz-linux','linux']];
 guard(Array.isArray(m.hosts)&&m.hosts.length===identities.length,'HOST_COUNT');
 const seen=new Set();
 for(const h of m.hosts){
   guard(identities.some(([id,p])=>id===h?.id&&p===h?.platform)&&!seen.has(h.id),'HOST_ID');
   guard(['CONNECTED','DISCONNECTED','UNVERIFIED'].includes(h.status),'HOST_LIVENESS');
   seen.add(h.id);
 }
 for(const flag of ['onlyPinnedArtifacts','noSandboxBypass','noLoginReset','noAutoReboot','noUnknownDeletes','preserveBaseline','stagedCanaryRequired'])guard(m.safety?.[flag]===true,'SECURITY_'+flag);
 return m;
}
export function blockers(m){
 validate(m);const b=[];const gate=m.releaseGates??{};
 for(const k of ['exactHeadCIAllPass','ownerNativeAllHosts','codeSigningTrusted','immutableSHA256Assets','linuxSandboxAccepted','allHostsOnline','fourHostCanaryInstallUninstallRollback','authenticatedSameConversationAck'])if(gate[k]!==true)b.push('GATE_'+k);
 if(m.release?.status!=='ACCEPTED')b.push('RELEASE_NOT_ACCEPTED');
 if(m.release?.autoUpdatesEnabled!==true)b.push('AUTO_UPDATES_DISABLED');
 if(!m.release?.versionTag)b.push('RELEASE_TAG_MISSING');
 if(!hex64.test(m.release?.externalCryptographicVerificationReceipt??''))b.push('EXTERNAL_SIGNATURE_RECEIPT_MISSING');
 if(!hex64.test(m.release?.ownerAcceptanceReceipt??''))b.push('OWNER_ACCEPTANCE_RECEIPT_MISSING');
 const c=m.components;
 for(const k of ['windowsArtifactSha256','linuxArtifactSha256'])
   if(!hex64.test(c.browser[k]??''))b.push('BROWSER_'+k+'_MISSING');
 if(c.browser.codeSigning!=='VALID_TRUSTED_PUBLISHER')b.push('BROWSER_TRUSTED_SIGNATURE_MISSING');
 if(c.browser.nativeVisualAccepted!==true||c.browser.linuxSandbox4755Accepted!==true)b.push('BROWSER_NATIVE_OR_SANDBOX_OPEN');
 for(const k of ['controlWindows','controlLinux']){
   if(!hex64.test(c[k].artifactSha256??''))b.push(k+'_ARTIFACT_SHA_MISSING');
   if(c[k].nativeVisualAccepted!==true)b.push(k+'_NATIVE_VISUAL_OPEN');
 }
 if(c.controlWindows.signedPublisher!=='VALID_TRUSTED_PUBLISHER')b.push('WINDOWS_CONTROL_TRUSTED_SIGNATURE_MISSING');
 for(const h of m.hosts){
  if(h.status!=='CONNECTED')b.push('HOST_OFFLINE_'+h.id);
  if(h.nativeAccepted!==true)b.push('HOST_NATIVE_UNVERIFIED_'+h.id);
  if(h.canaryAccepted!==true)b.push('HOST_CANARY_OPEN_'+h.id);
  if(h.uninstallRollbackAccepted!==true)b.push('HOST_ROLLBACK_OPEN_'+h.id);
 }
 return b;
}
export function evaluate(m){const missing=blockers(m);return {revision:m.revision,status:missing.length?'BLOCKED_FAIL_CLOSED':'DOCUMENTARY_READY_EXTERNAL_CRYPTO_STILL_REQUIRED',blockers:missing,autoUpdatePerformed:false,productionMutated:false};}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  const mode=process.argv[2]||'--audit';
  guard(['--audit','--require-ready'].includes(mode),'MODE');
  const doc=JSON.parse(readFileSync(join(root,'../config/ui-release-r39.json'),'utf8'));
  const result=evaluate(doc);console.log(JSON.stringify(result,null,2));
  if(mode==='--require-ready'&&result.status!=='DOCUMENTARY_READY_EXTERNAL_CRYPTO_STILL_REQUIRED')process.exitCode=64;
 }catch(error){console.error(String(error));process.exitCode=65;}
}
