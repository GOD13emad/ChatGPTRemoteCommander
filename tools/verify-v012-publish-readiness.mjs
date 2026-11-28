import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {REQUIRED_ACCEPTANCE,REQUIRED_COMPONENTS,verifyV012Publication} from './universal-install/release-admission-0.12.mjs';
export {verifyV012Publication};

export function summarizeV012Readiness(manifest) {
 if(!manifest || manifest.train!=='0.12') throw Error('V108_V012_INVALID_READINESS_MANIFEST');
 const components=Array.isArray(manifest.components)?manifest.components:[];
 const byId=new Map(components.filter(x=>x&&typeof x.id==='string').map(x=>[x.id,x]));
 const missingComponents=REQUIRED_COMPONENTS.filter(id=>byId.get(id)?.verified!==true);
 const acceptance=manifest.acceptance&&typeof manifest.acceptance==='object'&&!Array.isArray(manifest.acceptance)
   ? manifest.acceptance : {};
 const missingAcceptance=REQUIRED_ACCEPTANCE.filter(id=>acceptance[id]!==true);
 const scope=manifest.fleetCoverage||{};
 const expected=Array.isArray(scope.expectedHostIds)?scope.expectedHostIds:[];
 const accepted=Array.isArray(scope.acceptedHostIds)?scope.acceptedHostIds:[];
 const missingHosts=expected.filter(id=>!accepted.includes(id));
 const targetVersion=typeof manifest.sourceVersion==='string'&&/^0\.12\.(?:0|[1-9][0-9]*)$/.test(manifest.sourceVersion)?manifest.sourceVersion:'0.12.0';
 let eligibleByManifest=false;
 try{verifyV012Publication(targetVersion,'v'+targetVersion,manifest);eligibleByManifest=true;}catch{}
 return {
  schema:'rc-v012-readiness-report-v1',targetVersion,
  sourceVersion:manifest.sourceVersion??null,manifestEligibilityOnly:eligibleByManifest,
  releasePromoted:manifest.isStable===true&&manifest.publishApproved===true,
  requiredComponents:REQUIRED_COMPONENTS.length,verifiedComponents:REQUIRED_COMPONENTS.length-missingComponents.length,
  missingComponents,
  requiredAcceptance:REQUIRED_ACCEPTANCE.length,verifiedAcceptance:REQUIRED_ACCEPTANCE.length-missingAcceptance.length,
  missingAcceptance,
  expectedHostCount:expected.length,acceptedHostCount:accepted.filter(id=>expected.includes(id)).length,
  missingHosts,
  mappingVerified:scope.mappingVerified===true,
  bootLoginAndRollbackVerified:scope.bootLoginAndRollbackVerified===true,
  externalEvidenceRequired:true,
  note:'Manifest eligibility is not independent proof of host identity, signature, installed artifacts, or owner approval.'
 };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length===3 && process.argv[2]==='--report') {
     const manifest=JSON.parse(readFileSync('docs/release-train-0.12.json','utf8'));
     console.log(JSON.stringify(summarizeV012Readiness(manifest)));
     process.exit(0);
   }
   if(process.argv.length!==4)throw Error('EXPECTED_VERSION_AND_TAG');
   const [version,tag]=process.argv.slice(2);
   const manifest=JSON.parse(readFileSync('docs/release-train-0.12.json','utf8'));
   console.log(verifyV012Publication(version,tag,manifest));
 }catch{
   console.error('V108_V012_PUBLICATION_DENIED');
   process.exitCode=2;
 }
}
