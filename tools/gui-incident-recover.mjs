#!/usr/bin/env node
// READ ONLY. This CLI intentionally cannot release historical native GUI
// incidents, even if called from a PTY, shell or a remote Commander session.
// No interactive text or same-user file can establish trusted owner authority.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stdout,stderr} from 'node:process';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

export async function main(args=process.argv.slice(2),{store=createGuiInputIncidentStore(),
  output=stdout,error=stderr}={}) {
  if(args.length!==1||!['--status','--plan','--review'].includes(args[0])){
    output.write('Usage: node tools/gui-incident-recover.mjs --status | --plan\n');
    return 2;
  }
  if(args[0]==='--review'){
    error.write('GUI_OWNER_RECONCILIATION_NOT_IMPLEMENTED: no trusted native owner broker; no incident was changed.\n');
    return 3;
  }
  const incident=await store.pending();
  if(!incident){
    output.write(JSON.stringify({pending:false,ownerReviewAvailable:false,
      noReplay:true,noReleasePerformed:true})+'\n');
    return 0;
  }
  const status={pending:true,incident,ownerReviewAvailable:false,
    nativeOutcome:'UNKNOWN',noReplay:true,noReleasePerformed:true,
    next:'TRUSTED_NATIVE_GUI_COORDINATOR_AND_OWNER_REVIEW_REQUIRED'};
  output.write(JSON.stringify(status)+'\n');
  return 0;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main().then(code=>{process.exitCode=code;}).catch(e=>{
    stderr.write('GUI_INCIDENT_INSPECTION_FAILED: '+String(e?.guiCode??e?.message??'UNKNOWN')+'\n');
    process.exitCode=5;
  });
}
