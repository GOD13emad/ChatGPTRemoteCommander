// Read-only preflight. No reset CLI, no receipt writer and no GUI injection.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {guiRecoverySourceIdentity} from '../src/gui-owner-recovery-store.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(process.env.LOCALAPPDATA,'ChatGPTRemoteCommander');
const sha=b=>createHash('sha256').update(b).digest('hex');
async function readSafe(file,max=8192){
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<1||st.size>max)
    throw Error('UNTRUSTED_FILE');
  const bytes=await fs.readFile(file);
  return {hash:sha(bytes),record:JSON.parse(bytes)};
}
async function rpc(name){
  const response=await fetch('http://127.0.0.1:47831/mcp',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{
      'content-type':'application/json','MCP-Protocol-Version':'2026-07-28',
      'Mcp-Method':'tools/call','Mcp-Name':name},body:JSON.stringify({
      jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{},_meta:{
        'io.modelcontextprotocol/protocolVersion':'2026-07-28',
        'io.modelcontextprotocol/clientCapabilities':{},
        'io.modelcontextprotocol/clientInfo':{name:'gui-owner-local-review',version:'1'}}}})});
  if(!response.ok)throw Error('RUNTIME_STATUS_UNAVAILABLE');
  const text=await response.text();
  if(text.length>1048576)throw Error('STATUS_TOO_LARGE');
  const result=JSON.parse(text);
  if(result.error||result.result?.isError)throw Error('STATUS_FAILED');
  return result.result.structuredContent||JSON.parse(result.result.content[0].text);
}
try{
  const route=await readSafe(path.join(base,'routing','default.json'));
  const incidentFile=path.join(process.env.LOCALAPPDATA,'chatgpt-remote-commander','gui-pending-native-input-v1.json');
  const incident=await readSafe(incidentFile,2048);
  const stopFile=path.join(root,'var','GUI_STOP');
  const stopStat=await fs.lstat(stopFile).catch(()=>null);
  let stopSha256=null;
  if(stopStat?.isFile()&&!stopStat.isSymbolicLink()&&stopStat.nlink===1&&stopStat.size<2048)
    stopSha256=sha(await fs.readFile(stopFile));
  const status=await rpc('system_status'),gui=await rpc('gui_status');
  const activeRoot=path.resolve(route.record.active.projectDir);
  const config=await readSafe(route.record.active.configPath,262144);
  const ready=activeRoot===root&&status.configSha256===config.hash&&
    status.port===route.record.active.port&&status.deviceName===os.hostname()&&
    gui.busy===false&&gui.leased===false&&gui.reason==='LOCAL_GUI_STOP'&&
    stopSha256==='fe23cbbf9bcffffee8c276fa9d2cac1b058b0a320375b47303b8d4bbab2ee689';
  console.log(JSON.stringify({schema:'rc-gui-owner-review-preflight-v1',
    ready,reason:ready?'READY_FOR_LOCAL_OWNER_REVIEW':'CANDIDATE_NOT_ACTIVE_OR_PREFLIGHT_BLOCKED',
    host:os.hostname(),user:os.userInfo().username,sourceRoot:root,
    sourceSha256:await guiRecoverySourceIdentity(root),incidentFile,
    incidentSha256:incident.hash,incidentId:incident.record.id,
    incidentTool:incident.record.tool,startedUtc:incident.record.startedUtc,
    incidentStatus:incident.record.status,stopFile,stopSha256,
    routeSha256:route.hash,configSha256:config.hash,
    guiBusy:gui.busy,guiLeased:gui.leased,guiReason:gui.reason}));
}catch(error){console.log(JSON.stringify({ready:false,reason:error.message}));process.exitCode=1;}
