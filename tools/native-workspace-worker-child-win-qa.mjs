// QA ONLY. IPC mock worker with no Windows GUI API or keyboard/mouse access.
// Child-process identity is NOT equivalent to a protected Windows desktop,
// token, RDP session, or a platform-authenticated ChatGPT conversation.
import {createHash} from 'node:crypto';

const REF=/^[a-f0-9]{64}$/;
const OP=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS=new Set(['click','move','drag','type','key','scroll']);
const workspaceRef=process.env.RC_QA_WORKSPACE_REF;
if(!REF.test(workspaceRef??'')||typeof process.send!=='function')
  process.exit(64);
let observed=0,effects=0;
const operations=new Set();

function send(reply){
  if(process.connected)process.send(reply);
}
process.on('message',msg=>{
  if(!msg||typeof msg!=='object'||msg.type!=='request')return;
  const {id,action,workspaceRef:requested,operationId,kind}=msg;
  if(!OP.test(id??''))return;
  const base={type:'reply',id,workspaceRef};
  if(requested!==workspaceRef){
    send({...base,ok:false,code:'WORKER_WORKSPACE_MISMATCH'});return;
  }
  if(action==='observe'){
    observed++;
    const sha256=createHash('sha256').update('rc-qa-frame-v1:'+workspaceRef+':'+observed).digest('hex');
    send({...base,ok:true,value:{sha256,pid:process.pid,observationNumber:observed}});return;
  }
  if(action==='simulateCrash'){
    // Explicitly test child death before ACK: never used for actual input.
    process.exit(43);
  }
  if(action!=='effect'||!OP.test(operationId??'')||!KINDS.has(kind)){
    send({...base,ok:false,code:'WORKER_ACTION_INVALID'});return;
  }
  if(operations.has(operationId)){
    send({...base,ok:false,code:'WORKER_OPERATION_REPLAY'});return;
  }
  operations.add(operationId);
  effects++;
  send({...base,ok:true,value:{
    simulated:true,workspaceRef,operationId,kind,
    pid:process.pid,effectNumber:effects
  }});
});
process.on('disconnect',()=>process.exit(0));
send({type:'ready',workspaceRef,pid:process.pid});
