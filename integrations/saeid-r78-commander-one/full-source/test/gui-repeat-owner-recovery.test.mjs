import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createRepeatOwnerReviewedGuiStore,repeatOwnerReviewReady} from '../src/gui-repeat-owner-recovery.mjs';
import {createGuiController} from '../src/gui-tools-windows.mjs';
function fixtureTakeoverProvider(platform='win32'){
 const providerId='fixture-native-'+platform;
 const session={ownerPrincipal:'fixture-owner',sessionId:'fixture-session',seatId:'fixture-seat',displayId:'fixture-display',interactive:true,ownerAuthenticated:true};
 const grant=async({ttlSeconds=60}={})=>{
  const nowMs=Date.now();
  return {ok:true,takeoverEvidence:{provider:{providerId,platform,transport:'synthetic-test-provider',session,
   activityEvidenceSource:'physical',activityEvidenceIncludesSynthetic:false,isolationAuthority:null,
   capabilities:{observe:true,screenshot:true,activityDetection:true,physicalInputProtection:true,emergencyRelease:true,pointer:true,keyboard:true,semanticInvoke:true,isolatedDesktop:false}},
   expectedSession:session,activityEvidence:{source:'physical',reliable:true,excludesSyntheticInput:true,observedAtMs:nowMs,idleMs:60000},explicitOwnerApproval:false},
   inputProtectionReceipt:{active:true,kind:'NATIVE_PHYSICAL_INPUT_PROTECTION',providerId,sessionId:session.sessionId,
    leaseId:'fixture-protection-lease',releaseOnAgentExit:true,releaseOnEmergency:true,expiresAtMs:nowMs+ttlSeconds*1000}};
 };
 grant.release=async()=>({ok:true,released:true});
 return grant;
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=path.join(root,'.gui-repeat-tests');
const digest=b=>createHash('sha256').update(b).digest('hex');
const identity='a'.repeat(64);
test('preflight rejects legacy/current incident mismatch and every missing readiness gate',()=>{
 const plan={anchorFile:'anchor',anchorSha256:identity,preservePins:[],inheritedStopFiles:['old-stop']};
 const x={proposal:{incidentId:'current',sourceRoot:'root'},root:'root',activeRoot:'root',
  status:{configSha256:'pin',port:1,deviceName:'host'},configHash:'pin',port:1,host:'host',
  gui:{busy:false,leased:false,reason:'GUI_INCIDENT_REVIEW_REQUIRED',readOnlyAvailable:true,inputAvailable:false,incident:{id:'current'}},
  stopPresent:false,mode:{...plan,enabled:true,mode:'repeat-owner-review-v2'},plan};
 assert.equal(repeatOwnerReviewReady(x),true);
 for(const delta of [{proposal:null},{proposal:{...x.proposal,incidentId:'old'}},{activeRoot:'other'},
  {configHash:'other'},{port:2},{host:'other'},{stopPresent:true},{stopPresent:undefined},
  {gui:{...x.gui,busy:true}},{gui:{...x.gui,leased:true}},{gui:{...x.gui,reason:'LOCAL_GUI_STOP'}},
  {gui:{...x.gui,readOnlyAvailable:false}},{gui:{...x.gui,inputAvailable:true}},
  {mode:{...x.mode,inheritedStopFiles:[]}},{mode:{...x.mode,preservePins:['changed']}},
  {mode:{...x.mode,anchorSha256:'changed'}}])assert.equal(repeatOwnerReviewReady({...x,...delta}),false);
});
async function fixture(fn){
 await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'owned-'));
 const anchorFile=path.join(dir,'anchor.json'),folder=path.join(dir,'review');
 const anchor={schema:'rc-gui-pending-input-v1',status:'PENDING_NATIVE_EFFECT',tool:'gui_mouse_click',id:randomUUID(),startedUtc:'2026-10-31T05:33:29.265Z'};
 const bytes=JSON.stringify(anchor)+'\n';await fs.writeFile(anchorFile,bytes);
 let source=identity;
 const opts={anchorFile,anchorSha256:digest(bytes),root,folder,host:'test-host',user:'test-user',sourceIdentity:async()=>source,now:()=>Date.parse('2100-01-01T00:00:00Z')};
 const make=(extra={})=>createRepeatOwnerReviewedGuiStore({...opts,...extra});
 const approve=async(store,delta={})=>{
  const p=await store.reviewPlan();assert.ok(p);await fs.mkdir(path.dirname(p.receiptFile),{recursive:true});
  const r={...p,schema:'rc-gui-repeat-owner-review-v2',decision:'OWNER_REVIEWED_FRESH_INPUT_ONLY',historicalOutcome:'UNKNOWN_NO_REPLAY',
   noReplay:true,reviewMethod:'LOCAL_INTERACTIVE_BUTTON',deliberateGuiHelperRestart:true,epoch:randomUUID(),reviewedUtc:'2099-01-01T00:00:00Z',
   quiescence:{nativeMutexAcquired:true,guiBusy:false,guiLeased:false},...delta};
  delete r.receiptFile;delete r.startedUtc;
  await fs.writeFile(p.receiptFile,JSON.stringify(r),'utf8');return {p,r};
 };
 try{await fn({dir,anchorFile,anchor,bytes,folder,opts,make,approve,setSource:v=>{source=v;}});}
 finally{assert.equal(path.dirname(dir),scratch);await fs.rm(dir,{recursive:true,force:true});}
}
test('migration is bound to current incident, not the older legacy click',()=>fixture(async f=>{
 const s=f.make();const p=await s.reviewPlan();assert.equal(p.incidentId,f.anchor.id);
 await assert.rejects(s.begin('gui_key_press'),/GUI_INCIDENT_UNRESOLVED/);
 assert.equal((await f.make().pending()).id,f.anchor.id);
 assert.equal(await fs.readFile(f.anchorFile,'utf8'),f.bytes);
}));
test('two physical reviews preserve both unknown incidents and all old review bytes',()=>fixture(async f=>{
 const s=f.make();const first=await f.approve(s);assert.equal(await s.pending(),null);
 const h=await s.begin('gui_mouse_click');const next=await s.reviewPlan();
 const pendingBytes=await fs.readFile(next.incidentFile);const firstBytes=await fs.readFile(first.p.receiptFile);
 assert.equal((await f.make().pending()).id,h.id);
 await assert.rejects(f.make().begin('gui_type_text'),/GUI_INCIDENT_UNRESOLVED/);
 await f.approve(s);assert.equal(await s.pending(),null);
 assert.equal((await s.recoveryState()).ownerReviewDepth,2);
 await assert.rejects(s.resolve(h),/GUI_REPEAT_REVIEW_UNVERIFIED/);
 const fresh=await s.begin('gui_key_press');await s.resolve(fresh);assert.equal(await s.pending(),null);
 assert.deepEqual(await fs.readFile(next.incidentFile),pendingBytes);
 assert.deepEqual(await fs.readFile(first.p.receiptFile),firstBytes);
 assert.equal(await fs.readFile(f.anchorFile,'utf8'),f.bytes);
 assert.equal((await f.make().recoveryState()).ownerReviewDepth,2);
}));
for(const [field,value] of Object.entries({schema:'other',decision:'AUTO_RESET',historicalOutcome:'NOT_APPLIED',noReplay:false,
 reviewMethod:'REMOTE_SHELL',deliberateGuiHelperRestart:false,host:'other',user:'other',sourceRoot:'other',sourceSha256:'b'.repeat(64),
 incidentId:randomUUID(),incidentTool:'gui_key_press',incidentFile:'other',incidentSha256:'b'.repeat(64),
 parentEpoch:'other',parentReviewSha256:'b'.repeat(64),epoch:'../escape',reviewedUtc:'2020-01-01T00:00:00Z'})){
 test('reject unauthorized or mismatched receipt: '+field,()=>fixture(async f=>{
  const s=f.make();await f.approve(s,{[field]:value});await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
 }));
}
for(const field of ['nativeMutexAcquired','guiBusy','guiLeased'])test('reject non-quiescent receipt '+field,()=>fixture(async f=>{
 const s=f.make();await f.approve(s,{quiescence:{nativeMutexAcquired:true,guiBusy:false,guiLeased:false,[field]:field!=='nativeMutexAcquired'}});
 await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('receipt deletion after admission fails closed',()=>fixture(async f=>{
 const s=f.make();const {p}=await f.approve(s);await s.pending();await fs.unlink(p.receiptFile);
 await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('future-dated owner receipt cannot grant recovery',()=>fixture(async f=>{
 const s=f.make();await f.approve(s,{reviewedUtc:'2200-01-01T00:00:00Z'});
 await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('changed current anchor cannot inherit a review',()=>fixture(async f=>{
 const s=f.make();await f.approve(s);await s.pending();await fs.appendFile(f.anchorFile,' ');
 await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('receipt rotation after admission fails closed',()=>fixture(async f=>{
 const s=f.make();const {p,r}=await f.approve(s);await s.pending();r.epoch=randomUUID();await fs.writeFile(p.receiptFile,JSON.stringify(r));
 await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('source changes cannot inherit a review',()=>fixture(async f=>{
 const s=f.make();await f.approve(s);await s.pending();f.setSource('b'.repeat(64));await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
 assert.equal((await f.make().pending()).id,f.anchor.id);
}));
test('preserved history drift blocks recovery',()=>fixture(async f=>{
 const old=path.join(f.dir,'old.json');await fs.writeFile(old,'{}');const s=f.make({preservePins:[{path:old,sha256:digest('{}')}]});
 await f.approve(s);await s.pending();await fs.writeFile(old,'{ }');await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('hardlinked receipt and hardlinked anchor cannot grant input',()=>fixture(async f=>{
 const s=f.make();const {p}=await f.approve(s);await fs.link(p.receiptFile,path.join(f.dir,'receipt-link'));
 await assert.rejects(s.pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
 await fs.link(f.anchorFile,path.join(f.dir,'anchor-link'));await assert.rejects(f.make().pending(),/GUI_REPEAT_REVIEW_UNVERIFIED/);
}));
test('competing controllers admit at most one fresh operation',()=>fixture(async f=>{
 await f.approve(f.make());const outcomes=await Promise.allSettled([f.make().begin('gui_mouse_click'),f.make().begin('gui_key_press')]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
}));
test('cloned or historical handles cannot clear a fresh incident',()=>fixture(async f=>{
 const s=f.make();await f.approve(s);const h=await s.begin('gui_key_press');
 await assert.rejects(s.resolve({...h}),/GUI_REPEAT_REVIEW_UNVERIFIED/);await s.resolve(h);
}));
const config={config:{powerMode:{enabled:true,guiControl:{enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true}}}};
const image=()=>({ok:true,data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'),mimeType:'image/png',width:800,height:600,
 snapshot:{screenIndex:0,bounds:{left:0,top:0,width:800,height:600},foreground:'fixture',processId:123}});
test('even a forged quiescence receipt cannot restart a currently leased controller',()=>fixture(async f=>{
 const s=f.make();let closes=0,time=1000;
 const c=createGuiController({takeoverProvider:fixtureTakeoverProvider('win32'),platform:'win32',incidentStore:s,isStopped:async()=>false,now:()=>time,
 closeInvoke:()=>{closes++;},invoke:async r=>{assert.equal(r.action,'status');return {ok:true,available:true};}});
 await c.execute(config,'gui_status',{});
 const lease=await c.execute(config,'gui_session_begin',{mode:'observe'});
 await f.approve(s);
 const blocked=await c.execute(config,'gui_status',{});
 assert.equal(blocked.reason,'GUI_INCIDENT_STORAGE_UNAVAILABLE');assert.equal(closes,0);
 time+=61000;
 assert.equal((await c.execute(config,'gui_status',{})).available,true);
 await assert.rejects(c.execute(config,'gui_mouse_click',{lease:lease.lease,frame:'old',x:1,y:1}),/GUI_LEASE_REQUIRED_OR_EXPIRED/);
}));
test('physical review restarts GUI helper once; uncertain input is never replayed',()=>fixture(async f=>{
 const s=f.make();let closes=0,inputs=0,stop=false,counter=0;
 const c=createGuiController({takeoverProvider:fixtureTakeoverProvider('win32'),platform:'win32',incidentStore:s,isStopped:async()=>stop,closeInvoke:()=>{closes++;},token:()=>String(++counter).padStart(48,'0'),
 invoke:async r=>{if(r.action==='status')return {ok:true,available:true};if(r.action==='screenshot')return image();inputs++;throw Object.assign(Error('GUI_MOVE_FAILED'),{guiCode:'GUI_MOVE_FAILED'});}});
 const run=(n,a={})=>c.execute(config,n,a);
 await run('gui_status');await f.approve(s);assert.equal((await run('gui_status')).available,true);assert.equal(closes,1);assert.equal(inputs,0);
 let lease=await run('gui_session_begin',{mode:'takeover',explicitUserAuthorization:'Fixture only'});
 const shot=await run('gui_screenshot',{lease:lease.lease});
 await assert.rejects(run('gui_mouse_click',{lease:lease.lease,frame:shot.__structuredContent.frame,x:1,y:1}),/GUI_MOVE_FAILED/);
 assert.equal(inputs,1);assert.equal((await run('gui_status')).inputAvailable,false);
 await f.approve(s);stop=true;assert.equal((await run('gui_status')).reason,'LOCAL_GUI_STOP');
 stop=false;assert.equal((await run('gui_status')).available,true);
 assert.equal(inputs,1);assert.equal(closes,3);
 await assert.rejects(run('gui_mouse_click',{lease:lease.lease,frame:shot.__structuredContent.frame,x:1,y:1}),/GUI_LEASE_REQUIRED_OR_EXPIRED/);
 assert.equal(inputs,1);await run('gui_status');assert.equal(closes,3);
 lease=await run('gui_session_begin',{mode:'observe'});assert.equal(lease.mode,'observe');await run('gui_session_end',{lease:lease.lease});
}));
