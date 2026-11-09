#!/usr/bin/env node
// Read-only, nonsecret R8 identity continuity preflight. Never migrates data.
// Run with two separately owner-attested inventory files and a pinned digest.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyV2MigrationPreservation} from '../src/v2-migration-ledger.mjs';

function fail(code){throw Object.assign(new Error(code),{code});}
function readInventory(file){
 if(typeof file!=='string'||!path.isAbsolute(file))fail('V2_PREFLIGHT_ABSOLUTE_PATH_REQUIRED');
 const info=fs.lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8*1024*1024||info.size<2)
  fail('V2_PREFLIGHT_FILE_INVALID');
 const data=fs.readFileSync(file,'utf8');
 let decoded;
 try{decoded=JSON.parse(data);}
 catch{fail('V2_PREFLIGHT_JSON_INVALID');}
 // The snapshot producer MUST write JSON.stringify output. Requiring that
 // byte form makes duplicate JSON member names, ambiguous numeric forms and
 // post-parse key overwrite an explicit rejection instead of a hidden merge.
 if(data.trim()!==JSON.stringify(decoded))
   fail('V2_PREFLIGHT_CANONICAL_JSON_REQUIRED');
 return decoded;
}
export function executeV2MigrationPreflight(argv){
 if(!Array.isArray(argv)||argv.length!==6||
    argv[0]!=='--baseline'||argv[2]!=='--proposed'||argv[4]!=='--baseline-digest')
  fail('V2_PREFLIGHT_USAGE');
 if(!/^[a-f0-9]{64}$/.test(argv[5]))fail('V2_PREFLIGHT_DIGEST_INVALID');
 const b=path.resolve(argv[1]),p=path.resolve(argv[3]);
 if(b===p)fail('V2_PREFLIGHT_DISTINCT_SNAPSHOTS_REQUIRED');
 const out=verifyV2MigrationPreservation({
  baseline:readInventory(b),proposed:readInventory(p),baselineDigest:argv[5]
 });
 return Object.freeze({
  schema:1,status:out.preservationReady?'METADATA_PRESERVATION_PRECHECK_READY':'PRESERVATION_BLOCKED',
  cutoverAccepted:false,hostId:out.hostId,baselineDigest:out.baselineDigest,
  proposedDigest:out.proposedDigest,baselineCounts:out.baselineCounts,
  proposedCounts:out.proposedCounts,credentialUsability:out.credentialUsability,
  differences:out.differences,
  // Future independent gates: credential usability, owner-session binding,
  // live tunnels, installed binaries, workflow receipt reopen and rollback.
  next:'INDEPENDENT_LIVE_CUTOVER_ACCEPTANCE_REQUIRED'
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 try{
  const result=executeV2MigrationPreflight(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.status!=='METADATA_PRESERVATION_PRECHECK_READY')process.exitCode=3;
 }catch(e){
  process.stderr.write((typeof e?.code==='string'&&/^V2_(?:PREFLIGHT|MIGRATION)_/.test(e.code)
    ?e.code:'V2_PREFLIGHT_FAILED')+'\n');
  process.exitCode=2;
 }
}
