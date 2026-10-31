// Interactive on-demand picker, never invoked by the remote MCP endpoint.
// Selection does NOT authorize a tool: the exact typed-phrase approval follows.
import {execFile} from 'node:child_process';
import {V2_GUI_APPROVAL_LOW_RISK_TOOLS} from './v2-native-owner-dialog.mjs';
const IDS=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ALLOWED=new Set(V2_GUI_APPROVAL_LOW_RISK_TOOLS);
export function eligibleV2PendingReviews(list){
 if(!Array.isArray(list)||list.length>64)throw new Error('V2_REVIEW_PICKER_QUEUE_INVALID');
 const ids=new Set();
 return list.filter(x=>{
  if(!x||typeof x!=='object'||typeof x.id!=='string'||!IDS.test(x.id))
   throw new Error('V2_REVIEW_PICKER_RECORD_INVALID');
  if(ids.has(x.id))throw new Error('V2_REVIEW_PICKER_DUPLICATE');
  ids.add(x.id);
  return x.status==='PENDING'&&x.expired===false&&
   ALLOWED.has(x.tool)&&x.arguments!==null&&
   typeof x.arguments==='object'&&!Array.isArray(x.arguments)&&
   Object.keys(x.arguments).length===0;
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
export async function pickV2PendingReview(list,{dialog=execFile,timeoutMs=120000}={}){
 const entries=eligibleV2PendingReviews(list);
 if(!entries.length)return null;
 if(typeof dialog!=='function'||!Number.isSafeInteger(timeoutMs)||
   timeoutMs<1000||timeoutMs>120000)throw new Error('V2_REVIEW_PICKER_CALLBACK_INVALID');
 const args=['--title','Commander V2 — Pending Owner Reviews','--menu',
  'Select ONE pending read-only request. Selection alone does not execute it.'];
 for(const item of entries)args.push(item.id,item.tool+' — '+item.id.slice(0,8));
 return await new Promise(resolve=>{
  try{
   dialog('/usr/bin/kdialog',args,{timeout:timeoutMs,maxBuffer:4096},
   (err,stdout)=>{
    if(err||typeof stdout!=='string'){resolve(null);return;}
    const id=stdout.trim();
    resolve(entries.some(x=>x.id===id)?id:null);
   });
  }catch{resolve(null)}
 });
}

// The launcher uses Terminal=false, so stdout alone is invisible. Show
// only a bounded fixed native message; never echo request arguments or
// raw results. A returned V1 RPC is not verified effect completion.
export async function displayV2NativeReviewOutcome(kind,{
 dialog=execFile,timeoutMs=120000
}={}){
 const messages={
  empty:'No eligible V2 diagnostic requests are pending. Requests expire after 10 minutes. Submit a new request from ChatGPT, then open this app.',
  cancelled:'No V2 operation was selected. No new action has been dispatched.',
  returned:'The approved V1 call returned. This confirms an RPC result, not completion of any long-running effect. Check the V2 request status.',
  error:'V2 owner review was unsuccessful or an outcome is uncertain. Check the exact request status before attempting anything else.'
 };
 if(!Object.hasOwn(messages,kind))throw new Error('V2_REVIEW_RESULT_KIND_INVALID');
 if(typeof dialog!=='function'||!Number.isSafeInteger(timeoutMs)||
    timeoutMs<1000||timeoutMs>120000)throw new Error('V2_REVIEW_RESULT_CALLBACK_INVALID');
 return await new Promise(resolve=>{
  try{
   dialog('/usr/bin/kdialog',[
    '--title','Commander V2 — Owner Review',
    '--msgbox',messages[kind]
   ],{timeout:timeoutMs,maxBuffer:2048},error=>resolve(!error));
  }catch{resolve(false)}
 });
}
