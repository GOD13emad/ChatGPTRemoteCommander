// Owner's explicit local KDE approval for low-risk diagnostics only.
// Browser/MCP input cannot select a command line, executable or arbitrary file.
import {execFile} from 'node:child_process';
const ALLOWED=new Set(['system_status','gui_status','browser_status','workflow_health','power_status']);
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(code){throw Object.assign(new Error(code),{code})}
export async function confirmLowRiskV2OwnerDialog(request,{dialog=execFile,timeoutMs=30000}={}){
 if(!request||typeof request!=='object'||!ID.test(request.requestId??'')||
    !ALLOWED.has(request.tool)||!request.arguments||
    typeof request.arguments!=='object'||Array.isArray(request.arguments)||
    Object.keys(request.arguments).length!==0)fail('V2_GUI_OWNER_LOW_RISK_ONLY');
 if(typeof dialog!=='function'||!Number.isSafeInteger(timeoutMs)||
    timeoutMs<1000||timeoutMs>120000)fail('V2_GUI_OWNER_CALLBACK_INVALID');
 const message=[
  'Commander V2 — Owner confirmation',
  '',
  'Operation: '+request.tool,
  'Arguments: {}',
  'Request: '+request.requestId,
  '',
  'This will invoke one CURRENT-USER V1 diagnostic tool.',
  'No root access, GUI takeover or browser/session login is granted.',
  'Type APPROVE '+request.requestId.slice(0,8)+' to permit this ONE call.'
 ].join('\n');
 // No shell: all native arguments are constant except the validated display text.
 // Dismissal, nonzero exit, timeout, missing display or spawn failure -> DENY.
 return await new Promise(resolve=>{
  let settled=false;
  try{
   dialog('/usr/bin/kdialog',[
    '--title','Commander V2 — Local Owner Review',
    '--inputbox',message,''
   ],{timeout:timeoutMs,maxBuffer:2048,windowsHide:false},
   (error,stdout)=>{
    if(settled)return;settled=true;
    resolve(!error&&typeof stdout==='string'&&stdout.trim()==='APPROVE '+request.requestId.slice(0,8));
   });
  }catch{resolve(false)}
 });
}
export const V2_GUI_APPROVAL_LOW_RISK_TOOLS=Object.freeze([...ALLOWED]);
