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
  let incident;
  try{incident=await store.inspect();}
  catch(e){
    if(e?.guiCode!=='GUI_INCIDENT_RECOVERY_REQUIRED')throw e;
    // A prepared, archived or purportedly completed review is NOT proof
    // that a trusted native broker cleared the original uncertain effect.
    // inspectRecovery is strictly forensic: even a matching archive,
    // prepared marker or purported terminal cannot authorize a release.
    let recovery=null,inspectionError=null;
    try{recovery=await store.inspectRecovery();}
    catch{inspectionError='GUI_INCIDENT_STORAGE_UNAVAILABLE';}
    output.write(JSON.stringify({
      pending:null,recoveryRequired:true,ownerReviewAvailable:false,
      nativeOutcome:'UNKNOWN',noReplay:true,noReleasePerformed:true,
      releaseAuthorized:false,disposition:'BLOCKED_UNRECONCILED_REVIEW_ARTIFACT',
      recovery,inspectionError
    })+'\n');
    return inspectionError?5:4;
  }
  if(!incident){
    output.write(JSON.stringify({pending:false,ownerReviewAvailable:false,
      nativeOutcome:null,noReplay:true,noReleasePerformed:true,
      releaseAuthorized:false})+'\n');
    return 0;
  }
  const status={
    pending:true,
    incident:{id:incident.id,tool:incident.tool,startedUtc:incident.startedUtc},
    evidence:{sha256:incident.evidenceSha256,bytes:incident.evidenceBytes},
    nativeOutcome:'UNKNOWN',ownerReviewAvailable:false,noReplay:true,
    noReleasePerformed:true,releaseAuthorized:false
  };
  if(args[0]==='--plan'){
    output.write(JSON.stringify({
      ...status,readOnlyPreflight:true,
      disposition:'BLOCKED_NO_TRUSTED_RECONCILIATION',
      prerequisites:[
        'VERIFY_CURRENT_DESKTOP_WITH_OWNER',
        'VERIFY_ALL_NATIVE_DISPATCHERS_QUIESCENT',
        'TRUSTED_OS_LOCAL_OWNER_BROKER_REQUIRED',
        'CRASH_SAFE_EXACT_INCIDENT_REVIEW_NOT_IMPLEMENTED'
      ]
    })+'\n');
  }else{
    output.write(JSON.stringify(status)+'\n');
  }
  return 0;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main().then(code=>{process.exitCode=code;}).catch(e=>{
    stderr.write('GUI_INCIDENT_INSPECTION_FAILED: '+String(e?.guiCode??e?.message??'UNKNOWN')+'\n');
    process.exitCode=5;
  });
}
