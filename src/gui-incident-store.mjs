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
function validClipboardDiagnostic(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) ||
      Object.getPrototypeOf(d) !== Object.prototype ||
      Object.keys(d).sort().join(',') !==
        'ownerConfirmed,reason,schema,selectionRequests,successfulTransfers,unsupportedRequests,waitMs' ||
      d.schema !== 'rc-clipboard-transfer-observation-v1' ||
      !['NO_REQUEST','UNSUPPORTED_REQUEST','UNCONFIRMED_TRANSFER'].includes(d.reason) ||
      typeof d.ownerConfirmed !== 'boolean' ||
      !['selectionRequests','successfulTransfers','unsupportedRequests'].every(k=>
        Number.isSafeInteger(d[k]) && d[k]>=0 && d[k]<=99) ||
      d.unsupportedRequests > d.selectionRequests ||
      d.successfulTransfers > d.selectionRequests ||
      !Number.isSafeInteger(d.waitMs) || d.waitMs<0 || d.waitMs>1000)
    throw fail('GUI_INCIDENT_DIAGNOSTIC_INVALID');
  return {schema:d.schema,reason:d.reason,ownerConfirmed:d.ownerConfirmed,
    selectionRequests:d.selectionRequests,unsupportedRequests:d.unsupportedRequests,
    successfulTransfers:d.successfulTransfers,waitMs:d.waitMs};
}
const defaultFile=()=>{
  const base=process.platform==='win32'
    ?(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'))
    :(process.env.XDG_STATE_HOME||path.join(os.homedir(),'.local','state'));
  return path.join(base,'chatgpt-remote-commander','gui-pending-native-input-v1.json');
};
export function createGuiInputIncidentStore({file=defaultFile(),now=()=>new Date().toISOString(),id=()=>randomUUID()}={}){
  if(!path.isAbsolute(file))throw fail('GUI_INCIDENT_PATH_INVALID');
  const folder=path.dirname(file);
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
      typeof record.startedUtc!=='string'||record.startedUtc.length>48||
      !Object.keys(record).every(k=>
        ['schema','status','tool','id','startedUtc','clipboardDiagnostic'].includes(k)))
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    if (Object.hasOwn(record,'clipboardDiagnostic')) {
      try { validClipboardDiagnostic(record.clipboardDiagnostic); }
      catch { throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE'); }
      if(record.tool!=='gui_type_text')throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    }
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
      return {id:record.id,tool:record.tool};
    }catch(e){
      if(e.guiCode)throw e;
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE'); // Fail before native input.
    }
  }
  async function annotateFailure(handle, diagnostic) {
    const note=validClipboardDiagnostic(diagnostic); // closed, content-free schema
    const current=await pending();
    if(!handle || current?.id!==handle.id || current?.tool!=='gui_type_text' ||
       handle.tool!=='gui_type_text')throw fail('GUI_INCIDENT_RESOLUTION_MISMATCH');
    let existing;
    try { existing=JSON.parse(await fs.readFile(file,'utf8')); }
    catch { throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE'); }
    if(existing?.id!==current.id || existing?.tool!==current.tool)
      throw fail('GUI_INCIDENT_RESOLUTION_MISMATCH');
    if(Object.hasOwn(existing,'clipboardDiagnostic')) {
      if(JSON.stringify(existing.clipboardDiagnostic)===JSON.stringify(note))return;
      throw fail('GUI_INCIDENT_DIAGNOSTIC_CONFLICT');
    }
    const next={...existing,clipboardDiagnostic:note};
    const dir=await fs.lstat(folder);
    if(!dir.isDirectory() || dir.isSymbolicLink() ||
       (typeof process.getuid==='function' &&
         (dir.uid!==process.getuid() || (dir.mode&0o022))))
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    const temp=path.join(folder,'.gui-input-diagnostic-'+randomUUID()+'.tmp');
    try {
      const fd=await fs.open(temp,'wx',0o600);
      try { await fd.writeFile(JSON.stringify(next)+'\n','utf8'); await fd.sync(); }
      finally { await fd.close(); }
      const still=await pending();
      if(still?.id!==handle.id || still?.tool!==handle.tool)
        throw fail('GUI_INCIDENT_RESOLUTION_MISMATCH');
      await fs.rename(temp,file);
      if(process.platform!=='win32') {
        const fd=await fs.open(folder,'r');
        try { await fd.sync(); } finally { await fd.close(); }
      }
    } catch(error) {
      if(error?.guiCode)throw error;
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');
    } finally { await fs.unlink(temp).catch(()=>{}); }
  }
  async function resolve(handle){
    if(!handle||typeof handle.id!=='string')throw fail('GUI_INCIDENT_HANDLE_INVALID');
    const prior=await pending();
    if(!prior||prior.id!==handle.id||prior.tool!==handle.tool)throw fail('GUI_INCIDENT_RESOLUTION_MISMATCH');
    try{await fs.unlink(file);}catch{throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');}
  }
  return {pending,begin,resolve,annotateFailure};
}
