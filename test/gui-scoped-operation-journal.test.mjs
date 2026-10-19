import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createGuiScopedOperationJournal} from '../src/gui-scoped-operation-journal.mjs';
import {createGuiController} from '../src/gui-tools-windows.mjs';
import {createGuiInputIncidentStore} from '../src/gui-incident-store.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const own=async fn=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'rc-gui-scoped-intents-'));
  try{return await fn(base);}
  finally{await fs.rm(base,{recursive:true,force:true});}
};
const inputCfg={config:{powerMode:{enabled:true,guiControl:{
  enabled:true,allowScreenshot:true,allowMouse:true,allowKeyboard:true,allowWindowFocus:true,
  maxScreenshotWidth:1600,maxScreenshotBytes:2097152
}}}};
const frame=()=>({
  ok:true,data:Buffer.from('89504e470d0a1a0a00000000','hex').toString('base64'),
  mimeType:'image/png',width:800,height:600,
  snapshot:{screenIndex:0,bounds:{left:0,top:0,width:800,height:600},
    foreground:'disposable-native-test',processId:482}
});
function c(legacy,scoped, {failFirst=false,stop=false}={}){
  let seq=0,mutations=0;
  const controller=createGuiController({
    platform:'win32',isStopped:async()=>stop,incidentStore:legacy,
    scopedOperations:scoped,token:()=>('z'+(++seq)).padEnd(48,'z'),
    closeInvoke:()=>{},now:()=>1000,
    invoke:async request=>{
      if(request.action==='status')return {ok:true,available:true};
      if(request.action==='screenshot')return frame();
      mutations++;
      if(failFirst&&mutations===1)throw Error('GUI_NATIVE_OUTCOME_UNKNOWN_TEST');
      return {ok:true};
    }
  });
  return {
    run:(tool,args={})=>controller.execute(inputCfg,tool,args),
    get mutations(){return mutations}
  };
}
async function takeover(control){
  const session=await control.run('gui_session_begin',{
    mode:'takeover',explicitUserAuthorization:'Current approved disposable native GUI QA'
  });
  const picture=await control.run('gui_screenshot',{lease:session.lease});
  return {lease:session.lease,frame:picture.__structuredContent.frame};
}

test('valid legacy incident is never deleted, yet an unrelated fresh action can proceed',
  ()=>own(async base=>{
    const legacy=createGuiInputIncidentStore({file:path.join(base,'old-incident.json')});
    await legacy.begin('gui_focus_window');
    const original=await fs.readFile(path.join(base,'old-incident.json'));
    const scoped=createGuiScopedOperationJournal({root:path.join(base,'actions')});
    const controller=c(legacy,scoped);
    const st=await controller.run('gui_status');
    assert.equal(st.available,true);
    assert.equal(st.inputAvailable,true);
    assert.equal(st.incidentPending,true);
    assert.equal(st.scopedNativeIntents,true);
    assert.equal(st.scopedUnresolvedCount,0);
    const lease=await takeover(controller);
    assert.equal((await controller.run('gui_key_press',{...lease,keys:['A']})).submitted,true);
    assert.deepEqual(await fs.readFile(path.join(base,'old-incident.json')),original);
    assert.equal((await scoped.inspect()).unresolvedCount,0);
    assert.equal(controller.mutations,1);
  }));

test('uncertain previous action is never blindly repeated or turned into a global device lock',
  ()=>own(async base=>{
    const old=createGuiInputIncidentStore({file:path.join(base,'old-incident.json')});
    await old.begin('gui_mouse_click');
    const original=await fs.readFile(path.join(base,'old-incident.json'));
    const scope=createGuiScopedOperationJournal({root:path.join(base,'actions')});
    const controller=c(old,scope,{failFirst:true});
    const before=await takeover(controller);
    await assert.rejects(controller.run('gui_key_press',{...before,keys:['Return']}),
      /GUI_NATIVE_OUTCOME_UNKNOWN_TEST/);
    const degraded=await controller.run('gui_status');
    assert.equal(degraded.available,true);
    assert.equal(degraded.inputAvailable,true);
    assert.equal(degraded.historicalNativeOutcomeUncertain,true);
    assert.equal(degraded.scopedUnresolvedCount,1);
    assert.equal((await scope.inspect()).unresolvedCount,1);
    // Old lease/frame cannot be reused. New screenshot/action is distinct.
    await assert.rejects(controller.run('gui_key_press',{...before,keys:['Return']}),
      /GUI_LEASE_REQUIRED_OR_EXPIRED/);
    const fresh=await takeover(controller);
    assert.notEqual(fresh.lease,before.lease);
    assert.equal((await controller.run('gui_key_press',{...fresh,keys:['Tab']})).submitted,true);
    assert.equal((await scope.inspect()).unresolvedCount,1);
    assert.equal(controller.mutations,2);
    assert.deepEqual(await fs.readFile(path.join(base,'old-incident.json')),original);
  }));

test('two concurrent profiles may write independent intents, without a global pending lock',
  ()=>own(async base=>{
    const root=path.join(base,'actions');
    const s1=createGuiScopedOperationJournal({root});
    const s2=createGuiScopedOperationJournal({root});
    const [a,b]=await Promise.all([s1.begin('gui_mouse_click'),s2.begin('gui_focus_window')]);
    assert.notEqual(a.id,b.id);
    assert.equal((await s1.inspect()).unresolvedCount,2);
    await s1.resolve(a);
    assert.equal((await s2.inspect()).unresolvedCount,1);
    await s2.resolve(b);
    assert.equal((await s1.inspect()).unresolvedCount,0);
  }));

test('journal retains unknown intent if an action was not acknowledged',
  ()=>own(async base=>{
    const root=path.join(base,'actions');
    const first=createGuiScopedOperationJournal({root});
    const intent=await first.begin('gui_type_text');
    const evidence=path.join(root,'intent-'+intent.id+'.json');
    const contents=await fs.readFile(evidence,'utf8');
    assert.equal(JSON.parse(contents).status,'PENDING_NATIVE_EFFECT');
    assert.equal(contents.includes('user-text'),false);
    const second=createGuiScopedOperationJournal({root});
    const fresh=await second.begin('gui_mouse_move');
    await second.resolve(fresh);
    assert.equal((await second.inspect()).unresolvedCount,1);
    assert.equal(sha(await fs.readFile(evidence)),sha(contents));
  }));

test('scoped journal rejects tampered or symlink receipts but does not modify old evidence',
  ()=>own(async base=>{
    const root=path.join(base,'actions');
    const s=createGuiScopedOperationJournal({root});
    const handle=await s.begin('gui_mouse_click');
    const receipt=path.join(root,'intent-'+handle.id+'.json');
    const original=await fs.readFile(receipt);
    await fs.writeFile(receipt,'{"tampered":true}');
    await assert.rejects(s.resolve(handle),/GUI_SCOPED_EVIDENCE_UNCERTAIN/);
    assert.notDeepEqual(await fs.readFile(receipt),original);
    const fresh=await s.begin('gui_key_press');
    assert.equal(fresh.tool,'gui_key_press');
    await s.resolve(fresh);
    assert.equal((await s.inspect()).unresolvedCount,1);
  }));

test('emergency STOP remains authoritative and never creates a new native input action',
  ()=>own(async base=>{
    const legacy=createGuiInputIncidentStore({file:path.join(base,'old-incident.json')});
    const scoped=createGuiScopedOperationJournal({root:path.join(base,'actions')});
    const controller=c(legacy,scoped,{stop:true});
    const status=await controller.run('gui_status');
    assert.equal(status.available,false);
    await assert.rejects(controller.run('gui_session_begin',{
      mode:'takeover',explicitUserAuthorization:'Current signed disposable test approval'
    }),/GUI_LOCAL_STOP/);
    assert.equal((await scoped.inspect()).unresolvedCount,0);
    assert.equal(controller.mutations,0);
  }));
