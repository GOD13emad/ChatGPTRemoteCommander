import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBrowserController} from '../src/browser-tools.mjs';
import {BROWSER_RULES,validateBrowserInput} from '../src/browser-contract.mjs';

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc-managed-tabs-controller-'));
 const actions=[];
 let failNext=null;
 const invoke=async req=>{
  actions.push(req);
  if(req.action==='start')return {ok:true,browserProduct:'Chromium QA'};
  if(req.action==='chat_tab_open'){
   if(failNext==='chat_tab_open'){failNext=null;throw Error('BROWSER_CDP_TIMEOUT')}
   return {ok:true,tabRef:'a'.repeat(32),owned:true,isolatedContext:req.isolatedContext===true};
  }
  if(req.action==='chat_tab_close'){
   if(failNext==='chat_tab_close'){failNext=null;throw Error('BROWSER_CDP_TIMEOUT')}
   return {ok:true,closed:true};
  }
  if(req.action==='chat_tab_snapshot')return {ok:true,tabRef:req.tabRef,title:'Synthetic private chat',text:'Synthetic safe content',elements:[],passwordValuesReturned:false,cookiesReturned:false};
  if(req.action==='chat_tabs')return {ok:true,source:'COMMANDER_OWNED_BROWSER_CORE',
    managedTabs:[{tabRef:'a'.repeat(32)}],ready:true};
  if(req.action==='snapshot')return {ok:true,title:'Private browser',text:'',elements:[]};
  if(req.action==='end'){if(failNext==='end'){failNext=null;throw Error('BROWSER_HELPER_TIMEOUT')}if(failNext==='end_unconfirmed'){failNext=null;return {ok:true,closed:false};}return {ok:true,closed:true};}
  throw Error('UNEXPECTED_'+req.action);
 };
 const ctx={config:{instance:{profile:'managed_qa'},powerMode:{enabled:true,browserControl:{
   enabled:true,profileRoot:root,allowNavigate:true,allowInput:false,allowScreenshot:false
 }}}};
 const ctl=createBrowserController({invoke,token:()=> 'b'.repeat(48)});
 return {ctl,ctx,actions,fail(action='chat_tab_open'){failNext=action},done(){ctl.close();fs.rmSync(root,{recursive:true,force:true})}};
}
test('managed tab control is private, lease-gated and requires navigation permission',async()=>{
 const f=fixture();
 try{
  assert.equal(BROWSER_RULES.get('browser_chat_tab_close').annotations.destructiveHint,true);
  assert.equal(BROWSER_RULES.get('browser_chat_tabs').annotations.readOnlyHint,true);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease:'bad',url:'https://chatgpt.com/'}),/BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
  const begun=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  const lease=begun.lease;
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com.evil.example/c/11111111-1111-4111-8111-111111111111'}),/BROWSER_CHAT_URL_NOT_ALLOWED/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111?secret=x'}),/BROWSER_CHAT_URL_NOT_ALLOWED/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_close',{lease,tabRef:'../../wrong'}),/BROWSER_INVALID_ARGUMENTS/);
  f.ctx.config.powerMode.browserControl.allowNavigate=false;
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_NAVIGATION_DISABLED/);
  f.ctx.config.powerMode.browserControl.allowNavigate=true;
  const opened=await f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'});
  assert.equal(opened.tabRef,'a'.repeat(32));
  assert.equal(opened.userDesktopTouched,false);
  assert.equal(opened.isolatedContext,false);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/',isolatedContext:'yes'}),/BROWSER_INVALID_ARGUMENTS/);
  const isolated=await f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/',isolatedContext:true});
  assert.equal(isolated.isolatedContext,true);
  assert.equal(f.actions.at(-1).isolatedContext,true);
  const list=await f.ctl.execute(f.ctx,'browser_chat_tabs',{lease});
  assert.equal(list.managedTabs.length,1);
  const closed=await f.ctl.execute(f.ctx,'browser_chat_tab_close',{lease,tabRef:opened.tabRef});
  assert.equal(closed.closed,true);
  assert.deepEqual(f.actions.filter(x=>x.action.startsWith('chat_')).map(x=>x.action),
    ['chat_tab_open','chat_tab_open','chat_tabs','chat_tab_close']);
  await f.ctl.execute(f.ctx,'browser_session_end',{lease});
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
 }finally{f.done()}
});
test('ambiguous managed-tab open requires session reset, not an unrelated DOM snapshot',async()=>{
 const f=fixture();
 try{
  const begun=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}),lease=begun.lease;
  f.fail();
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CDP_TIMEOUT/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  await f.ctl.execute(f.ctx,'browser_snapshot',{lease});
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  const observed=await f.ctl.execute(f.ctx,'browser_chat_tabs',{lease});
  assert.equal(observed.sessionResetRequired,true);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  assert.equal(f.actions.filter(x=>x.action==='chat_tab_open').length,1);
  await f.ctl.execute(f.ctx,'browser_session_end',{lease});
  const fresh=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  const opened=await f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease:fresh.lease,url:'https://chatgpt.com/'});
  assert.equal(opened.owned,true);
  await f.ctl.execute(f.ctx,'browser_session_end',{lease:fresh.lease});
 }finally{f.done()}
});

test('ambiguous managed-tab close remains blocked after read-only reconciliation',async()=>{
 const f=fixture();
 try{
  const {lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  const opened=await f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'});
  f.fail('chat_tab_close');
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_close',{lease,tabRef:opened.tabRef}),/BROWSER_CDP_TIMEOUT/);
  const snap=await f.ctl.execute(f.ctx,'browser_snapshot',{lease});
  assert.equal(snap.sessionResetRequired,true);
  const state=await f.ctl.execute(f.ctx,'browser_status',{});
  assert.equal(state.uncertain,true);
  assert.equal(state.sessionResetRequired,true);
  const observed=await f.ctl.execute(f.ctx,'browser_chat_tabs',{lease});
  assert.equal(observed.sessionResetRequired,true);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_close',{lease,tabRef:opened.tabRef}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  assert.equal(f.actions.filter(x=>x.action==='chat_tab_close').length,1);
  await f.ctl.execute(f.ctx,'browser_session_end',{lease});
 }finally{f.done()}
});

test('uncertain session end preserves owned lease for bounded cleanup retry',async()=>{
 const f=fixture();
 try{
  const {lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  f.fail('end');
  await assert.rejects(f.ctl.execute(f.ctx,'browser_session_end',{lease}),/BROWSER_HELPER_TIMEOUT/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}),/BROWSER_LEASE_BUSY/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  const list=await f.ctl.execute(f.ctx,'browser_chat_tabs',{lease});
  assert.equal(list.sessionResetRequired,true);
  const closed=await f.ctl.execute(f.ctx,'browser_session_end',{lease});
  assert.equal(closed.closed,true);
  assert.equal(f.actions.filter(a=>a.action==='end').length,2);
  const next=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  assert.ok(next.lease);
  await f.ctl.execute(f.ctx,'browser_session_end',{lease:next.lease});
 }finally{f.done()}
});

test('unconfirmed helper end also retains owned lease until a confirmed cleanup',async()=>{
 const f=fixture();
 try{
  const {lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  f.fail('end_unconfirmed');
  await assert.rejects(f.ctl.execute(f.ctx,'browser_session_end',{lease}),/BROWSER_SESSION_END_UNCONFIRMED/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'}),/BROWSER_LEASE_BUSY/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_close',{lease,tabRef:'a'.repeat(32)}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  assert.equal((await f.ctl.execute(f.ctx,'browser_session_end',{lease})).closed,true);
 }finally{f.done()}
});

test('per-tab read-only snapshot is lease-scoped, bounded and does not clear uncertain mutations',async()=>{
 const f=fixture();
 try{
  assert.equal(BROWSER_RULES.get('browser_chat_tab_snapshot').annotations.readOnlyHint,true);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_snapshot',{lease:'wrong',tabRef:'a'.repeat(32)}),/BROWSER_LEASE_REQUIRED_OR_EXPIRED/);
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_snapshot',{lease:'x',tabRef:'../../escape'}),/BROWSER_INVALID_ARGUMENTS/);
  const {lease}=await f.ctl.execute(f.ctx,'browser_session_begin',{mode:'isolated'});
  const owned=await f.ctl.execute(f.ctx,'browser_chat_tab_snapshot',{lease,tabRef:'a'.repeat(32),maxTextChars:1200,maxElements:10});
  assert.equal(owned.tabRef,'a'.repeat(32));
  assert.equal(owned.text,'Synthetic safe content');
  assert.equal(owned.userDesktopTouched,false);
  assert.equal(f.actions.at(-1).action,'chat_tab_snapshot');
  assert.equal(f.actions.at(-1).maxTextChars,1200);
  assert.equal(f.actions.at(-1).maxElements,10);
  f.fail('chat_tab_open');
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CDP_TIMEOUT/);
  const snap=await f.ctl.execute(f.ctx,'browser_chat_tab_snapshot',{lease,tabRef:'a'.repeat(32)});
  assert.equal(snap.sessionResetRequired,true,'read-only snapshot cannot reconcile uncertain tab mutation');
  await assert.rejects(f.ctl.execute(f.ctx,'browser_chat_tab_open',{lease,url:'https://chatgpt.com/'}),/BROWSER_CHAT_OUTCOME_UNCERTAIN_SESSION_RESET_REQUIRED/);
  await f.ctl.execute(f.ctx,'browser_session_end',{lease});
 }finally{f.done()}
});
