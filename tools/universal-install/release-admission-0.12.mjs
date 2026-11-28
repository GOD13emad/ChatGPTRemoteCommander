// Release admission must not infer fleet approval from a tag or a CI artifact.
export const REQUIRED_ACCEPTANCE = [
 'sourceTests','securityScan','allProductBuilds','authAndGui',
 'multiUserPermissions','stableInstallRoots','rollback',
 'fiveHostsRuntime','signingOrApprovedProvenance'
];
export const REQUIRED_COMPONENTS = [
 'core','browser-commander','control-center','transfer-mesh',
 'workflow-project-engine','local-ai-workers','gui-same-owner',
 'multi-user-access','updater-installer'
];

export function verifyV012Publication(version,tag,manifest) {
 const deny=()=>{throw Error('V108_V012_RELEASE_APPROVAL_DENIED');};
 if(typeof version!=='string'||!/^0\.12\.(?:0|[1-9][0-9]*)$/.test(version)||tag!=='v'+version)deny();
 if(!manifest||manifest.schema!=='rc-suite-release-train-v1'||
    manifest.train!=='0.12'||manifest.sourceVersion!==version||
    manifest.targetPrerelease!=='0.12.0'||
    manifest.firstStable!=='0.12.0'||manifest.majorTarget!=='1.0.0'||
    manifest.status!=='RELEASE_APPROVED'||
    manifest.channel!=='stable'||manifest.isStable!==true||
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
 // Historical fiveHostsRuntime alone is insufficient for all known Commander 1 connectors.
 const coverage=manifest.fleetCoverage;
 if(!coverage||coverage.scope!=='all-known-commander1-connectors'||
    coverage.mappingVerified!==true||
    coverage.bootLoginAndRollbackVerified!==true||
    !Array.isArray(coverage.expectedHostIds)||coverage.expectedHostIds.length<8||
    !Array.isArray(coverage.acceptedHostIds)||
    new Set(coverage.expectedHostIds).size!==coverage.expectedHostIds.length||
    new Set(coverage.acceptedHostIds).size!==coverage.acceptedHostIds.length||
    coverage.expectedHostIds.some(id=>typeof id!=='string'||!id.trim())||
    coverage.acceptedHostIds.some(id=>typeof id!=='string')||
    coverage.acceptedHostIds.length!==coverage.expectedHostIds.length||
    coverage.expectedHostIds.some(id=>!coverage.acceptedHostIds.includes(id)))deny();
 if(manifest.distribution?.noPublicStableAccepted!==false||
    manifest.distribution?.keepAssetsAndTags!==true||
    manifest.distribution?.oldReleasesHistorical!==true)deny();
 return 'V108_V012_RELEASE_APPROVED_MANIFEST_PASS';
}

// A single product release has two platform artifacts. This validates
// inventory only; downloaded bytes still require pinned Sigstore verification.
function nativeAssetSet(release,tagPattern) {
 const tag=release?.tag_name;
 if(typeof tag!=='string'||!tagPattern.test(tag)
    ||!Array.isArray(release.assets)||release.assets.length!==2)return null;
 const version=tag.slice(1);
 const names={linux:'Remote-Commander-Unified-'+version+'-Linux-amd64.deb',
   win32:'Remote-Commander-Unified-'+version+'-Windows-x64.exe'};
 const selected={};
 for(const [platform,name] of Object.entries(names)){
   const matches=release.assets.filter(a=>a?.name===name);
   if(matches.length!==1)return null;
   const a=matches[0];
   if(a.state!=='uploaded'||!Number.isSafeInteger(a.size)||a.size<1024
     ||a.size>1536*1024*1024||!/^sha256:[a-f0-9]{64}$/.test(a.digest??''))return null;
   selected[platform]=a;
 }
 return selected;
}
export function nativeV012ReleaseAssetSet(release){
 return nativeAssetSet(release,/^v0\.12\.(?:0|[1-9][0-9]*)$/);
}

// Inventory-only development candidate. Never an authorization to publish,
// stage, install or promote; stable admission deliberately excludes it.
export function nativeV012DevCandidateAssetSet(release){
 return nativeAssetSet(release,/^v0\.12\.0-dev\.[1-9][0-9]*$/);
}
export function isV012InstalledVersion(version){
 return typeof version==='string'&&
   /^0\.12\.(?:0|[1-9][0-9]*)(?:(?:-|~)(?:dev|rc)\.[1-9][0-9]*)?$/.test(version);
}
