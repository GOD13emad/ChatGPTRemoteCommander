// Standalone user-scheduled CI watcher; read-only, no keys, no release effects.
// The durable state is local. It cannot send a ChatGPT notification itself.
import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const API='https://api.github.com/repos/GOD13emad/ChatGPTRemoteCommander';
const SHA=/^[a-f0-9]{40}$/;
function deny(code){throw Object.assign(new Error(code),{code});}
async function json(url,fetcher){
 let r;
 try { r=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
  headers:{'Accept':'application/vnd.github+json','User-Agent':'CommanderV2-CI-Watcher',
   'X-GitHub-Api-Version':'2022-11-28'}}); }
 catch {deny('CI_WATCH_NETWORK');}
 if(r?.status!==200||r.url&&r.url!==url)deny('CI_WATCH_HTTP_OR_REDIRECT');
 if(Number(r.headers?.get?.('content-length')||0)>1048576)deny('CI_WATCH_TOO_LARGE');
 if(!r.body?.getReader)deny('CI_WATCH_BODY_REQUIRED');
 const reader=r.body.getReader(),parts=[];let n=0;
 try {while(true){const x=await reader.read();if(x.done)break;n+=x.value.length;
  if(n>1048576){await reader.cancel().catch(()=>{});deny('CI_WATCH_TOO_LARGE');}
  parts.push(Buffer.from(x.value));}}finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(parts,n).toString('utf8'));}catch{deny('CI_WATCH_JSON');}
}
export function classify(head,items){
 if(!SHA.test(head)||!Array.isArray(items))deny('CI_WATCH_RESPONSE');
 const runs=items.filter(x=>x?.head_sha===head&&x.event==='pull_request').map(x=>{
  if(!Number.isSafeInteger(x.id)||x.id<=0||!['queued','pending','waiting','requested','in_progress','completed'].includes(x.status)
    || x.conclusion!==null&&!['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure'].includes(x.conclusion))
    deny('CI_WATCH_RUN_INVALID');
  return {id:x.id,name:String(x.name||'unknown').replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,120),
   status:x.status,conclusion:x.conclusion,attempt:Number.isSafeInteger(x.run_attempt)?x.run_attempt:1};
 }).sort((a,b)=>a.id-b.id);
 const failed=runs.filter(x=>x.status==='completed'&&!['success','skipped','neutral'].includes(x.conclusion));
 const done=runs.length>0&&runs.every(x=>x.status==='completed');
 return {head,runs,failed:failed.length,state:failed.length?'CI_FAILURE':done?'CI_COMPLETE_CANDIDATE_ONLY':'CI_PENDING',
  liveIdpAccepted:false,fleetAccepted:false,stableReleaseAccepted:false};
}
export function changes(previous,current){
 const old=new Map(previous?.runs?.map(x=>[x.id,x])||[]),alerts=[];
 if(previous?.head&&previous.head!==current.head)alerts.push({type:'HEAD_CHANGED',head:current.head});
 for(const r of current.runs)if(r.status==='completed'&&!['success','skipped','neutral'].includes(r.conclusion)){
  const p=old.get(r.id);if(!p||p.conclusion!==r.conclusion||p.attempt!==r.attempt)
   alerts.push({type:'FAILED',id:r.id,name:r.name,conclusion:r.conclusion,head:current.head});
 }
 if(current.state==='CI_COMPLETE_CANDIDATE_ONLY'&&previous?.state!==current.state)
  alerts.push({type:'CI_FINISHED_NOT_RELEASE_READY',head:current.head});
 return alerts;
}
export async function check({fetcher=globalThis.fetch,dir,clock=()=>new Date().toISOString()}={}){
 if(typeof fetcher!=='function'||typeof dir!=='string'||!dir)deny('CI_WATCH_CONFIG');
 const p=await json(API+'/pulls/426',fetcher);
 if(p?.number!==426||p?.state!=='open'||!SHA.test(p?.head?.sha))deny('CI_WATCH_PR_UNAVAILABLE');
 const h=p.head.sha;
 const response=await json(API+'/actions/runs?head_sha='+h+'&per_page=100',fetcher);
 const current={...classify(h,response?.workflow_runs),observedAt:clock(),draft:p.draft===true};
 await mkdir(dir,{recursive:true});
 const f=join(dir,'latest.json');let previous=null;
 try{previous=JSON.parse(await readFile(f,'utf8'));}catch(e){if(e.code!=='ENOENT')deny('CI_WATCH_STATE_UNREADABLE');}
 const alerts=changes(previous,current);
 const tmp=join(dir,'.latest-'+process.pid+'.tmp');
 await writeFile(tmp,JSON.stringify(current,null,2)+'\n',{flag:'wx',mode:0o600});
 await rename(tmp,f);
 if(alerts.length)await appendFile(join(dir,'transitions.jsonl'),
  alerts.map(x=>JSON.stringify({at:current.observedAt,...x})).join('\n')+'\n',{mode:0o600});
 return {...current,alerts};
}
const root=()=>join(process.env.LOCALAPPDATA||join(homedir(),'.local','state'),
 'ChatGPTRemoteCommander','v2-ci-watch');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {if(process.argv.length!==2 && !(process.argv.length===4&&process.argv[2]==='--state-dir'))deny('CI_WATCH_ARGS');
  const stateDir=process.argv.length===4?process.argv[3]:root();
  const v=await check({dir:stateDir});
  process.stdout.write(JSON.stringify({state:v.state,head:v.head,runs:v.runs.length,
   failed:v.failed,alerts:v.alerts.length,file:join(stateDir,'latest.json')})+'\n');
 }catch(e){process.stderr.write('V2_CI_WATCH_ERROR '+(e.code||'UNEXPECTED')+'\n');process.exitCode=2;}
}
