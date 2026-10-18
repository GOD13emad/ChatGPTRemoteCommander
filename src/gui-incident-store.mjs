// Private fail-closed evidence of a GUI input that may have reached the native desktop.
// No typed text, coordinates, window titles, screenshot or chat contents are stored.
// An unresolved record has NO automatic expiry or reset-on-restart path.
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {constants} from 'node:fs';
import fs from 'node:fs/promises';

const SCHEMA='rc-gui-pending-input-v1';
const INPUT_TOOLS=new Set([
  'gui_mouse_move','gui_mouse_delta','gui_mouse_scroll','gui_mouse_click',
  'gui_mouse_drag','gui_type_text','gui_key_press','gui_focus_window'
]);
const fail=(code)=>Object.assign(new Error(code),{guiCode:code});
const defaultFile=()=>{
  const base=process.platform==='win32'
    ?(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'))
    :(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'));
  return path.join(base,'chatgpt-remote-commander','gui-pending-native-input-v1.json');
};
export function createGuiInputIncidentStore({file=defaultFile(),now=()=>new Date().toISOString(),id=()=>randomUUID()}={}){
  if(!path.isAbsolute(file))throw fail('GUI_INCIDENT_PATH_INVALID');
  const folder=path.dirname(file);
  // Unexported per-instance authority: a prior persisted file, guessed ID or
  // freshly instantiated store can NEVER substitute for this begin() handle.
  const issuedHandles=new WeakSet();
  // Reserve the crash-reconciliation namespace. A missing original file is
  // NOT proof of recovery if any transaction artifact exists. These paths
  // cannot grant authorization and are not created by normal GUI dispatch.
  const reviewArtifacts=[
    file+'.review-prepared-v1.json',
    file+'.review-archive-v1.json',
    file+'.review-terminal-v1.json'
  ];
  async function requireNoUnreconciledReview(){
    for(const candidate of reviewArtifacts){
      try{await fs.lstat(candidate);}
      catch(e){
        if(e?.code==='ENOENT')continue;
        throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
      }
      throw fail('GUI_INCIDENT_RECOVERY_REQUIRED');
    }
  }
  async function pending(){
    // Reuse the exact, canonical, race-checked reader; a looser reader
    // could mistakenly permit native input during an interrupted review.
    const record=await inspect();
    return record?{id:record.id,tool:record.tool,startedUtc:record.startedUtc}:null;
  }
  async function begin(tool){
    if(!INPUT_TOOLS.has(tool))throw fail('GUI_INCIDENT_TOOL_INVALID');
    const prior=await pending();
    if(prior)throw fail('GUI_INCIDENT_UNRESOLVED');
    try{
      await fs.mkdir(folder,{recursive:true,mode:0o700});
      const dir=await fs.lstat(folder);
      if(!dir.isDirectory()||dir.isSymbolicLink())throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
      const record={schema:SCHEMA,status:'PENDING_NATIVE_EFFECT',tool,id:id(),startedUtc:now()};
      await requireNoUnreconciledReview();
      const fd=await fs.open(file,'wx',0o600); // Exclusive across processes; never truncate an unresolved incident.
      try{
        await fd.writeFile(JSON.stringify(record)+'\n','utf8');
        await fd.sync();
      }finally{await fd.close();}
      const handle={id:record.id,tool:record.tool};
      issuedHandles.add(handle);
      return handle;
    }catch(e){
      if(e.guiCode)throw e;
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE'); // Fail before native input.
    }
  }
  async function resolve(handle){
    if(!handle||typeof handle.id!=='string'||!issuedHandles.has(handle))
      throw fail('GUI_INCIDENT_HANDLE_INVALID');
    const prior=await pending();
    if(!prior||prior.id!==handle.id||prior.tool!==handle.tool)throw fail('GUI_INCIDENT_RESOLUTION_MISMATCH');
    try{await requireNoUnreconciledReview();await fs.unlink(file);issuedHandles.delete(handle);}
    catch{throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');}
  }

  // Stable, privacy-minimal READ-ONLY fingerprint for incident diagnosis.
  // This is not a capability token and never authorizes input or archival.
  async function inspect(){
    await requireNoUnreconciledReview();
    let before;
    try{before=await fs.lstat(file,{bigint:true});}
    catch(error){
      if(error?.code==='ENOENT'){
        await requireNoUnreconciledReview();
        return null;
      }
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    }
    const safe=st=>st.isFile()&&!st.isSymbolicLink()&&st.nlink===1n&&
      st.size>=1n&&st.size<=2048n;
    const equal=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&
      a.nlink===b.nlink&&a.size===b.size&&
      a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
    if(!safe(before))throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    let handle;
    try{
      handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      const opened=await handle.stat({bigint:true});
      if(!safe(opened)||!equal(before,opened))throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
      const raw=await handle.readFile();
      const finished=await handle.stat({bigint:true});
      const named=await fs.lstat(file,{bigint:true});
      if(!safe(finished)||!safe(named)||!equal(before,finished)||!equal(before,named)||
         raw.length!==Number(before.size))throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
      const rawText=raw.toString('utf8');
      const record=JSON.parse(rawText);
      // The native store writes a canonical one-record JSON line. This rejects
      // ambiguous duplicate keys, noncanonical bytes and trailing payloads.
      if(rawText!==JSON.stringify(record)+'\n')throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
      const keys=['id','schema','startedUtc','status','tool'];
      if(!record||Array.isArray(record)||typeof record!=='object'||
        Object.keys(record).sort().join(',')!==keys.join(',')||
        record.schema!==SCHEMA||record.status!=='PENDING_NATIVE_EFFECT'||
        !INPUT_TOOLS.has(record.tool)||typeof record.id!=='string'||
        !/^[a-zA-Z0-9-]{8,128}$/.test(record.id)||
        typeof record.startedUtc!=='string'||record.startedUtc.length>48)
        throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
      await requireNoUnreconciledReview();
      return {
        id:record.id,tool:record.tool,startedUtc:record.startedUtc,
        status:'PENDING_NATIVE_EFFECT',nativeOutcome:'UNKNOWN',
        evidenceSha256:createHash('sha256').update(raw).digest('hex'),
        evidenceBytes:raw.length
      };
    }catch{
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    }finally{
      if(handle)await handle.close().catch(()=>{});
    }
  }

  // No public administrative release API exists. Owner review must be
  // implemented by a separately trusted, product-owned native coordinator.
  // A mutable same-user JSON receipt is not proof of owner authorization.
  return {pending,begin,resolve,inspect};
}
