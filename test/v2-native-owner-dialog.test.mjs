import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmLowRiskV2OwnerDialog} from '../src/v2-native-owner-dialog.mjs';
const id='12345678-1234-4234-8234-123456789abc';
const req={requestId:id,tool:'system_status',arguments:{}};
test('KDE native owner dialog requires deliberate exact confirmation, not just pressing Enter',async()=>{
 let calls=0,observed=null;
 const fake=(exe,args,opts,callback)=>{
  calls++;observed={exe,args,opts};
  callback(null,'APPROVE 12345678\n','');
 };
 assert.equal(await confirmLowRiskV2OwnerDialog(req,{dialog:fake}),true);
 assert.equal(calls,1);
 assert.equal(observed.exe,'/usr/bin/kdialog');
 assert.equal(observed.args.at(-1),'');
 assert.equal(observed.args.at(-2).includes('system_status'),true);
 assert.equal(observed.args.includes('--inputbox'),true);
 assert.equal(observed.args.includes('--warningyesno'),false);
 assert.equal(observed.opts.timeout,30000);
});
test('rejects no approval, error, timeout and malformed callback',async()=>{
 for(const [err,value] of [[null,''],[null,'APPROVE 11111111'],[new Error('time'),'APPROVE 12345678']]){
  const d=(a,b,c,cb)=>cb(err,value,'');
  assert.equal(await confirmLowRiskV2OwnerDialog(req,{dialog:d}),false);
 }
 await assert.rejects(()=>confirmLowRiskV2OwnerDialog(req,{dialog:null}),{code:'V2_GUI_OWNER_CALLBACK_INVALID'});
});
test('never exposes unrestricted, mutating or argument-bearing tools to GUI single-step approval',async()=>{
 let called=false;
 const fake=(a,b,c,cb)=>{called=true;cb(null,'APPROVE 12345678')};
 for(const tool of ['run_shell','write_file','browser_navigate','gui_session_begin','workflow_run_start']){
  await assert.rejects(()=>confirmLowRiskV2OwnerDialog({...req,tool},{dialog:fake}),{code:'V2_GUI_OWNER_LOW_RISK_ONLY'});
 }
 await assert.rejects(()=>confirmLowRiskV2OwnerDialog({...req,arguments:{path:'/etc/passwd'}},{dialog:fake}),{code:'V2_GUI_OWNER_LOW_RISK_ONLY'});
 await assert.rejects(()=>confirmLowRiskV2OwnerDialog({...req,requestId:'not-valid'},{dialog:fake}),{code:'V2_GUI_OWNER_LOW_RISK_ONLY'});
 assert.equal(called,false);
});
