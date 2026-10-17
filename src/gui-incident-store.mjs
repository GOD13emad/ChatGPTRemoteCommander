// Private fail-closed evidence of a GUI input that may have reached the native desktop.
// No typed text, coordinates, window titles, screenshot or chat contents are stored.
// An unresolved record has NO automatic expiry or reset-on-restart path.
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
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
  async function pending(){
    let st;
    try{st=await fs.lstat(file);}
    catch(e){if(e.code==='ENOENT')return null;throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');}
    if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>2048)
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    let raw,record;
    try{raw=await fs.readFile(file,'utf8');record=JSON.parse(raw);}
    catch{throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');}
    if(record?.schema!==SCHEMA||record.status!=='PENDING_NATIVE_EFFECT'||
      !INPUT_TOOLS.has(record.tool)||typeof record.id!=='string'||
      !/^[a-zA-Z0-9-]{8,128}$/.test(record.id)||
      typeof record.startedUtc!=='string'||record.startedUtc.length>48)
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    return {id:record.id,tool:record.tool,startedUtc:record.startedUtc};
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
    try{await fs.unlink(file);issuedHandles.delete(handle);}
    catch{throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');}
  }

  // No public administrative release API exists. Owner review must be
  // implemented by a separately trusted, product-owned native coordinator.
  // A mutable same-user JSON receipt is not proof of owner authorization.
  return {pending,begin,resolve};
}
