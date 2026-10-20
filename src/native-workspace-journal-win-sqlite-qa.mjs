// QA ONLY: synchronous Windows SQLite intent/ACK helper process.
// Not integrated with Core; no chat authentication, GUI input or SID isolation.
// Each short-lived Node worker releases SQLite handles upon process exit,
// including StatementSync objects retained by the Node 22 SQLite binding.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const REF=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS=new Set(['click','move','drag','type','key','scroll']);
const fail=code=>Object.assign(new Error(code),{code});
const helper=fileURLToPath(new URL('../tools/native-workspace-journal-win-sqlite-helper-qa.mjs',import.meta.url));

function canonicalRoot(root){
  if(process.platform!=='win32')throw fail('WIN_JOURNAL_PLATFORM_UNSUPPORTED');
  if(typeof root!=='string'||!path.isAbsolute(root))throw fail('WIN_JOURNAL_ROOT_INVALID');
  const resolved=path.resolve(root);
  const st=fs.lstatSync(resolved);
  if(!st.isDirectory()||st.isSymbolicLink())throw fail('WIN_JOURNAL_ROOT_UNTRUSTED');
  // Reject Windows DOS 8.3 aliases; caller supplies the private canonical root.
  const real=fs.realpathSync.native(resolved).replace(/^\\\\\?\\/,'');
  if(path.normalize(real).toLowerCase()!==path.normalize(resolved).toLowerCase())
    throw fail('WIN_JOURNAL_ROOT_UNTRUSTED');
  return resolved;
}

export function createWindowsNativeJournalQA({root}={}){
  const dir=canonicalRoot(root);
  const inFlight=new Set();
  let closed=false;
  function call(method,workspace,operation,kind){
    if(closed)throw fail('WIN_JOURNAL_CLOSED');
    const result=spawnSync(process.execPath,[helper,method,dir,workspace,operation,kind],{
      windowsHide:true,encoding:'utf8',timeout:6000,maxBuffer:16384
    });
    if(result.error||result.signal)throw fail('WIN_JOURNAL_BACKEND_UNAVAILABLE');
    let response;
    try{response=JSON.parse(result.stdout.trim());}
    catch{throw fail('WIN_JOURNAL_BACKEND_UNAVAILABLE');}
    if(response?.ok!==true){
      const code=response?.code;
      if(typeof code==='string'&&/^WIN_JOURNAL_[A-Z_]+$/.test(code))throw fail(code);
      throw fail('WIN_JOURNAL_BACKEND_UNAVAILABLE');
    }
    if(result.status!==0)throw fail('WIN_JOURNAL_BACKEND_UNAVAILABLE');
    return response.result;
  }
  return Object.freeze({
    // QA provisioning only. A production broker must restrict this to an
    // authenticated OS owner; normal dispatch cannot initialize history.
    provision(){return call('provision','','','');},
    async execute({workspaceRef,operationId,kind},nativeEffect){
      if(!REF.test(workspaceRef??''))throw fail('WIN_JOURNAL_WORKSPACE_INVALID');
      if(!ID.test(operationId??''))throw fail('WIN_JOURNAL_OPERATION_INVALID');
      if(!KINDS.has(kind))throw fail('WIN_JOURNAL_ACTION_INVALID');
      if(typeof nativeEffect!=='function')throw fail('WIN_JOURNAL_EFFECT_INVALID');
      if(inFlight.has(workspaceRef))throw fail('WIN_JOURNAL_BUSY');
      inFlight.add(workspaceRef);
      try{
        call('prepare',workspaceRef,operationId,kind);
        // PREPARED has been committed and the SQLite helper process exited
        // before this callback can cause any native side effect.
        const value=await nativeEffect();
        // If this acknowledgement fails, NEVER replay the effect automatically.
        call('ack',workspaceRef,operationId,kind);
        return value;
      }finally{inFlight.delete(workspaceRef);}
    },
    inspect(operationId){
      if(!ID.test(operationId??''))throw fail('WIN_JOURNAL_OPERATION_INVALID');
      return call('inspect','',operationId,'');
    },
    close(){
      if(inFlight.size)throw fail('WIN_JOURNAL_BUSY');
      closed=true;
    }
  });
}
