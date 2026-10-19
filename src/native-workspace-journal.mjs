// PRIVATE QA: immutable per-workspace native GUI input intent/ack receipts.
// Not imported by deployed Core. No native GUI, shell, network or repair API.
// A fresh process NEVER trusts a prior same-OS-user ACK as input authorization.
// The trusted OS-local broker / cross-process owner identity is still MISSING.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TOOLS=new Set(['click','move','drag','type','key','scroll']);
const LIMIT=128;
const hash=s=>createHash('sha256').update(s).digest('hex');
const failure=code=>Object.assign(new Error(code),{code});
const ownDir=async dir=>{
  let st;
  try{st=await fs.lstat(dir);}catch{throw failure('NATIVE_JOURNAL_DIRECTORY_UNAVAILABLE');}
  if(!st.isDirectory()||st.isSymbolicLink()||
      (process.getuid&&st.uid!==process.getuid())||
      (process.platform!=='win32'&&(st.mode&0o077)!==0))
    throw failure('NATIVE_JOURNAL_DIRECTORY_UNTRUSTED');
  // Avoid following path aliases and the mutation of unintended roots.
  if(await fs.realpath(dir)!==path.resolve(dir))
    throw failure('NATIVE_JOURNAL_DIRECTORY_UNTRUSTED');
};
const readReceipt=async p=>{
  let fd;
  try{
    const pre=await fs.lstat(p);
    if(!pre.isFile()||pre.isSymbolicLink()||pre.nlink!==1||
        (process.getuid&&pre.uid!==process.getuid())||
        (process.platform!=='win32'&&(pre.mode&0o077)!==0)||
        pre.size<10||pre.size>2048)
      throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
    fd=await fs.open(p,'r');
    const st=await fd.stat();
    if(st.ino!==pre.ino||st.dev!==pre.dev||st.size!==pre.size||
       st.nlink!==1)
      throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
    const raw=await fd.readFile();
    if(raw.length!==pre.size)throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
    return {raw,sha256:hash(raw)};
  }catch{
    throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
  }finally{await fd?.close();}
};
async function syncDir(dir){
  // Linux-only pilot requires a directory sync for durable namespace changes.
  // Windows directory-open/sync varies; unsupported is a fail-closed result.
  let fd;
  try{
    fd=await fs.open(dir,'r');
    await fd.sync();
  }catch{throw failure('NATIVE_JOURNAL_DURABILITY_UNAVAILABLE');}
  finally{await fd?.close();}
}
async function exclusiveReceipt(file,bytes){
  let fd;
  try{
    fd=await fs.open(file,'wx',0o600);
    await fd.writeFile(bytes);
    await fd.sync();
  }catch{throw failure('NATIVE_JOURNAL_WRITE_UNCERTAIN');}
  finally{await fd?.close();}
}

export function createNativeWorkspaceJournal({root,now=Date.now}={}){
  if(typeof root!=='string'||!path.isAbsolute(root))
    throw failure('NATIVE_JOURNAL_ROOT_INVALID');
  // This object must be constructed by a trusted adapter with an owner-private
  // PRE-EXISTING directory. No automatic root creation or permission change.
  const canonical=path.resolve(root);
  const sessions=new Map();
  const issued=new WeakSet();
  async function verifyRoot(){await ownDir(canonical);}
  const folder=workspaceRef=>path.join(canonical,'workspace-'+workspaceRef);
  async function assertPhysical(session){
    await verifyRoot();
    await ownDir(session.dir);
    const entries=await fs.readdir(session.dir,{withFileTypes:true});
    if(entries.length!==session.expected.size)
      throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
    for(const file of entries){
      if(!file.isFile()||!session.expected.has(file.name))
        throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
      const ev=await readReceipt(path.join(session.dir,file.name));
      if(ev.sha256!==session.expected.get(file.name))
        throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
    }
  }
  async function sessionOf(workspaceRef){
    if(typeof workspaceRef!=='string'||!HEX.test(workspaceRef))
      throw failure('NATIVE_JOURNAL_WORKSPACE_REF_INVALID');
    let state=sessions.get(workspaceRef);
    if(state){
      await assertPhysical(state);
      return state;
    }
    await verifyRoot();
    const dir=folder(workspaceRef);
    try{await fs.mkdir(dir,{mode:0o700});}
    catch(e){
      if(e?.code==='EEXIST')throw failure('NATIVE_JOURNAL_RECOVERY_REQUIRED');
      throw failure('NATIVE_JOURNAL_DIRECTORY_UNAVAILABLE');
    }
    // On a failed fsync, leave the new directory quarantined; never remove it.
    await syncDir(canonical);
    await ownDir(dir);
    state={dir,expected:new Map(),pending:null,locked:false,done:new Set(),count:0};
    sessions.set(workspaceRef,state);
    return state;
  }
  async function prepare({workspaceRef,operationId,kind,revision}={}){
    if(typeof operationId!=='string'||!ID.test(operationId)||
       !TOOLS.has(kind)||!Number.isSafeInteger(revision)||revision<0)
      throw failure('NATIVE_JOURNAL_INTENT_INVALID');
    const state=await sessionOf(workspaceRef);
    if(state.locked||state.pending)throw failure('NATIVE_JOURNAL_BUSY_OR_PENDING');
    const operationRef=hash(operationId);
    if(state.done.has(operationRef))throw failure('NATIVE_JOURNAL_DUPLICATE_OPERATION');
    if(state.count>=LIMIT)throw failure('NATIVE_JOURNAL_EVENT_LIMIT');
    state.locked=true;
    try{
      await assertPhysical(state);
      const name=operationRef+'.intent.json';
      const intent={schema:1,phase:'PENDING_NATIVE_EFFECT',workspaceRef,
        operationRef,kind,revision,startedAt:new Date(now()).toISOString()};
      const bytes=Buffer.from(JSON.stringify(intent)+'\n','utf8');
      await exclusiveReceipt(path.join(state.dir,name),bytes);
      await syncDir(state.dir);
      const actual=await readReceipt(path.join(state.dir,name));
      if(actual.sha256!==hash(bytes))throw failure('NATIVE_JOURNAL_WRITE_UNCERTAIN');
      state.expected.set(name,actual.sha256);
      const handle=Object.freeze({workspaceRef,operationRef,kind,revision});
      issued.add(handle);
      state.pending=handle;
      state.count++;
      return handle;
    }finally{state.locked=false;}
  }
  async function acknowledge(handle){
    if(!handle||!issued.has(handle))throw failure('NATIVE_JOURNAL_HANDLE_INVALID');
    const state=sessions.get(handle.workspaceRef);
    if(!state||state.pending!==handle||state.locked)
      throw failure('NATIVE_JOURNAL_HANDLE_INVALID');
    state.locked=true;
    try{
      await assertPhysical(state);
      const intent=handle.operationRef+'.intent.json';
      const before=await readReceipt(path.join(state.dir,intent));
      const receipt={schema:1,phase:'NATIVE_SUBMITTED_UNVERIFIED',
        workspaceRef:handle.workspaceRef,operationRef:handle.operationRef,
        intentSha256:before.sha256,acknowledgedAt:new Date(now()).toISOString()};
      const bytes=Buffer.from(JSON.stringify(receipt)+'\n','utf8');
      const name=handle.operationRef+'.ack.json';
      await exclusiveReceipt(path.join(state.dir,name),bytes);
      await syncDir(state.dir);
      const ack=await readReceipt(path.join(state.dir,name));
      if(ack.sha256!==hash(bytes))throw failure('NATIVE_JOURNAL_WRITE_UNCERTAIN');
      state.expected.set(name,ack.sha256);
      state.done.add(handle.operationRef);
      issued.delete(handle);
      state.pending=null;
      return {submitted:true,nativeEffectConfirmed:false,
        operationRef:handle.operationRef,requiresReobservation:true};
    }finally{state.locked=false;}
  }
  async function inspect(workspaceRef){
    if(typeof workspaceRef!=='string'||!HEX.test(workspaceRef))
      throw failure('NATIVE_JOURNAL_WORKSPACE_REF_INVALID');
    await verifyRoot();
    const dir=folder(workspaceRef);
    let st;
    try{st=await fs.lstat(dir);}
    catch(e){
      if(e?.code==='ENOENT')return {workspaceRef,recordPresent:false,
        recovered:false,releaseAuthorized:false};
      throw failure('NATIVE_JOURNAL_DIRECTORY_UNAVAILABLE');
    }
    if(!st.isDirectory()||st.isSymbolicLink())
      throw failure('NATIVE_JOURNAL_EVIDENCE_CORRUPT');
    // A fresh journal instance can inspect but NEVER re-authorize input
    // based on user-writable receipts, even when they look complete.
    const entries=await fs.readdir(dir);
    return {workspaceRef,recordPresent:true,eventFiles:Math.min(entries.length,2*LIMIT),
      recovered:false,releaseAuthorized:false,nativeOutcome:'UNKNOWN',
      disposition:'RECOVERY_REQUIRED_NO_REPLAY'};
  }
  return {prepare,acknowledge,inspect};
}
