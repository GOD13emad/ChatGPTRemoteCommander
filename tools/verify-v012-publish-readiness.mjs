import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Release admission must not infer fleet approval from a tag or a CI artifact.
const REQUIRED_ACCEPTANCE = [
 'sourceTests','securityScan','allProductBuilds','authAndGui',
 'multiUserPermissions','stableInstallRoots','rollback',
 'fiveHostsRuntime','signingOrApprovedProvenance'
];
const REQUIRED_COMPONENTS = [
 'core','browser-commander','control-center','transfer-mesh',
 'workflow-project-engine','local-ai-workers','gui-same-owner',
 'multi-user-access','updater-installer'
];

export function verifyV012Publication(version,tag,manifest) {
 const deny=()=>{throw Error('V108_V012_RELEASE_APPROVAL_DENIED');};
 if(version!=='0.12.0'||tag!=='v0.12.0')deny();
 if(!manifest||manifest.schema!=='rc-suite-release-train-v1'||
    manifest.train!=='0.12'||manifest.sourceVersion!==version||
    manifest.targetPrerelease!=='0.12.0'||
    manifest.status!=='RELEASE_APPROVED'||
    manifest.channel!=='release'||manifest.isStable!==true||
    manifest.publishApproved!==true||
    manifest.autoupdateApproved!==true||
    manifest.installedPromotionApproved!==true||
    manifest.releaseTag!==tag||
    !/^[0-9a-f]{40}$/.test(manifest.sourceBaseSha||''))deny();
 if(!Array.isArray(manifest.components)||
    manifest.components.length<REQUIRED_COMPONENTS.length)deny();
 const ids=new Set();
 for(const component of manifest.components){
   if(!component||typeof component.id!=='string'||ids.has(component.id)||
     component.required!==true||component.verified!==true)deny();
   ids.add(component.id);
 }
 if(REQUIRED_COMPONENTS.some(id=>!ids.has(id)))deny();
 if(!manifest.acceptance||typeof manifest.acceptance!=='object'||
    Array.isArray(manifest.acceptance))deny();
 if(REQUIRED_ACCEPTANCE.some(id=>manifest.acceptance[id]!==true)||
    Object.values(manifest.acceptance).some(value=>value!==true))deny();
 if(!Array.isArray(manifest.fleet)||manifest.fleet.length<5||
    new Set(manifest.fleet).size!==manifest.fleet.length)deny();
 if(manifest.distribution?.noPublicStableAccepted!==false||
    manifest.distribution?.keepAssetsAndTags!==true||
    manifest.distribution?.oldReleasesHistorical!==true)deny();
 return 'V108_V012_RELEASE_APPROVED_MANIFEST_PASS';
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length!==4)throw Error('EXPECTED_VERSION_AND_TAG');
   const [version,tag]=process.argv.slice(2);
   const manifest=JSON.parse(readFileSync('docs/release-train-0.12.json','utf8'));
   console.log(verifyV012Publication(version,tag,manifest));
 }catch{
   console.error('V108_V012_PUBLICATION_DENIED');
   process.exitCode=2;
 }
}
