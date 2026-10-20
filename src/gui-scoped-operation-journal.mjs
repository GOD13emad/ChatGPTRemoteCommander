// Scoped native GUI evidence: a failed native action cannot lock the entire
// Windows/Linux device or unrelated Commander profiles. The old J01 incident
// is preserved untouched for forensics; current action gets its OWN receipt.
// This is not an OS trust boundary or permission to reuse an unknown effect.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const TOOLS=new Set([
  'gui_mouse_move','gui_mouse_delta','gui_mouse_scroll','gui_mouse_click',
  'gui_mouse_drag','gui_type_text','gui_key_press','gui_focus_window'
]);
const fail=code=>Object.assign(new Error(code),{guiCode:code});
const rootDefault=()=>{
  const base=process.platform==='win32'
    ?(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'))
    :(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'));
  return path.join(base,'chatgpt-remote-commander','gui-scoped-native-intents-v1');
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGuiScopedOperationJournal({root=rootDefault(),
    nextId=()=>randomUUID(),now=()=>new Date().toISOString()}={}){
  if(!path.isAbsolute(root))throw fail('GUI_SCOPED_ROOT_INVALID');
  const issued=new WeakSet();
  const live=new Set();
  async function folder(){
    try {await fs.mkdir(root,{recursive:true,mode:0o700});}
    catch {throw fail('GUI_SCOPED_STORAGE_UNAVAILABLE');}
    let stat;
    try {stat=await fs.lstat(root);}
    catch {throw fail('GUI_SCOPED_STORAGE_UNAVAILABLE');}
    if(!stat.isDirectory()||stat.isSymbolicLink() ||
      (process.getuid && stat.uid!==process.getuid()) ||
      (process.platform!=='win32' && (stat.mode & 0o077)!==0))
      throw fail('GUI_SCOPED_STORAGE_UNTRUSTED');
    return root;
  }
  async function syncFolder(){
    if(process.platform==='win32')return; // On Windows file fsync only; separately qualify NTFS.
    let d;
    try {d=await fs.open(root,'r'); await d.sync();}
    catch {throw fail('GUI_SCOPED_STORAGE_UNAVAILABLE');}
    finally {await d?.close();}
  }
  async function begin(tool){
    if(!TOOLS.has(tool))throw fail('GUI_SCOPED_TOOL_INVALID');
    await folder();
    const opId=nextId();
    if(typeof opId!=='string'||!uuid.test(opId))
      throw fail('GUI_SCOPED_OPERATION_ID_INVALID');
    const file=path.join(root,'intent-'+opId+'.json');
    const record={schema:'rc-gui-scoped-input-v1',status:'PENDING_NATIVE_EFFECT',
      id:opId,tool,startedUtc:now()};
    const serialized=JSON.stringify(record)+'\n';
    let fd;
    try {
      fd=await fs.open(file,'wx',0o600);
      await fd.writeFile(serialized,'utf8');
      await fd.sync();
      await fd.close();
      fd=null;
      await syncFolder();
    }catch {
      await fd?.close();
      // Do not unlink a partially written intent: uncertain file operations
      // stay available for later inspection instead of being auto-discarded.
      throw fail('GUI_SCOPED_STORAGE_UNAVAILABLE');
    }
    const handle=Object.freeze({id:opId,tool});
    issued.add(handle);
    live.add(opId);
    return handle;
  }
  async function resolve(handle){
    if(!handle||!issued.has(handle)||!live.has(handle.id))
      throw fail('GUI_SCOPED_HANDLE_INVALID');
    await folder();
    const file=path.join(root,'intent-'+handle.id+'.json');
    let st,record;
    try{
      st=await fs.lstat(file);
      if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
         st.size<1||st.size>1024)throw Error('bad intent');
      record=JSON.parse(await fs.readFile(file,'utf8'));
    }catch{throw fail('GUI_SCOPED_EVIDENCE_UNCERTAIN');}
    if(record?.schema!=='rc-gui-scoped-input-v1'||
       record.id!==handle.id||record.tool!==handle.tool||
       record.status!=='PENDING_NATIVE_EFFECT')
      throw fail('GUI_SCOPED_EVIDENCE_UNCERTAIN');
    try{await fs.unlink(file);await syncFolder();}
    catch{throw fail('GUI_SCOPED_STORAGE_UNAVAILABLE');}
    live.delete(handle.id);
    issued.delete(handle);
    return {resolved:true};
  }
  async function inspect(){
    await folder();
    // Read-only aggregate: old UNKNOWN actions never authorize or block new
    // actions. This is NOT a provenance/owner review.
    let count=0;
    try{
      for(const name of await fs.readdir(root)){
        if(/^intent-[0-9a-f-]{36}\.json$/i.test(name))count++;
      }
    }catch{throw fail('GUI_SCOPED_STORAGE_UNAVAILABLE');}
    return {schema:'rc-gui-scoped-input-v1',unresolvedCount:count,
      inputBlockedByOtherActions:false};
  }
  return Object.freeze({begin,resolve,inspect});
}
