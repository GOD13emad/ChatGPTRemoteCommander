#!/usr/bin/env node
// Owner-local, interactive reconciliation of one historical native GUI input.
// Never replays an action, touches the desktop, or accepts unattended --yes.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout,stderr} from 'node:process';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

const outcomes={
  '1':'observed-applied',
  '2':'observed-not-applied',
  '3':'unconfirmed-no-replay'
};
export async function main(args=process.argv.slice(2),{store=createGuiInputIncidentStore(),
  input=stdin,output=stdout,error=stderr}={}) {
  if (args.length!==1 || !['--status','--review'].includes(args[0])) {
    output.write('Usage: node tools/gui-incident-recover.mjs --status | --review\n');
    return 2;
  }
  const incident=await store.pending();
  if (!incident) {
    output.write('NO_PENDING_GUI_INCIDENT; no native input was sent.\n');
    return 0;
  }
  output.write(JSON.stringify({pending:true,incident,autoExpiry:false,neverAutoReplay:true})+'\n');
  if(args[0]==='--status')return 0;
  // A chat, web call, background shell or piped answer cannot supply this consent.
  // This check is not a replacement for OS account permissions or human judgment.
  if(!input.isTTY || !output.isTTY) {
    error.write('GUI_OWNER_INTERACTIVE_TTY_REQUIRED: run locally in your own terminal.\n');
    return 3;
  }
  const rl=createInterface({input,output,terminal:true});
  try {
    output.write('Inspect the current desktop first. Do NOT repeat the original action.\n');
    output.write('1: observed applied; 2: observed NOT applied; 3: cannot determine (accept no replay)\n');
    const choice=(await rl.question('Disposition [1/2/3]: ')).trim();
    const disposition=outcomes[choice];
    if(!disposition) { error.write('GUI_REVIEW_CANCELLED\n');return 4; }
    const phrase='REVIEW '+incident.id;
    if((await rl.question('To archive this exact incident without replay, type '+phrase+': ')).trim()!==phrase){
      error.write('GUI_REVIEW_CANCELLED\n');return 4;
    }
    const result=await store.review({...incident,disposition,confirmation:phrase});
    output.write(JSON.stringify(result)+'\n');
    return 0;
  } finally { rl.close(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    stderr.write('GUI_INCIDENT_RECOVERY_FAILED: '+String(error?.guiCode??error?.message??'UNKNOWN')+'\n');
    process.exitCode=5;
  });
}
