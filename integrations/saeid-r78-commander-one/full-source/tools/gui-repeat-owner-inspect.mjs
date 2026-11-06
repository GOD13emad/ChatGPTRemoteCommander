// Read-only candidate inspector. No receipt writer, input or restart here.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRepeatOwnerReviewedGuiStore,repeatOwnerReviewReady} from '../src/gui-repeat-owner-recovery.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=b=>createHash('sha256').update(b).digest('hex');
async function read(file){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>262144)throw Error('UNTRUSTED_FILE');
 const b=await fs.readFile(file);return {sha256:digest(b),record:JSON.parse(b)};}
async function rpc(name){
 const res=await fetch('http://127.0.0.1:47831/mcp',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
 headers:{'content-type':'application/json','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{},_meta:{
 'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{},
 'io.modelcontextprotocol/clientInfo':{name:'owner-repeat-review-inspect',version:'2'}}}})});
 if(!res.ok)throw Error('STATUS_UNAVAILABLE');const text=await res.text();if(text.length>1048576)throw Error('STATUS_TOO_LARGE');
 const x=JSON.parse(text);if(x.error||x.result?.isError)throw Error('STATUS_FAILED');
 return x.result.structuredContent||JSON.parse(x.result.content[0].text);
}
try{
 const plan=await read(path.join(root,'gui-repeat-recovery-plan.json'));
 const store=createRepeatOwnerReviewedGuiStore({...plan.record,root});
 const proposal=await store.reviewPlan();
 const route=await read(path.join(process.env.LOCALAPPDATA,'ChatGPTRemoteCommander','routing','default.json'));
 const config=await read(route.record.active.configPath);
 const status=await rpc('system_status'),gui=await rpc('gui_status');
 const stopFile=path.join(root,'var','GUI_STOP');
 if(!Array.isArray(plan.record.inheritedStopFiles)||plan.record.inheritedStopFiles.length<1||
    plan.record.inheritedStopFiles.some(p=>!path.isAbsolute(p)))throw Error('INHERITED_STOP_SCOPE_REQUIRED');
 let stopPresent=false;
 for(const p of [stopFile,...plan.record.inheritedStopFiles]){
   try{await fs.lstat(p);stopPresent=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const mode=config.record.guiOwnerRecovery;
 const ready=repeatOwnerReviewReady({proposal,root,activeRoot:path.resolve(route.record.active.projectDir),
 status,configHash:config.sha256,port:route.record.active.port,host:os.hostname(),gui,stopPresent,mode,plan:plan.record});
 console.log(JSON.stringify({ready,reason:ready?'READY_FOR_EXACT_OWNER_LOCAL_REVIEW':'CANDIDATE_NOT_ACTIVE_OR_EXACT_REVIEW_BLOCKED',
 proposal,sourceRoot:root,routeSha256:route.sha256,configSha256:config.sha256,planSha256:plan.sha256,
 stopFile,stopPresent,guiBusy:gui.busy,guiLeased:gui.leased,guiReason:gui.reason,liveIncidentId:gui.incident?.id??null}));
}catch(e){console.log(JSON.stringify({ready:false,reason:e.message}));process.exitCode=1;}
