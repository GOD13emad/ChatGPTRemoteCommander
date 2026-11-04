import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {CapabilityGapRegistry,createCapabilityGapTools} from '../src/capability-gap-registry.mjs';
const make=()=>fs.mkdtempSync(path.join(os.tmpdir(),'commander-gap-'));
const issue=(o={})=>({
  capabilityKey:'gui.portal.owner-consent',projectKey:'commander-v2',
  category:'GUI',consentGate:'PORTAL_OWNER',title:'KDE portal native GUI observation',
  requiredBehavior:'Observe the existing GUI window without focus theft and with owner consent.',
  observedLimitation:'KDE Portal reports PORTAL_PERMISSION_NOT_GRANTED for an owner window.',
  errorCode:'PORTAL_PERMISSION_NOT_GRANTED',
  candidateSolution:'Use the supported portal dialog and persist only the scoped owner grant.',
  acceptanceTest:'Native window snapshot returns a valid image under authorized owner lease.',
  ...o
});
test('same owner profile upserts one gap across chats/projects without duplicating evidence',()=>{
 const dir=make();let a,b;
 try{
   a=new CapabilityGapRegistry({directory:dir,scope:'owner.profile',device:'MMZ'});
   b=new CapabilityGapRegistry({directory:dir,scope:'owner.profile',device:'EMAD'});
   let p=a.report(issue());assert.equal(p.created,true);
   assert.equal(p.record.observationCount,1);
   const prior=p.record.updatedAt;
   p=a.report(issue());assert.equal(p.changed,false);
   const variant=a.report(issue({title:'Native KDE portal screenshot denied in owner session',requiredBehavior:'Read an authorized KDE portal screenshot while keeping user focus unchanged.'}));
   assert.equal(variant.changed,false);
   assert.equal(variant.record.title,'KDE portal native GUI observation');
   assert.equal(p.record.revision,1);
   assert.equal(p.record.updatedAt,prior);
   p=a.report(issue({projectKey:'project-cfd'}));
   assert.equal(p.created,false);assert.equal(p.record.observationCount,2);
   assert.deepEqual(p.record.impactedProjects,['commander-v2','project-cfd']);
   p=b.report(issue({projectKey:'project-cfd',observedLimitation:'Portal owner grant missing in second host session.'}));
   assert.equal(p.record.observationCount,3);
   assert.deepEqual(p.record.impactedHosts,['EMAD','MMZ']);
   assert.equal(a.list().total,1);
   const c=new CapabilityGapRegistry({directory:dir,scope:'other.profile',device:'MMZ'});
   assert.equal(c.list().total,0);c.close();
 }finally{a?.close();b?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('no fake consent or PASS: triage stores action and guarded revision only',()=>{
 const dir=make();const c=new CapabilityGapRegistry({directory:dir,scope:'s',device:'D'});
 try{
   let p=c.report(issue());
   const o=p.record;
   assert.throws(()=>c.triage({capabilityKey:o.capabilityKey,expectedRevision:o.revision,state:'VERIFIED',
     candidateSolution:'Install the native portal owner agent',acceptanceTest:o.acceptanceTest}),/STATUS_INVALID/);
   p=c.triage({capabilityKey:o.capabilityKey,expectedRevision:o.revision,state:'BLOCKED',
     candidateSolution:'Request the KDE owner portal dialog using the native consent path.',
     acceptanceTest:'Observe owner window after explicit portal grant, and test denial beforehand.'});
   assert.equal(p.acceptanceVerified,false);
   assert.equal(p.record.state,'BLOCKED');
   assert.equal(p.record.revision,2);
   assert.throws(()=>c.triage({capabilityKey:o.capabilityKey,expectedRevision:o.revision,state:'TRIAGED',
     candidateSolution:'Different remediation plan with native consent.',acceptanceTest:'Test same GUI snap.'}),/REVISION_CONFLICT/);
   assert.equal(c.get(o.capabilityKey).state,'BLOCKED');
   assert.equal(c.list({state:'BLOCKED'}).items.length,1);
   assert.equal(c.list({state:'READY_FOR_QA'}).items.length,0);
 }finally{c.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('validate immutable key/category, sensitive evidence, path aliases and input limits',()=>{
 const dir=make();let c;
 try{
   c=new CapabilityGapRegistry({directory:dir,scope:'s',device:'MMZ'});
   c.report(issue());
   assert.throws(()=>c.report(issue({category:'BROWSER'})),/IDENTITY_CONFLICT/);
   assert.throws(()=>c.report(issue({observedLimitation:'Authorization: Bearer dummy-super-secret-12345'})),/POSSIBLE_SECRET/);
   assert.throws(()=>c.report(issue({capabilityKey:'../../overreach'})),/KEY_INVALID/);
   assert.throws(()=>c.report(issue({projectKey:'user with spaces'})),/PROJECT_INVALID/);
   assert.throws(()=>c.report(issue({consentGate:'ADMIN_UNRESTRICTED'})),/CONSENT_INVALID/);
   assert.equal(c.get('gui.portal.owner-consent').observationCount,1);
   assert.throws(()=>c.list({limit:99999}),/LIMIT_INVALID/);
   const link=dir+'-alias';fs.symlinkSync(dir,link,'dir');
   try{
     assert.throws(()=>new CapabilityGapRegistry({directory:link,scope:'s',device:'MMZ'}),/ALIAS_DENIED/);
     assert.throws(()=>new CapabilityGapRegistry({directory:path.join(link,'should-not-be-created'),scope:'s',device:'MMZ'}),/ALIAS_DENIED/);
     assert.equal(fs.existsSync(path.join(dir,'should-not-be-created')),false);
   }finally{fs.unlinkSync(link);}
 }finally{c?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrent processes share transactional SQLite with exact evidence dedup',()=>{
 const dir=make();const c=new CapabilityGapRegistry({directory:dir,scope:'s',device:'PRIMARY'});
 try{
   c.report(issue());
   const modulePath=new URL('../src/capability-gap-registry.mjs',import.meta.url).pathname;
   const code="import {CapabilityGapRegistry} from "+JSON.stringify('file://'+modulePath)+";const c=new CapabilityGapRegistry({directory:process.argv[1],scope:'s',device:'SECOND'});try{const r=c.report("+JSON.stringify(issue({projectKey:'project-other',observedLimitation:'Same owner portal issue on a second machine.'}))+");console.log(r.record.observationCount);}finally{c.close()}";
   const p=spawnSync(process.execPath,['--input-type=module','-e',code,dir],{encoding:'utf8',timeout:6000});
   assert.equal(p.status,0,p.stderr);
   assert.equal(p.stdout.trim(),'2');
   assert.equal(c.get('gui.portal.owner-consent').observationCount,2);
 }finally{c.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('MCP catalog announces report/list/triage with no privilege-granting effect',async()=>{
 const dir=make();const x=createCapabilityGapTools({directory:dir,scope:'s',device:'N'});
 try{
   assert.deepEqual(x.definitions.map(t=>t.name),['capability_gap_report','capability_gap_list','capability_gap_get','capability_gap_triage']);
   assert.equal(x.definitions[0].annotations.readOnlyHint,false);
   assert.equal(x.definitions[1].annotations.readOnlyHint,true);
   assert.equal(x.status().passClaimAllowed,false);
   assert.equal(x.status().authorizationEffects,false);
   const a=await x.execute('capability_gap_report',issue());
   assert.equal(a.record.state,'OPEN');
   assert.equal((await x.execute('capability_gap_list',{})).items.length,1);
   const detail=await x.execute('capability_gap_get',{capabilityKey:'gui.portal.owner-consent'});
   assert.equal(detail.observations.length,1);
   assert.equal(detail.observations[0].errorCode,'PORTAL_PERMISSION_NOT_GRANTED');
   assert.equal(detail.acceptanceVerified,false);
   await assert.rejects(x.execute('capability_gap_unknown',{}),/UNKNOWN_TOOL/);
 }finally{x.close();fs.rmSync(dir,{recursive:true,force:true});}
});


test('CLI is a fallback adapter using the same canonical private profile scope, with dedup',()=>{
 const root=make(),c=path.join(root,'config.json'),input=path.join(root,'issue.json');
 const delivery=path.join(root,'delivery');
 try{
  fs.writeFileSync(c,JSON.stringify({deviceName:'QA',allowedRoots:[path.join(root,'project')],durableDelivery:{directory:delivery,scope:'same-owner'}}),{mode:0o600});
  fs.mkdirSync(path.join(root,'project'),{mode:0o700});
  fs.writeFileSync(input,JSON.stringify(issue()),{mode:0o600});
  const cli=new URL('../tools/capability-gap-cli.mjs',import.meta.url).pathname;
  const run=(verb,withInput=false)=>spawnSync(process.execPath,[cli,verb,'--config',c,...(withInput?['--input',input]:[])],{encoding:'utf8'});
  let out=run('report',true);assert.equal(out.status,0,out.stderr);
  assert.equal(JSON.parse(out.stdout).created,true);
  out=run('report',true);assert.equal(out.status,0,out.stderr);
  assert.equal(JSON.parse(out.stdout).changed,false);
  out=run('status');assert.equal(out.status,0,out.stderr);
  assert.equal(JSON.parse(out.stdout).states.OPEN,1);
  fs.writeFileSync(input,JSON.stringify({capabilityKey:'gui.portal.owner-consent'}));
  out=run('get',true);assert.equal(out.status,0,out.stderr);
  assert.equal(JSON.parse(out.stdout).observations.length,1);
  out=run('list');assert.equal(out.status,0,out.stderr);
  assert.equal(JSON.parse(out.stdout).total,1);
  assert.equal(fs.statSync(path.join(delivery,'capability-gaps.sqlite')).mode&0o777,0o600);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('passive native error classification captures allowlisted gaps without storing tool arguments or grants',()=>{
 const root=make(),tools=createCapabilityGapTools({directory:root,scope:'owner',device:'MMZ'});
 try{
   const first=tools.captureFailure({tool:'workspace_target_snapshot',errorCode:'PORTAL_PERMISSION_NOT_GRANTED'});
   assert.equal(first.captured,true);
   assert.equal(first.changed,true);
   const again=tools.captureFailure({tool:'workspace_target_snapshot',errorCode:'PORTAL_PERMISSION_NOT_GRANTED'});
   assert.equal(again.captured,true);
   assert.equal(again.changed,false);
   const ignored=tools.captureFailure({tool:'run_shell',errorCode:'CUSTOM_NOT_SUPPORTED'});
   assert.equal(ignored.captured,false);
   assert.equal(tools.captureFailure({tool:'bad/secret-name',errorCode:'PORTAL_PERMISSION_NOT_GRANTED'}).captured,false);
   assert.equal(tools.captureFailure({tool:'workspace_target_snapshot',errorCode:'PORTAL_PERMISSION_NOT_GRANTED Authorization: Bearer xyzxyzxyzxyz'}).captured,true);
   const all=tools.status();
   assert.equal(all.autoCaptureKnownNativeErrors,true);
   assert.equal(all.authorizationEffects,false);
   const item=tools.execute('capability_gap_get',{capabilityKey:'gui.kde-portal.owner-grant'});
   return item.then(x=>{
     assert.equal(x.record.observationCount,1);
     assert.equal(x.observations[0].observedLimitation,'Commander tool workspace_target_snapshot reported native error PORTAL_PERMISSION_NOT_GRANTED.');
     assert.equal(JSON.stringify(x).includes('Bearer'),false);
   }).finally(()=>{tools.close();fs.rmSync(root,{recursive:true,force:true});});
 }catch(e){tools.close();fs.rmSync(root,{recursive:true,force:true});throw e;}
});
