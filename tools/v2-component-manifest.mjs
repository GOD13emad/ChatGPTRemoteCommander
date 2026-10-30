// V2 R1: read-only reproducible component/source inventory.
// Never infer installation or activation from checked-in files.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPlan,validateCatalog} from './installer-product-plan.mjs';

const CORE=[
 'src/server-v0.3.mjs',
 'src/v2-routing-contract.mjs',
 'src/v2-authorized-operation.mjs',
 'src/v2-caller-assertion.mjs',
 'src/v2-grant-registry.mjs',
 'src/v2-mcp-oauth-contract.mjs',
 'src/v2-oauth-provider-preflight.mjs',
 'src/v2-oauth-caller.mjs',
 'src/v2-mcp-http-ingress.mjs',
 'src/v2-central-coordinator.mjs',
 'src/v2-coordinator-rpc.mjs',
 'src/v2-coordinator-rpc-client.mjs',
 'src/v2-guarded-artifact-actuator.mjs',
 'tools/v2-coordinator-host.mjs',
 'src/v2-workflow-gateway.mjs',
 'src/v2-coordinated-workflow.mjs',
 'src/v2-native-owner-session-bindings.mjs',
 'src/v2-native-window-bridge.mjs',
 'src/workspace-accessibility-tools.mjs',
 'tools/owner-atspi-semantic.py',
 'src/v2-fleet-readiness.mjs',
 'src/v2-install-identity-gate.mjs',
 'src/v2-migration-ledger.mjs',
 'tools/v2-migration-preflight.mjs',
 'tools/v2-enrollment-census.mjs',
 'tools/v2-component-manifest.mjs'
];
const PLATFORM={windows:['install.ps1','installer/RemoteCommander.iss',
 'desktop/install-windows.ps1','desktop/admin-runtime-windows.ps1'],
 linux:['install.sh','server-install-linux.sh',
 'tools/rc-private-gui.py']};
const SHA=/^[a-f0-9]{64}$/;
function fail(code){throw Object.assign(new Error(code),{code});}
function read(root,file){
 const components=file.split('/');
 let current=root;
 for(const part of components){
  current=path.join(current,part);
  if(!fs.existsSync(current))return null;
  const st=fs.lstatSync(current);
  if(st.isSymbolicLink())fail('V2_R1_SOURCE_ALIAS_FORBIDDEN');
 }
 const st=fs.lstatSync(current);
 if(!st.isFile()||st.nlink!==1||st.size>16*1024*1024)
  fail('V2_R1_SOURCE_INVALID');
 return createHash('sha256').update(fs.readFileSync(current)).digest('hex');
}
export function buildV2ComponentManifest({root,platform,installedEvidence=null}={}){
 if(!['windows','linux'].includes(platform))fail('V2_R1_PLATFORM_INVALID');
 if(typeof root!=='string'||!path.isAbsolute(root))fail('V2_R1_ROOT_REQUIRED');
 const requested=path.resolve(root);
 let source;
 try{source=fs.realpathSync.native(requested);}
 catch{fail('V2_R1_ROOT_UNREADABLE');}
 // Reject root aliases as well as in-tree symlinks: a manifest of an
 // unexpected physical tree must never be treated as a signed source root.
 const normalized=x=>process.platform==='win32'?path.normalize(x).toLowerCase():path.normalize(x);
 if(normalized(source)!==normalized(requested))
   fail('V2_R1_ROOT_ALIAS_FORBIDDEN');
 const pkgPath=path.join(source,'package.json');
 let pkgInfo;
 try{pkgInfo=fs.lstatSync(pkgPath);}
 catch{fail('V2_R1_PACKAGE_INVALID');}
 if(!pkgInfo.isFile()||pkgInfo.isSymbolicLink()||pkgInfo.nlink!==1||
    pkgInfo.size<2||pkgInfo.size>1024*1024)
   fail('V2_R1_PACKAGE_INVALID');
 let pkg;
 try{pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));}
 catch{fail('V2_R1_PACKAGE_INVALID');}
 if(!pkg||typeof pkg!=='object'||Array.isArray(pkg)||
    typeof pkg.version!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(pkg.version))
  fail('V2_R1_VERSION_INVALID');
 validateCatalog();
 const all=[...CORE,...PLATFORM[platform]];
 const components=all.map(file=>({path:file,sha256:read(source,file)}));
 const missing=components.filter(x=>x.sha256===null).map(x=>x.path);
 const plan=createPlan({platform,all:true,browserBundled:false});
 let admitted=false;
 if(installedEvidence!==null){
  if(!installedEvidence||typeof installedEvidence!=='object'||
   Object.keys(installedEvidence).sort().join(',')!=='exactBuildSha256,liveVersion,ownerSessionAttested,runtimeComponentsVerified'||
   typeof installedEvidence.liveVersion!=='string'||typeof installedEvidence.exactBuildSha256!=='string'||
   !SHA.test(installedEvidence.exactBuildSha256)||
   typeof installedEvidence.ownerSessionAttested!=='boolean'||
   typeof installedEvidence.runtimeComponentsVerified!=='boolean')
   fail('V2_R1_INSTALLED_EVIDENCE_INVALID');
  // Even with an exact version string there is no runtime hash attestation
  // at this source-manifest-only layer. Never return admitted=true here.
 }
 return Object.freeze({schema:1,platform,sourceVersion:pkg.version,
  components:Object.freeze(components.map(x=>Object.freeze(x))),
  componentsComplete:missing.length===0,missing:Object.freeze(missing),
  sourceDigest:createHash('sha256').update(
    JSON.stringify(components)).digest('hex'),
  installNow:Object.freeze(plan.installNow),
  pendingActivation:Object.freeze(plan.pendingActivation),
  unavailable:Object.freeze(plan.unavailable),
  browserBundled:false,changesApplied:false,
  installedRuntimeAttested:false,ownerGrantsAttested:false,
  releaseAdmitted:admitted});
}
const own=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===own){
 try{
  if(process.argv.length!==4||!['windows','linux'].includes(process.argv[3]))
   fail('V2_R1_USAGE');
  const result=buildV2ComponentManifest({root:process.argv[2],platform:process.argv[3]});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.componentsComplete)process.exitCode=3;
 }catch(e){
  process.stderr.write((e.code??'V2_R1_MANIFEST_FAILED')+'\n');
  process.exitCode=2;
 }
}
