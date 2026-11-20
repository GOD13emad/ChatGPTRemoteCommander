#!/usr/bin/env node
// One explicit release entrypoint for desktop and headless Commander V2.
// Existing V1 capability policy, transport and ChatGPT owner permissions remain
// enforced by their native runtimes; this launcher grants no new OS privilege.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const fail=code=>{throw Error('V012_ENTRY_'+code)};
export function inspectPayload(base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 const spec=JSON.parse(fs.readFileSync(path.join(base,'PRODUCT.json'),'utf8'));
 if(spec.schema!==1||spec.product!=='Commander V2'||!/^0\.12\.0-rc\.[0-9]+$/.test(spec.version)
   ||spec.sourceCoreVersion!=='0.11.0-dev.19'||spec.featureScope!=='CANDIDATE_RUNTIME_NOT_STABLE')
  fail('PRODUCT_IDENTITY_CHANGED');
 const entry={desktop:'desktop/v2-workspace/desktop-app.mjs',
   headless:'src/server-v0.3.mjs'};
 for(const f of Object.values(entry)){
  if(!fs.statSync(path.join(base,f)).isFile())fail('COMPONENT_MISSING');
 }
 return {product:spec.product,version:spec.version,sourceCoreVersion:spec.sourceCoreVersion,
  mode:spec.mode,runtimes:entry,fullPowerReady:false,
  chatOwnerGrantEstablished:false,liveProfileMigrationVerified:false,
  nativeOsInstallRegistered:false,stableRelease:false};
}
export function main(argv=process.argv.slice(2)){
 if(argv.length!==1||!['inspect','desktop','headless'].includes(argv[0]))fail('COMMAND_REQUIRED');
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const status=inspectPayload(base);
 if(argv[0]==='inspect'){process.stdout.write(JSON.stringify(status)+'\n');return;}
 // Required for any attempt to run; not a substitute for native profile grants.
 if(process.env.V012_EXPLICIT_OWNER_RUN!=='1')fail('EXPLICIT_OWNER_RUN_REQUIRED');
 const route=status.runtimes[argv[0]];
 const child=spawnSync(process.execPath,[path.join(base,route)],{stdio:'inherit',windowsHide:false});
 if(child.error||child.signal||child.status!==0)fail('COMPONENT_EXIT_FAILURE');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}catch(e){console.error(e.message?.startsWith('V012_ENTRY_')?e.message:'V012_ENTRY_FAILED');process.exitCode=2;}
}
