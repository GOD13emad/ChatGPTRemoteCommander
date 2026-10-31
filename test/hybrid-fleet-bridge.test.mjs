import test from 'node:test';
import assert from 'node:assert/strict';
import {createHybridFleetBridge} from '../src/hybrid-fleet-bridge.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const input={workflowId:'wf-1',stepId:'step-a',requestId:'evt-001',targetDevice:'host-linux',
 provider:'hatchet',effectClass:'COORDINATION',epoch:7,deadlineMs:Date.now()+3600000};
const verified=async()=>({approved:true,chatAuthenticated:true,rootLeaseVerified:true,
 ownerSessionAuthorized:true,providerHealthy:true,journalHealthy:true,
 principalRef:'chat-owner-1',rootLeaseRef:'root-lease-1',fenceEpoch:7});
function fixture({authorizer=verified,send,ackFailure=false}={}){
 const entries=new Map();
 const calls={sent:0,reserved:0,confirmed:0,uncertain:0};
 const journal={
  async reserve({requestId,digest,epoch}){
   calls.reserved++;
   if(entries.has(requestId))return {status:'EXISTS',state:entries.get(requestId).state};
   entries.set(requestId,{state:'PENDING',digest,epoch});return {status:'NEW'};
  },
  async confirm({requestId,digest}){calls.confirmed++;if(ackFailure)throw Error('db_io_error');
   assert.equal(entries.get(requestId).digest,digest);entries.get(requestId).state='ACKED';
  },
  async uncertain({requestId}){calls.uncertain++;entries.get(requestId).state='UNKNOWN';}
 };
 let bridge;
 bridge=createHybridFleetBridge({journal,authorize:authorizer,transport:{
  async submit(e){calls.sent++;return send?send(e):{accepted:true,requestId:e.requestId,digest:bridge.inspectEnvelope(e).digest};}
 }});
 return {bridge,calls,entries};
}
test('metadata-only scheduling with durable reservation before remote send',async()=>{
 const f=fixture();
 const result=await f.bridge.submit(input);
 assert.equal(result.status,'SCHEDULED');assert.equal(result.localEffectExecuted,false);
 assert.equal(f.calls.sent,1);assert.equal(f.calls.reserved,1);assert.equal(f.calls.confirmed,1);
 assert.equal(f.entries.get(input.requestId).state,'ACKED');
});
test('duplicate request and lost ACK cannot send a second time',async()=>{
 const f=fixture();
 assert.equal((await f.bridge.submit(input)).status,'SCHEDULED');
 assert.equal((await f.bridge.submit(input)).code,'DUPLICATE_OR_UNCERTAIN_NO_REPLAY');
 assert.equal(f.calls.sent,1);
});
test('async duplicate calls are fenced by atomic durable journal reservation',async()=>{
 const f=fixture({send:async e=>{await new Promise(r=>setTimeout(r,10));return {accepted:true,requestId:e.requestId,digest:f.bridge.inspectEnvelope(e).digest};}});
 const [a,b]=await Promise.all([f.bridge.submit(input),f.bridge.submit(input)]);
 assert.deepEqual([a.status,b.status].sort(),['BLOCKED','SCHEDULED']);
 assert.equal(f.calls.sent,1);
});
test('transport may send then throw; UNKNOWN is durable and never retried',async()=>{
 const f=fixture({send:async()=>{throw Error('lost ack after send');}});
 assert.equal((await f.bridge.submit(input)).code,'FLEET_DELIVERY_UNKNOWN_NO_REPLAY');
 assert.equal(f.entries.get(input.requestId).state,'UNKNOWN');
 assert.equal((await f.bridge.submit(input)).status,'BLOCKED');
 assert.equal(f.calls.sent,1);
});
test('malformed or rejected ACK stays uncertain, no blind retry',async()=>{
 const f=fixture({send:async()=>({accepted:true,requestId:'other',digest:'bad'})});
 assert.equal((await f.bridge.submit(input)).status,'UNCERTAIN');
 assert.equal((await f.bridge.submit(input)).status,'BLOCKED');
});
test('durable ACK recording failure does not replay after restart-like reentry',async()=>{
 const f=fixture({ackFailure:true});
 assert.equal((await f.bridge.submit(input)).code,'FLEET_ACK_NOT_DURABLE_NO_REPLAY');
 assert.equal((await f.bridge.submit(input)).status,'BLOCKED');
 assert.equal(f.calls.sent,1);
});
test('missing owner authorization or stale epoch blocks before journal or transport',async()=>{
 for(const grant of [{...await verified(),chatAuthenticated:false},{...await verified(),ownerSessionAuthorized:false},
  {...await verified(),rootLeaseVerified:false},{...await verified(),fenceEpoch:6},
  {...await verified(),providerHealthy:false},{...await verified(),journalHealthy:false}]){
  const f=fixture({authorizer:async()=>grant});
  assert.equal((await f.bridge.submit(input)).status,'BLOCKED');
  assert.equal(f.calls.reserved,0);assert.equal(f.calls.sent,0);
 }
});
test('malicious remote GUI, command arguments, credentials, identifiers rejected',async()=>{
 const f=fixture();
 for(const bad of [
  {...input,effectClass:'GUI_MUTATION'},
  {...input,effectClass:'BROWSER_PROFILE_MUTATION'},
  {...input,command:'pwsh'},
  {...input,credentials:'secret'},
  {...input,requestId:'../../dotdot'},
  {...input,epoch:0},
  {...input,provider:'custom-unverified'},
  {...input,deadlineMs:-1}
 ])await assert.rejects(f.bridge.submit(bad),/FLEET_ENVELOPE_INVALID/);
 assert.equal(f.calls.sent,0);assert.equal(f.calls.reserved,0);
});
test('verified envelope has no payload, hash binds metadata fields',async()=>{
 let seen;
 const f=fixture({send:async e=>{seen=e;return {accepted:true,requestId:e.requestId,digest:f.bridge.inspectEnvelope(e).digest};}});
 await f.bridge.submit(input);
 assert.equal(f.bridge.inspectEnvelope(seen).metadataOnly,true);
 assert.equal('command' in seen,false);assert.equal('token' in seen,false);
 assert.equal(Object.isFrozen(seen),true);
 assert.throws(()=>f.bridge.inspectEnvelope({...seen,unknown:true}),/FLEET_ENVELOPE_INVALID/);
});
test('constructor refuses missing real dependencies',()=>{
 for(const arg of [{},{journal:{},transport:{}},{journal:{reserve(){},confirm(){},uncertain(){}},
  transport:{submit(){}},authorize:false}])
 assert.throws(()=>createHybridFleetBridge(arg),/FLEET_BRIDGE_DEPENDENCY_MISSING/);
});

test('expired scheduling intent and expired received metadata fail closed',async()=>{
 const f=fixture();
 await assert.rejects(f.bridge.submit({...input,deadlineMs:Date.now()-1}),/FLEET_ENVELOPE_INVALID/);
 assert.equal(f.calls.sent,0);
 const later=createHybridFleetBridge({journal:{reserve:async()=>({status:'NEW'}),confirm:async()=>{},uncertain:async()=>{}},
  authorize:verified,transport:{submit:async()=>({})},now:()=>input.deadlineMs+1});
 await assert.rejects(later.submit(input),/FLEET_ENVELOPE_INVALID/);
});
test('SQLite reopen preserves uncertain transport reservation and blocks lost ACK replay',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'commander-fleet-ledger-'));
 const filename=path.join(dir,'journal.sqlite');
 let sent=0;
 function openJournal(){
  const db=new DatabaseSync(filename,{allowExtension:false});
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA busy_timeout=3000;');
  db.exec('CREATE TABLE IF NOT EXISTS intents (request TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL)');
  return {db,
   async reserve({requestId,digest}){
    db.exec('BEGIN IMMEDIATE');
    try{
     const q=db.prepare('INSERT OR IGNORE INTO intents(request,digest,state) VALUES(?,?,?)').run(requestId,digest,'PENDING');
     db.exec('COMMIT');
     return {status:q.changes===1?'NEW':'EXISTS'};
    }catch(e){db.exec('ROLLBACK');throw e;}
   },
   async confirm({requestId}){db.prepare('UPDATE intents SET state=? WHERE request=?').run('ACKED',requestId);},
   async uncertain({requestId}){db.prepare('UPDATE intents SET state=? WHERE request=?').run('UNKNOWN',requestId);}
  };
 }
 try{
  let j=openJournal();
  const a=createHybridFleetBridge({journal:j,authorize:verified,transport:{async submit(){sent++;throw Error('Lost ACK after remote acceptance');}}});
  assert.equal((await a.submit(input)).status,'UNCERTAIN');
  assert.equal(j.db.prepare('SELECT state FROM intents WHERE request=?').get(input.requestId).state,'UNKNOWN');
  j.db.close();
  j=openJournal();
  const b=createHybridFleetBridge({journal:j,authorize:verified,transport:{async submit(){sent++;return null;}}});
  const outcome=await b.submit(input);
  assert.equal(outcome.code,'DUPLICATE_OR_UNCERTAIN_NO_REPLAY');
  assert.equal(sent,1,'new process/session must not retry unknown external effect');
  j.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
