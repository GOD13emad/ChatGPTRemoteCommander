import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkContract } from '../tools/release-retirement-gate.mjs';

const helper=fileURLToPath(new URL('../tools/release-retirement-gate.mjs',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fixedActive='a'.repeat(40);
function gate(f,allow,reason){
 const r=spawnSync(process.execPath,[helper,'--state-root',f.state,
  '--release-root',f.releases,'--routing-root',f.routing,'--target',f.target],
  {encoding:'utf8',timeout:15000});
 assert.equal(r.status,allow?0:3,'Exit '+r.status+' stderr '+r.stderr+' stdout '+r.stdout);
 const got=JSON.parse(r.stdout.trim());
 assert.equal(got.allow,allow);
 if(reason)assert.equal(got.reason,reason);
}
function fixture(t){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-r204-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const state=path.join(tmp,'state'),releases=path.join(state,'releases'),
  routing=path.join(state,'routing'),maintenance=path.join(state,'maintenance');
 for(const dir of [releases,routing,maintenance])fs.mkdirSync(dir,{recursive:true});
 let target=path.join(releases,'fixture-initial');
 execFileSync('git',['init','-q',target],{timeout:10000});
 fs.writeFileSync(path.join(target,'package.json'),'{"version":"0.10.20"}\n');
 execFileSync('git',['-C',target,'add','package.json'],{timeout:10000});
 execFileSync('git',['-C',target,'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-q','-m','fixture'],{timeout:10000});
 const old=execFileSync('git',['-C',target,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const name='v0.10.20-'+old.slice(0,12);
 const real=path.join(releases,name);
 fs.renameSync(target,real);target=real;
 const routeFile=path.join(routing,'default.json');
 const route={schema:1,profile:'default',generation:10,
  active:{port:48831,version:'0.10.21',commit:fixedActive,
   configSha256:'b'.repeat(64),configPath:path.join(state,'config.json'),
   projectDir:path.join(tmp,'candidate-v0.10.21')},previous:null};
 const writeRoute=()=>fs.writeFileSync(routeFile,JSON.stringify(route)+'\n');
 writeRoute();
 const ticketFile=path.join(maintenance,'release-retirement-acceptance.json');
 const ticket={schema:1,intent:'OWNER_APPROVED_ONE_RETIRED_CORE_RELEASE',
  ownerApproved:true,targetName:name,targetCommit:old,activeCommit:fixedActive,
  approvedAtUtc:new Date(Date.now()-30000).toISOString(),
  expiresAtUtc:new Date(Date.now()+300000).toISOString(),
  routeHashes:{'default.json':sha(fs.readFileSync(routeFile))},
  acceptedChecks:{applicationFunctional:true,browserProfilePreserved:true,
   workflowHistoryPreserved:true,rollbackVerified:true}};
 const writeTicket=()=>fs.writeFileSync(ticketFile,JSON.stringify(ticket)+'\n');
 return{tmp,state,releases,routing,target,route,routeFile,ticket,writeTicket,writeRoute,old};
}
test('R204 pure policy requires one exact scoped timely owner-accepted ticket',()=>{
 const name='v0.10.20-123456789abc',old='123456789abc'+'f'.repeat(28);
 const target='/test/data/'+name;
 const base={targetName:name,targetCommit:old,activeCommit:fixedActive,
  routeHashes:{'default.json':'e'.repeat(64)},referencedPaths:[],
  retainedPaths:[],targetPath:target};
 assert.equal(checkContract({...base,ticket:null}).reason,'OWNER_ACCEPTANCE_REQUIRED');
 const ticket={schema:1,intent:'OWNER_APPROVED_ONE_RETIRED_CORE_RELEASE',
  ownerApproved:true,targetName:name,targetCommit:old,activeCommit:fixedActive,
  approvedAtUtc:new Date(Date.now()-10000).toISOString(),
  expiresAtUtc:new Date(Date.now()+300000).toISOString(),
  routeHashes:base.routeHashes,
  acceptedChecks:{applicationFunctional:true,browserProfilePreserved:true,
   workflowHistoryPreserved:true,rollbackVerified:true}};
 assert.equal(checkContract({...base,ticket}).allow,true);
 assert.equal(checkContract({...base,ticket:{...ticket,ownerApproved:false}}).allow,false);
 assert.equal(checkContract({...base,ticket:{...ticket,acceptedChecks:{...ticket.acceptedChecks,browserProfilePreserved:false}}}).reason,'ACCEPTANCE_GATES_OPEN');
 assert.equal(checkContract({...base,ticket:{...ticket,routeHashes:{'default.json':'a'.repeat(64)}}}).reason,'ROUTE_HASH_STALE');
 assert.equal(checkContract({...base,ticket:{...ticket,targetName:'v0.10.19-123456789abc'}}).reason,'TARGET_IDENTITY_MISMATCH');
 assert.equal(checkContract({...base,ticket:{...ticket,expiresAtUtc:new Date(Date.now()-1).toISOString()}}).reason,'APPROVAL_EXPIRED_OR_INVALID');
 assert.equal(checkContract({...base,ticket,referencedPaths:[target]}).reason,'TARGET_STILL_REFERENCED');
 assert.equal(checkContract({...base,ticket,retainedPaths:[target]}).reason,'TARGET_STILL_REFERENCED');
});
test('R204 CLI refuses missing or modified approval and protects route previous, keeper and untracked data',t=>{
 const f=fixture(t);
 gate(f,false,'OWNER_ACCEPTANCE_REQUIRED');
 f.writeTicket();
 gate(f,true,'EXACT_OWNER_ACCEPTED_RETIREMENT');
 assert.ok(fs.existsSync(f.target),'Gate is NEVER a deleting command');
 f.ticket.acceptedChecks.rollbackVerified=false;f.writeTicket();
 gate(f,false,'ACCEPTANCE_GATES_OPEN');
 f.ticket.acceptedChecks.rollbackVerified=true;f.writeTicket();
 fs.appendFileSync(f.routeFile,' ');
 gate(f,false,'ROUTE_HASH_STALE');
 f.writeRoute();gate(f,true,'EXACT_OWNER_ACCEPTED_RETIREMENT');
 f.route.previous={projectDir:f.target,commit:f.old,port:48830};
 f.writeRoute();f.ticket.routeHashes['default.json']=sha(fs.readFileSync(f.routeFile));f.writeTicket();
 gate(f,false,'TARGET_STILL_REFERENCED');
 f.route.previous=null;f.writeRoute();
 f.ticket.routeHashes['default.json']=sha(fs.readFileSync(f.routeFile));f.writeTicket();
 const retained=path.join(f.state,'retained-backends.json');
 fs.writeFileSync(retained,JSON.stringify({schema:1,items:[{projectDir:f.target}]}));
 gate(f,false,'TARGET_STILL_REFERENCED');
 fs.unlinkSync(retained);gate(f,true,'EXACT_OWNER_ACCEPTED_RETIREMENT');
 fs.writeFileSync(path.join(f.target,'unknown-user-file.txt'),'DO_NOT_DELETE\n');
 gate(f,false,'RELEASE_CONTAINS_UNKNOWN_LOCAL_CHANGES');
});
test('R204 rejects outside release root and symlinks',t=>{
 const f=fixture(t);f.writeTicket();
 const outside=path.join(f.tmp,'outside');fs.mkdirSync(outside);
 gate({...f,target:outside},false,'TARGET_OUTSIDE_OWNED_RELEASE_ROOT');
 if(process.platform!=='win32'){
  const link=path.join(f.releases,'v0.10.20-123456789abc');
  fs.symlinkSync(f.target,link);
  gate({...f,target:link},false,'SYMLINK_OR_NON_DIRECTORY');
 }
});
test('R204 Windows and Linux Updater destructive cleanup is after exact owner ticket validation',()=>{
 const win=fs.readFileSync(new URL('../auto-update-windows.ps1',import.meta.url),'utf8');
 const linux=fs.readFileSync(new URL('../auto-update-linux.sh',import.meta.url),'utf8');
 const w=win.slice(win.indexOf('function Cleanup-Releases {'),win.indexOf('if($SelfTest)'));
 const li=linux.indexOf('cleanup_releases(){');
 const end=linux.indexOf('\n}\n\n',li);
 assert.ok(li>0 && end>li,'R205 Linux cleanup function must have a bounded structural anchor');
 const l=linux.slice(li,end+2);
 assert.ok(w.indexOf('owner-acceptance-missing')>=0&&w.indexOf('owner-acceptance-missing')<w.indexOf('Remove-Item -LiteralPath $d.FullName'));
 assert.ok(l.indexOf('owner-acceptance-missing')>=0&&l.indexOf('owner-acceptance-missing')<l.indexOf('if rm -rf "$d"'));
 assert.ok(w.includes('tools\\release-retirement-gate.mjs')&&l.includes('tools/release-retirement-gate.mjs'));
 assert.ok(w.indexOf('OWNER_OR_REFERENCE_GATE')<w.indexOf('Remove-Item -LiteralPath $d.FullName'));
 assert.ok(l.indexOf('OWNER_OR_REFERENCE_GATE')<l.indexOf('if rm -rf "$d"'));
 assert.ok(win.includes('function Has-SupersededRelease {')&&linux.includes('has_superseded_release(){'));
});
