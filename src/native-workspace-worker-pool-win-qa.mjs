// QA ONLY: dedicated Node subprocess per opaque workspace, simulated GUI only.
// Process boundary protects against accidental cross-routing and child death;
// it is NOT a protected Windows desktop or OS privilege/security isolation.
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const REF=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS=new Set(['click','move','drag','type','key','scroll']);
const fail=code=>Object.assign(new Error(code),{code});
const childFile=fileURLToPath(new URL('../tools/native-workspace-worker-child-win-qa.mjs',import.meta.url));

export function createWindowsMockWorkerPoolQA({requestTimeoutMs=2500,readyTimeoutMs=3500}={}){
  if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1||
     !Number.isSafeInteger(readyTimeoutMs)||readyTimeoutMs<1)
    throw fail('WORKER_POLICY_INVALID');
  const workers=new Map();
  let closed=false;
  function validateWorkspace(workspaceRef){
    if(!REF.test(workspaceRef??''))throw fail('WORKER_WORKSPACE_INVALID');
    if(closed)throw fail('WORKER_POOL_CLOSED');
  }
  function markDead(s,code){
    if(s.dead)return;
    s.dead=true;
    if(s.readyReject){
      s.readyReject(fail(code));
      s.readyReject=null;s.readyResolve=null;
    }
    for(const p of s.pending.values()){
      clearTimeout(p.timer);
      p.reject(fail(code));
    }
    s.pending.clear();
  }
  function launch(workspaceRef){
    validateWorkspace(workspaceRef);
    if(workers.has(workspaceRef))throw fail('WORKER_ALREADY_ALLOCATED');
    // Deliberately do not inherit user secrets, arbitrary NODE_OPTIONS or
    // debug flags. Windows requires SystemRoot for some child operations.
    const child=fork(childFile,[],{
      windowsHide:true,execArgv:[],
      stdio:['ignore','ignore','ignore','ipc'],
      env:{SystemRoot:process.env.SystemRoot||'C:\\Windows',
        RC_QA_WORKSPACE_REF:workspaceRef}
    });
    const s={workspaceRef,child,ready:false,dead:false,pending:new Map(),
      readyResolve:null,readyReject:null};
    workers.set(workspaceRef,s);
    const ready=new Promise((resolve,reject)=>{
      s.readyResolve=resolve;s.readyReject=reject;
    });
    const timer=setTimeout(()=>{
      if(s.readyReject){
        markDead(s,'WORKER_READY_TIMEOUT');
        child.kill();
      }
    },readyTimeoutMs);
    child.on('message',msg=>{
      if(s.dead)return;
      if(!msg||typeof msg!=='object'||msg.workspaceRef!==workspaceRef){
        markDead(s,'WORKER_PROTOCOL_MISMATCH');child.kill();return;
      }
      if(msg.type==='ready'){
        if(s.ready||!Number.isSafeInteger(msg.pid)||msg.pid<=0){
          markDead(s,'WORKER_PROTOCOL_MISMATCH');child.kill();return;
        }
        s.ready=true;
        clearTimeout(timer);
        s.readyResolve?.(Object.freeze({workspaceRef,pid:child.pid}));
        s.readyResolve=null;s.readyReject=null;
        return;
      }
      if(msg.type!=='reply'||!s.ready||!ID.test(msg.id??'')){
        markDead(s,'WORKER_PROTOCOL_MISMATCH');child.kill();return;
      }
      const p=s.pending.get(msg.id);
      if(!p){
        markDead(s,'WORKER_PROTOCOL_MISMATCH');child.kill();return;
      }
      s.pending.delete(msg.id);
      clearTimeout(p.timer);
      if(msg.ok===true)p.resolve(msg.value);
      else if(msg.ok===false&&typeof msg.code==='string'&&
        /^WORKER_[A-Z_]+$/.test(msg.code))p.reject(fail(msg.code));
      else{
        p.reject(fail('WORKER_PROTOCOL_MISMATCH'));
        markDead(s,'WORKER_PROTOCOL_MISMATCH');child.kill();
      }
    });
    child.on('error',()=>{clearTimeout(timer);markDead(s,'WORKER_PROCESS_FAILED');});
    child.on('exit',()=>{clearTimeout(timer);markDead(s,'WORKER_EXITED');});
    return ready;
  }
  function request(workspaceRef,action,{operationId='',kind=''}={}){
    validateWorkspace(workspaceRef);
    const s=workers.get(workspaceRef);
    if(!s||!s.ready||s.dead||!s.child.connected)
      throw fail('WORKER_NOT_RUNNING');
    if(!['observe','effect','simulateCrash'].includes(action))
      throw fail('WORKER_ACTION_INVALID');
    if(action==='effect'&&(!ID.test(operationId)||!KINDS.has(kind)))
      throw fail('WORKER_ACTION_INVALID');
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        if(!s.pending.has(id))return;
        // Unknown reply/outcome: kill this child's IPC session and fail
        // closed; do not retry the native effect.
        markDead(s,'WORKER_RESPONSE_TIMEOUT');
        s.child.kill();
      },requestTimeoutMs);
      s.pending.set(id,{resolve,reject,timer});
      s.child.send({type:'request',id,action,workspaceRef,operationId,kind},err=>{
        if(err&&s.pending.has(id)){
          markDead(s,'WORKER_SEND_FAILED');
          s.child.kill();
        }
      });
    });
  }
  return Object.freeze({
    launch,
    observe({workspaceRef}={}){return request(workspaceRef,'observe');},
    effect({workspaceRef,operationId,kind}={}){return request(workspaceRef,'effect',{operationId,kind});},
    simulateCrashQA(workspaceRef){return request(workspaceRef,'simulateCrash');},
    status(workspaceRef){
      validateWorkspace(workspaceRef);
      const s=workers.get(workspaceRef);
      return Object.freeze({allocated:!!s,running:!!s&&s.ready&&!s.dead&&s.child.connected,
        pid:s?.child.pid??null,pending:s?.pending.size??0});
    },
    async close(){
      if(closed)return;
      closed=true;
      await Promise.all([...workers.values()].map(s=>new Promise(resolve=>{
        if(s.dead||s.child.exitCode!==null){markDead(s,'WORKER_POOL_CLOSED');resolve();return;}
        const timeout=setTimeout(()=>resolve(),2000);
        s.child.once('exit',()=>{clearTimeout(timeout);resolve();});
        markDead(s,'WORKER_POOL_CLOSED');
        s.child.kill();
      })));
      workers.clear();
    }
  });
}
