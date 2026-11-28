// Explicit disposable CI recovery diagnostic; not a release-admission manifest.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fetchToolSchema,hashToolSchema} from '../tools/schema-continuity-gate.mjs';
const pin=Object.freeze({recoveryHead:'248b017f5c29f6d701e35e76fe00767a6f687d32',recoveryTree:'80d681d0ad5d4a42811b2faaeb5834d6e8ac24a9',recoveryVersion:'0.12.0-dev.13',rejectedDev12Head:'46a8256186e09f3355b10f796717aefee29ed309',releaseAuthorization:false});
export function recoveryPlan(version,head){
 if(version!==pin.recoveryVersion||typeof head!=='string'||!/^[0-9a-f]{40}$/.test(head)||head===pin.recoveryHead||head===pin.rejectedDev12Head)throw Error('RC012_RECOVERY_QA_SCOPE_DENIED');
 return {...pin,qualification:'same-schema-rc012',candidateHead:head};
}
export function catalogReceipt(tools){
 if(!Array.isArray(tools)||!tools.length||tools.some(t=>typeof t?.name!=='string'||!t.name)||new Set(tools.map(t=>t.name)).size!==tools.length)throw Error('RC012_RECOVERY_CATALOG_INVALID');
 const snapshot=tools.find(t=>t.name==='workspace_target_reconcile')?.inputSchema?.properties?.snapshotId;
 if(snapshot?.type!=='string'||snapshot.pattern!=='^[sbn][0-9a-f]{8}$')throw Error('RC012_RECOVERY_NATIVE_SCHEMA_REQUIRED');
 return {schemaSha256:hashToolSchema(tools),toolCount:tools.length,releaseAuthorization:false};
}
const invoked=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(invoked===import.meta.url){
 try{
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||!['Linux','Windows'].includes(process.env.RUNNER_OS)||!process.env.RUNNER_TEMP)throw Error('RC012_RECOVERY_QA_HOSTED_ONLY');
  const [mode,...args]=process.argv.slice(2);
  if(mode==='plan'&&args.length===2)console.log(JSON.stringify(recoveryPlan(...args)));
  else if(mode==='catalog'&&args.length===0)console.log(JSON.stringify(catalogReceipt(await fetchToolSchema('http://127.0.0.1:47831/mcp'))));
  else throw Error('RC012_RECOVERY_QA_ARGUMENTS');
 }catch(error){console.error(error.message);process.exitCode=2;}
}
