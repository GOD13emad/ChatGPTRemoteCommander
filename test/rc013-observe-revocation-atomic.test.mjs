import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ProjectCoordinationDirectory } from '../src/project-coordination-directory.mjs';

const HASH = 'a'.repeat(64);
test('revocation by another SQLite connection before write transaction rejects stale member observation', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(),'rc013-atomic-membership-'));
  const root = path.join(base,'project');
  fs.mkdirSync(root);
  const attest = {
    source:'TRUSTED_CONNECTOR_ROUTE',verified:true,
    hostId:'host-a',principalId:'owner-a',profileId:'profile-a',
    conversationId:'chat-a',bindingId:'binding-a',tunnelBindingHash:HASH
  };
  const ledger = new ProjectCoordinationDirectory({
    directory:path.join(base,'private'),resolveAttestedRoute:async()=>attest,
    authorizeProject:async()=>true
  });
  t.after(()=>{try{ledger.close();}catch{}fs.rmSync(base,{recursive:true,force:true});});
  await ledger.enroll({projectId:'project-1',root,ownerProof:'fixture-only'});
  const childCode = [
    "const {DatabaseSync}=require('node:sqlite');",
    "const db=new DatabaseSync(process.argv[1]);",
    "db.exec('PRAGMA busy_timeout=2500; BEGIN IMMEDIATE');",
    "db.prepare('DELETE FROM contexts WHERE project_id=? AND conversation=?').run('project-1','chat-a');",
    "process.stdout.write('LOCKED\\n');",
    "setTimeout(()=>{db.exec('COMMIT');db.close();},500);"
  ].join('');
  const child=spawn(process.execPath,['-e',childCode,path.join(base,'private','project-conversations.sqlite')],{
    stdio:['ignore','pipe','pipe']
  });
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const [ready] = await once(child.stdout,'data');
  assert.match(String(ready),/LOCKED/);
  await assert.rejects(ledger.observe('project-1',{
    eventKey:'revoked-event',operationId:'op-1',
    outcome:'OBSERVED',evidenceSha256:HASH
  }), e=>e?.projectHubCode==='PROJECT_HUB_CURRENT_CHAT_NOT_MEMBER');
  if(child.exitCode===null)await once(child,'close');
  // The revoked principal must not have created any event.
  const {DatabaseSync}=await import('node:sqlite');
  const db=new DatabaseSync(path.join(base,'private','project-conversations.sqlite'));
  try{
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contexts').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,0);
  }finally{db.close();}
});
