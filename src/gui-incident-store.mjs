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
      return {id:record.id,tool:record.tool};
    }catch(e){
      if(e.guiCode)throw e;
      throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE'); // Fail before native input.
    }
  }
  async function resolve(handle){
    if(!handle||typeof handle.id!=='string')throw fail('GUI_INCIDENT_HANDLE_INVALID');
    const prior=await pending();
    if(!prior||prior.id!==handle.id||prior.tool!==handle.tool)throw fail('GUI_INCIDENT_RESOLUTION_MISMATCH');
    try{await fs.unlink(file);}catch{throw fail('GUI_INCIDENT_STORAGE_UNAVAILABLE');}
  }

  // Only owner-reviewed incidents can recover in-memory uncertainty. The review
  // is durable and private, and deliberately does not replay any input.
  const reviewFolder=path.join(folder,'gui-reviewed-native-input-v1');
  const reviewIdPattern=/^[a-zA-Z0-9-]{8,128}$/;
  const dispositions=new Set(['observed-applied','observed-not-applied','unconfirmed-no-replay']);
  const reviewPath=incidentId=>path.join(reviewFolder,incidentId+'.review.json');
  const archivePath=incidentId=>path.join(reviewFolder,incidentId+'.pending.json');
  async function checkedFile(filePath) {
    let st;
    try { st=await fs.lstat(filePath); }
    catch (error) { if (error.code==='ENOENT') return null; throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE'); }
    if (!st.isFile() || st.isSymbolicLink() || st.nlink!==1 || st.size<1 || st.size>2048)
      throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE');
    try { return JSON.parse(await fs.readFile(filePath,'utf8')); }
    catch { throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE'); }
  }
  async function checkedReviewFolder(create=false) {
    if (create) await fs.mkdir(reviewFolder,{recursive:false,mode:0o700});
    const st=await fs.lstat(reviewFolder);
    if (!st.isDirectory() || st.isSymbolicLink()) throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE');
  }
  async function reviewed(incidentId) {
    if (typeof incidentId!=='string' || !reviewIdPattern.test(incidentId))
      throw fail('GUI_INCIDENT_REVIEW_ID_INVALID');
    try { await checkedReviewFolder(); }
    catch(error) { if(error.code==='ENOENT') return false; throw error; }
    const receipt=await checkedFile(reviewPath(incidentId));
    const archived=await checkedFile(archivePath(incidentId));
    if (!receipt || !archived) return false;
    if (receipt.schema!=='rc-gui-owner-review-v1' || receipt.status!=='REVIEWED_WITHOUT_REPLAY' ||
      receipt.incidentId!==incidentId || !dispositions.has(receipt.ownerDisposition) ||
      archived.schema!==SCHEMA || archived.status!=='PENDING_NATIVE_EFFECT' ||
      archived.id!==incidentId || archived.tool!==receipt.tool ||
      archived.startedUtc!==receipt.startedUtc) throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE');
    return true;
  }
  async function review({id:incidentId,tool,startedUtc,disposition,confirmation}={}) {
    const prior=await pending();
    if (!prior || incidentId!==prior.id || tool!==prior.tool || startedUtc!==prior.startedUtc)
      throw fail('GUI_INCIDENT_REVIEW_MISMATCH');
    if (!dispositions.has(disposition) || confirmation!=='REVIEW '+prior.id)
      throw fail('GUI_INCIDENT_OWNER_CONFIRMATION_REQUIRED');
    // Time alone is never sufficient to release a latch: this only rejects a
    // still-recent native request even if an owner accidentally starts review.
    const age=Date.now()-Date.parse(prior.startedUtc);
    if (!Number.isFinite(age) || age<60000) throw fail('GUI_INCIDENT_REVIEW_TOO_RECENT');
    try {
      const base=await fs.lstat(folder);
      if (!base.isDirectory() || base.isSymbolicLink()) throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE');
      try { await checkedReviewFolder(); }
      catch(error) { if(error.code==='ENOENT') await checkedReviewFolder(true); else throw error; }
      const receiptPath=reviewPath(prior.id),archivedPath=archivePath(prior.id);
      const receipt={schema:'rc-gui-owner-review-v1',status:'REVIEWED_WITHOUT_REPLAY',
        incidentId:prior.id,tool:prior.tool,startedUtc:prior.startedUtc,
        ownerDisposition:disposition,reviewedUtc:now()};
      const existing=await checkedFile(receiptPath);
      if (existing) {
        if (existing.schema!==receipt.schema || existing.status!==receipt.status ||
            existing.incidentId!==receipt.incidentId || existing.tool!==receipt.tool ||
            existing.startedUtc!==receipt.startedUtc || existing.ownerDisposition!==receipt.ownerDisposition)
          throw fail('GUI_INCIDENT_REVIEW_MISMATCH');
      } else {
        const fd=await fs.open(receiptPath,'wx',0o600);
        try { await fd.writeFile(JSON.stringify(receipt)+'\n','utf8'); await fd.sync(); }
        finally { await fd.close(); }
      }
      // Receipt must be durable before removing the live latch. The original
      // privacy-minimal pending bytes are retained, never silently deleted.
      if (await checkedFile(archivedPath)) throw fail('GUI_INCIDENT_REVIEW_ARCHIVE_CONFLICT');
      await fs.rename(file,archivedPath);
      if (!await reviewed(prior.id)) throw fail('GUI_INCIDENT_REVIEW_VERIFICATION_FAILED');
      return {ok:true,incidentId:prior.id,tool:prior.tool,ownerDisposition:disposition,
        verifiedArchive:true,neverReplayed:true};
    } catch(error) {
      if (error.guiCode) throw error;
      throw fail('GUI_INCIDENT_REVIEW_STORAGE_UNAVAILABLE');
    }
  }
  return {pending,begin,resolve,review,reviewed};
}
