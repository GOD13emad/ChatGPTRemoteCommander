#!/usr/bin/env node
// R173: choose the EXACT failed updater qualification stage before SHA attestation.
// Never prints log data, filenames, URLs, secrets, paths, or diagnostic contents.
import fs from 'node:fs';
import path from 'node:path';
function deny(){console.error('R173_STAGE_SELECTION_FAIL_CLOSED');process.exitCode=3;}
try{
 const file=process.argv[2],sha=process.argv[3];
 if(process.argv.length!==4||typeof file!=='string'||!path.isAbsolute(file)||
   typeof sha!=='string'|| !/^[0-9a-f]{40}$/.test(sha))
   throw Error('INPUT');
 const info=fs.lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>2097152)
   throw Error('FILE');
 const text=fs.readFileSync(file,'utf8');
 const lines=text.split(/\r?\n/);
 const failed=lines.map(x=>x.match(new RegExp(
  '^AUTO_UPDATE_FAIL GATE_FAIL (check|test) exit=[1-9][0-9]* runId=(qualification-\\1-'+sha.slice(0,12)+'-[0-9a-f]{32})(?:\\s|$)')))
  .filter(Boolean);
 if(failed.length!==1)throw Error('FAIL_AMBIGUOUS');
 const stage=failed[0][1],id=failed[0][2];
 const files=lines.filter(x=>x.startsWith('GATE_OUTPUT_FILES runId='+id+' stdout='));
 const hashes=lines.filter(x=>x.startsWith('GATE_OUTPUT_HASH runId='+id+' stdoutSha256='));
 if(files.length!==1||hashes.length!==1)throw Error('EVIDENCE_AMBIGUOUS');
 console.log('R173_FAILED_STAGE_ID='+id);
}catch{deny();}
