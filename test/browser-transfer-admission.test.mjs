import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserController} from '../src/browser-tools.mjs';
import {browserToolDefinitions,validateBrowserInput} from '../src/browser-contract.mjs';
const origin='https://example.test';
const baseCtx={config:{instance:{profile:'owner'},powerMode:{enabled:true,browserControl:{enabled:true,allowNavigate:true,allowInput:true,allowScreenshot:true}}}};
const upload=lease=>({lease,selector:'#up',filename:'sample.txt',expectedSha256:'a'.repeat(64),grantRef:'attested'});
const download=lease=>({lease,selector:'#download',filename:'asset.txt',grantRef:'attested',maxBytes:100});
function fixture({trustedTransferContext,config=baseCtx,transferError=null}={}){
 const calls=[];
 const invoke=async req=>{calls.push(req);
  if(req.action==='start')return {browserProduct:'Candidate'};
  if(req.action==='snapshot')return {ok:true,url:origin,title:'Fixture'};
  if(req.action==='transfer_upload'||req.action==='transfer_download'){
   if(transferError)throw new Error(transferError);
   return {ok:true,filename:req.filename,background:true};
  }
  if(req.action==='end')return {ok:true,closed:true};
  return {ok:true};
 };
 const ctl=createBrowserController({invoke,closeInvoke:()=>{},...(trustedTransferContext?{trustedTransferContext}:{})});
 return {ctl,ctx:config,calls};
}
test('transfer tools are declared with immutable required inputs and no path argument',()=>{
 for(const name of ['browser_upload_file','browser_download_file']){
  const def=browserToolDefinitions.find(x=>x.name===name);
  assert.ok(def,name);
  assert.equal(def.inputSchema.additionalProperties,false);
  assert.ok(def.inputSchema.required.includes('grantRef'));
  assert.ok(!Object.hasOwn(def.inputSchema.properties,'path'));
  assert.ok(!Object.hasOwn(def.inputSchema.properties,'absolutePath'));
 }
 assert.throws(()=>validateBrowserInput('browser_upload_file',{lease:'l',selector:'#x',filename:'f.txt',expectedSha256:'x'.repeat(64),grantRef:'r'}),/BROWSER_INVALID_ARGUMENTS/);
});
test('default controller never performs native transfer without trust injection',async()=>{
 const f=fixture();let lease;
 try{
  ({lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}));
  await assert.rejects(f.ctl.execute(f.ctx,'browser_upload_file',upload(lease)),/BROWSER_TRANSFER_AUTH_CONTEXT_REQUIRED/);
  assert.equal(f.calls.filter(x=>x.action==='transfer_upload').length,0);
 }finally{f.ctl.close()}
});
test('identity scope and forged grant are rejected before native transfer',async()=>{
 const f=fixture({trustedTransferContext:async()=>({principal:'uid:1000',profile:'owner',verifyGrant:async()=>false})});let lease;
 try{
  ({lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}));
  await assert.rejects(f.ctl.execute(f.ctx,'browser_upload_file',upload(lease)),/BROWSER_TRANSFER_GRANT_REQUIRED/);
  assert.equal(f.calls.filter(x=>x.action==='transfer_upload').length,0);
 }finally{f.ctl.close()}
});
test('wrong profile is denied even if verifier reports approved',async()=>{
 const f=fixture({trustedTransferContext:async()=>({principal:'uid:1000',profile:'different',verifyGrant:async()=>true})});let lease;
 try{
  ({lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}));
  await assert.rejects(f.ctl.execute(f.ctx,'browser_download_file',download(lease)),/BROWSER_TRANSFER_AUTH_CONTEXT_REQUIRED/);
  assert.equal(f.calls.filter(x=>x.action==='transfer_download').length,0);
 }finally{f.ctl.close()}
});
test('trusted verifier is bound to operation origin filename principal and profile',async()=>{
 const grants=[];
 const f=fixture({trustedTransferContext:async()=>({principal:'uid:1000',profile:'owner',verifyGrant:async v=>{grants.push(v);return v.operation==='upload'&&v.origin===origin&&v.filename==='sample.txt'&&v.principal==='uid:1000'&&v.profile==='owner'&&v.grant==='attested'}})});let lease;
 try{
  ({lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}));
  const result=await f.ctl.execute(f.ctx,'browser_upload_file',upload(lease));
  assert.equal(result.ok,true);assert.equal(grants.length,1);
  const sent=f.calls.find(x=>x.action==='transfer_upload');
  assert.deepEqual(Object.keys(sent).sort(),['action','filename','origin','selector','sha256']);
  assert.equal(sent.origin,origin);
 }finally{f.ctl.close()}
});
test('failed native transfer is not blindly retried until snapshot',async()=>{
 const f=fixture({trustedTransferContext:async()=>({principal:'uid:1000',profile:'owner',verifyGrant:async()=>true}),transferError:'BROWSER_UPLOAD_NATIVE_FAILED'});let lease;
 try{
  ({lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}));
  await assert.rejects(f.ctl.execute(f.ctx,'browser_upload_file',upload(lease)),/BROWSER_UPLOAD_NATIVE_FAILED/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_upload_file',upload(lease)),/BROWSER_OUTCOME_UNCERTAIN_SNAPSHOT_REQUIRED/);
  const snap=await f.ctl.execute(f.ctx,'browser_snapshot',{lease});
  assert.equal(snap.cookiesReturned,false);assert.equal(snap.savedPasswordStoreAccess,false);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_upload_file',upload(lease)),/BROWSER_UPLOAD_NATIVE_FAILED/);
  assert.equal(f.calls.filter(x=>x.action==='transfer_upload').length,2);
 }finally{f.ctl.close()}
});
test('STANDARD browser policy rejects transfer before native effect',async()=>{
 const f=fixture({config:{config:{instance:{profile:'owner'},powerMode:{enabled:false,browserControl:{enabled:false}}}}});
 await assert.rejects(f.ctl.execute(f.ctx,'browser_upload_file',upload('fakelease')),/BROWSER_DISABLED/);
 assert.equal(f.calls.length,0);f.ctl.close();
});
