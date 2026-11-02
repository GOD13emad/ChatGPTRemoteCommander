/* Commander V2 local workspace UI. No implicit account, browser, or OS actions. */
'use strict';
const $ = (id) => document.getElementById(id);
const key = 'commander-v2-workspace-local-drafts-v1';
const MAX_DRAFTS = 40;
const MAX_TEXT = 4000;
let drafts = [];
let route = 'Chat';
let selectedTab = 'Tasks';
let status = null;
let workflowView = {state:'NOT_CONNECTED',workflow:null};
let fencedReceiptView = {state:'NOT_CONNECTED',receipt:null};
let artifactProofView = {state:'NOT_CONNECTED',artifact:null};

function text(id, value) { const node=$(id); if(node) node.textContent=String(value); }
function toast(message) {
  const node=$('toast');
  node.textContent=message;
  node.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>node.classList.add('hidden'),4200);
}
function readDrafts() {
  try {
    const list=JSON.parse(localStorage.getItem(key)||'[]');
    if (!Array.isArray(list)) return [];
    return list.filter((x)=>x && typeof x.id==='string' &&
      typeof x.body==='string' && x.body.length<=MAX_TEXT &&
      typeof x.time==='string').slice(-MAX_DRAFTS);
  } catch { return []; }
}
function saveDrafts() {
  try { localStorage.setItem(key,JSON.stringify(drafts)); }
  catch { toast('Browser storage unavailable; drafts only live in this tab.'); }
}
function makeButton(label, title, fn, danger=false) {
  const b=document.createElement('button');
  b.type='button';b.className='smallbtn'+(danger?' danger':'');
  b.textContent=label;b.title=title;b.addEventListener('click',fn);
  return b;
}
function renderDrafts() {
  text('task-count',drafts.length);
  text('bottom-task-count',drafts.length);
  text('ring-number',drafts.length);
  text('ring-label',drafts.length ? 'Local drafts' : 'No running tasks');
  const stream=$('draft-stream'), table=$('draft-table');
  stream.replaceChildren();table.replaceChildren();
  if(!drafts.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=7;td.className='empty-table';
    td.textContent='No tasks yet. Use New Task to create a local draft.';
    tr.append(td);table.append(tr);
  }
  drafts.slice().reverse().forEach((draft,index)=>{
    const bubble=document.createElement('div');bubble.className='draft-bubble';bubble.dir='auto';
    const body=document.createElement('div');body.textContent=draft.body;
    const small=document.createElement('small');small.textContent='LOCAL DRAFT · Not sent to an agent';
    bubble.append(body,small);stream.append(bubble);
    const tr=document.createElement('tr');
    const values=[String(drafts.length-index),draft.body.slice(0,130),'Unassigned','DRAFT','—',new Date(draft.time).toLocaleString()];
    values.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;
      if(i===1){td.className='task-cell';td.title=draft.body;}
      if(i===3)td.className='draft-status';
      tr.append(td);
    });
    const actions=document.createElement('td');
    actions.append(
      makeButton('Edit','Edit local draft',()=>{
        $('prompt').value=draft.body;switchRoute('Chat');$('prompt').focus();
        toast('Draft loaded for editing. Save creates a new local draft.');
      }),
      makeButton('×','Delete local draft',()=>{
        if(!confirm('Delete this local draft?'))return;
        drafts=drafts.filter(x=>x.id!==draft.id);saveDrafts();renderDrafts();
      },true)
    );
    tr.append(actions);table.append(tr);
  });
}
function addDraft() {
  const body=$('prompt').value.trim();
  if(!body){$('prompt').focus();toast('Write a task before saving.');return;}
  if(body.length>MAX_TEXT){toast('Task is too long (maximum 4000 characters).');return;}
  if(drafts.length>=MAX_DRAFTS){toast('Maximum 40 local drafts. Delete an old draft first.');return;}
  const id=(globalThis.crypto && crypto.randomUUID)?crypto.randomUUID():String(Date.now())+String(Math.random());
  drafts.push({id,body,time:new Date().toISOString()});
  saveDrafts();renderDrafts();switchRoute('Chat');
  $('prompt').value='';toast('Local draft saved; no execution was started.');
}
function showOwnerEvidence(){
  const previous=$('owner-evidence');
  if(previous)previous.remove();
  const monitor=status?.evidence;
  if(!monitor || route==='Chat')return;
  const section=document.createElement('section');
  section.id='owner-evidence';section.className='owner-evidence';
  const heading=document.createElement('h2');heading.textContent='Owner-private observations (not authenticated)';
  section.append(heading);
  const line=document.createElement('p');
  const n=monitor.activeOperations;
  line.textContent='Monitor: '+monitor.state+' • Native GUI: '+monitor.gui+
    ' • Browser: '+monitor.browser+' • Active operations: '+(n===null?'unknown':n);
  section.append(line);
  if(route==='Projects' || route==='Tasks'){
    const projects=monitor.multiChat?.projects||[];
    const summary=document.createElement('p');
    summary.textContent='Project metadata: '+projects.length+
      ' • Chat identity authenticated: NO • Observed chat ≠ running agent';
    section.append(summary);
    for(const project of projects.slice(0,64)){
      const row=document.createElement('div');row.className='owner-project-row';
      const title=document.createElement('strong');title.textContent=project.title;
      const label=document.createElement('small');label.textContent=project.state+' · '+project.id;
      row.append(title,label);section.append(row);
    }
  } else if(route==='Workflow'){
    const w=monitor.workflow||{};
    const row=document.createElement('p');
    row.textContent='Workflow telemetry: '+(w.state||'UNVERIFIED')+
      ' • Engine configured: '+(w.engineEnabled===null?'unknown':w.engineEnabled)+
      ' • Historical runs: '+(w.runCount===null?'unknown':w.runCount)+
      ' • No verified task execution from this UI';
    section.append(row);
  }
  const transport=status?.transport;
  if(transport && (route==='Systems'||route==='Agents')){
    const title=document.createElement('h2');title.textContent='V2 local transport — anonymous diagnostic';section.append(title);
    const row=document.createElement('p');
    row.textContent='Transport: '+transport.state+' · '+(transport.endpoint||'not configured')+
      ' · Owner RPC authenticated: NO · ChatGPT OAuth: NO · Worker effect: NOT VERIFIED';
    section.append(row);
  }
  const seat=status?.ownerSeat;
  if(seat && (route==='Systems'||route==='Browser'||route==='Agents')){
    const heading=document.createElement('h2');
    heading.textContent='Native owner seat — monitoring only';
    section.append(heading);
    const row=document.createElement('p');
    row.textContent='State: '+seat.status+
      ' • Authenticated: NO • Control granted: NO'+
      (seat.seat!==null?' • OS session: '+seat.seat:'');
    section.append(row);
    if(seat.browserCounts!==null){
      const census=document.createElement('p');
      census.textContent='Browser processes observed: '+Object.entries(seat.browserCounts)
        .map(([name,count])=>name+' '+count).join(' · ');
      section.append(census);
    }
    if(seat.observedWindows!==null){
      const windows=document.createElement('p');
      windows.textContent='Observed windows (identity not exposed): '+
        Object.entries(seat.observedWindows).map(([name,count])=>name+' '+count).join(' · ');
      section.append(windows);
    }
  }
  if((route==='Workflow'||route==='History'||route==='Tasks')&&workflowView){
    const title=document.createElement('h2');
    title.textContent='Canonical WorkflowStore — read only';
    section.append(title);
    const line=document.createElement('p');
    const v=workflowView.workflow;
    line.textContent=v?
      'Workflow '+v.workflowId+' • '+v.lifecycle+' • Revision '+v.revision+
       ' • Acceptance '+v.acceptanceStatus+' • Not a worker receipt':
      'Workflow: '+workflowView.state+' • No authenticated execution receipt';
    section.append(line);
    if(v){
      for(const step of v.steps.slice(0,1000)){
        const row=document.createElement('div');row.className='owner-project-row';
        const name=document.createElement('strong');name.textContent=step.id;
        const info=document.createElement('small');info.textContent=step.status;
        row.append(name,info);section.append(row);
      }
    }
  }
  if(route==='Workflow'||route==='History'||route==='Tasks'){
    const heading=document.createElement('h2');
    heading.textContent='Central Coordinator receipt — not external action evidence';
    section.append(heading);
    const line=document.createElement('p');
    const r=fencedReceiptView?.receipt;
    line.textContent=r?
      'Receipt '+r.receiptId+' • '+r.state+' • Fence '+
      (r.fence===null?'not found':r.fence)+
      ' • Worker effect verified: NO':
      'Coordinator receipt: '+(fencedReceiptView?.state||'NOT_CONNECTED')+
      ' • Worker effect verified: NO';
    section.append(line);
  }
  if(route==='Workflow'||route==='History'||route==='Tasks'){
    const heading=document.createElement('h2');
    heading.textContent='Owner-private artifact — digest validation';
    section.append(heading);
    const line=document.createElement('p');
    const item=artifactProofView.artifact;
    line.textContent=item?
      'Private artifact: '+item.state+' • Artifact digest: '+
      (item.privateArtifactVerified?'VERIFIED':'NOT VERIFIED')+
      ' • General worker effect: NOT VERIFIED':
      'Private artifact: '+artifactProofView.state+' • General worker effect: NOT VERIFIED';
    section.append(line);
  }
  $('chat-content').append(section);
}
function switchRoute(next) {
  route=next;
  text('current-view',next);
  document.querySelectorAll('[data-route]').forEach((el)=>el.classList.toggle('active',el.dataset.route===next));
  const welcome=document.querySelector('.welcome');
  if(next==='Chat'){
    welcome.hidden=false;$('draft-stream').hidden=false;
  } else {
    welcome.hidden=true;$('draft-stream').hidden=true;
    let message=$('route-message');
    if(!message){message=document.createElement('div');message.id='route-message';message.className='notice';$('chat-content').prepend(message);}
    const descriptions={
      Tasks:'These are local task drafts only. Execution history requires V2 enrollment.',
      Projects:'Project Brain and accepted milestones will appear when the authenticated V2 project gateway is connected.',
      Agents:'Workers are not attached. The UI does not invent active agents.',
      Systems:'Only local host and explicitly paired machines may be displayed.',
      Browser:'Browser sessions require a scoped owner grant and a verified backend stream.',
      Files:'File browsing requires a project-scoped grant. No silent file scanning is performed.',
      Tools:'Capability discovery and tool invocation require authenticated V2 enrollment.',
      Terminal:'Terminal commands require authorized Core tool dispatch; this UI does not execute shell commands.',
      Apps:'Native application enumeration requires an authorized owner desktop session.',
      Workflow:'Workflow state must come from the canonical Commander WorkflowStore.',
      History:'Only verified execution receipts can establish completion or a task history.',
      Settings:'This preview uses only a local read-only host probe. Configure RC_V2_CORE_URL with a trusted loopback Core health endpoint.'
    };
    message.textContent=next+': '+(descriptions[next]||'Not connected.');
    showOwnerEvidence();
    if(next==='Workflow'||next==='History'||next==='Tasks'){refreshWorkflow();refreshReceipt();refreshArtifactProof();}
  }
  const m=$('route-message');
  if(next==='Chat' && m)m.remove();
}
function switchBottom(next){
  selectedTab=next;
  document.querySelectorAll('[data-bottom]').forEach(el=>el.classList.toggle('active',el.dataset.bottom===next));
  $('draft-table').closest('.table-wrap').classList.toggle('hidden',next!=='Tasks');
  $('bottom-placeholder').classList.toggle('hidden',next==='Tasks');
  if(next!=='Tasks') text('bottom-placeholder',
    next+' requires verified '+(next==='Logs'?'operation receipts':'V2 backend data')+
    '. No simulated records are shown.');
}
async function refreshWorkflow(){
  const token=location.hash.replace(/^#/,'');
  if(!/^[0-9a-f]{48}$/.test(token))return;
  try{
    const r=await fetch('/api/workflow',{cache:'no-store',
       headers:{'X-Commander-Workspace-Token':token}});
    const result=await r.json();
    if(!r.ok||!result||!['OWNER_READER_OBSERVED','NOT_CONNECTED'].includes(result.state))
      throw Error('Workflow unavailable');
    workflowView=result;
  }catch{
    workflowView={state:'UNVERIFIED',workflow:null};
  }
  text('workflow-view-state',workflowView.workflow?
     'Workflow '+workflowView.workflow.workflowId+': '+workflowView.workflow.lifecycle+
     ' • Not a receipt':
     'Workflow: '+workflowView.state);
  showOwnerEvidence();
}
async function refreshReceipt(){
  const token=location.hash.replace(/^#/,'');
  if(!/^[0-9a-f]{48}$/.test(token))return;
  try{
    const r=await fetch('/api/fenced-receipt',{cache:'no-store',
      headers:{'X-Commander-Workspace-Token':token}});
    const value=await r.json();
    if(!r.ok||!value||!['COORDINATOR_RECORD_OBSERVED','NOT_CONNECTED'].includes(value.state))
      throw Error('Receipt unavailable');
    fencedReceiptView=value;
  }catch{
    fencedReceiptView={state:'UNVERIFIED',receipt:null};
  }
  const receipt=fencedReceiptView.receipt;
  text('receipt-view-state',receipt?
    'Coordinator: '+receipt.state+' • Worker effect: NOT VERIFIED':
    'Coordinator: '+fencedReceiptView.state+' • Worker effect: NOT VERIFIED');
  showOwnerEvidence();
}
async function refreshArtifactProof(){
 const token=location.hash.replace(/^#/,'');
 if(!/^[0-9a-f]{48}$/.test(token))return;
 try{
  const response=await fetch('/api/private-artifact',{cache:'no-store',
   headers:{'X-Commander-Workspace-Token':token}});
  const output=await response.json();
  if(!response.ok||!output||
   !['NOT_CONNECTED','PRIVATE_ARTIFACT_OBSERVED'].includes(output.state))
   throw Error('Private artifact not verified');
  artifactProofView=output;
 }catch{artifactProofView={state:'UNVERIFIED',artifact:null};}
 const a=artifactProofView.artifact;
 text('artifact-proof-state',a?
  'Private artifact: '+a.state+' • Worker effect: NOT VERIFIED':
  'Private artifact: '+artifactProofView.state+' • Worker effect: NOT VERIFIED');
 showOwnerEvidence();
}
async function refreshStatus() {
  const token=location.hash.replace(/^#/,'');
  if(!/^[0-9a-f]{48}$/.test(token)) {
    text('core-state','LOCKED');text('side-health','Unpaired local UI');
    toast('Use the owner-local launcher to open this workspace.');return;
  }
  try{
    const response=await fetch('/api/status',{cache:'no-store',headers:{'X-Commander-Workspace-Token':token}});
    if(!response.ok)throw new Error('Gateway response '+response.status);
    const data=await response.json();
    status=data;
    const transport=data.transport;
    if(transport)text('transport-summary',
      'V2 local transport: '+transport.state+' · '+(transport.endpoint||'not configured')+
      ' · Owner/ChatGPT authenticated: NO');
    const seat=data.ownerSeat;
    if(seat){
      const total=seat.observedWindows===null?'unverified':Object.values(seat.observedWindows).reduce((a,b)=>a+b,0);
      text('seat-summary','Owner seat: '+seat.status+' · Native windows: '+total+' · Authentication: NO · Input: DISABLED');
    }
    const evidence=data.evidence;
    if(evidence){
      const count=evidence.activeOperations===null?'unknown':evidence.activeOperations;
      text('evidence-summary','Owner-private monitor: '+evidence.state+' · Operations: '+count+
        ' · Projects: '+(evidence.multiChat?.count??'unknown')+' · Chat authenticated: NO');
      text('top-agent',evidence.state==='CONNECTED'?'● Monitor observed (unverified)':'● No worker receipt');
      showOwnerEvidence();
    }
    text('machine-name',data.device.name);
    text('side-device',data.device.name);
    text('machine-platform',data.device.platform==='win32'?'Windows':data.device.platform==='linux'?'Linux':data.device.platform);
    text('top-system','◆ 1 local machine');
    text('desktop-name',data.device.name);
    const ready=data.core.state==='REACHABLE';
    text('machine-state',ready?'● Core reachable':'● Not verified');
    text('core-state',ready?'OK':data.core.state);
    text('side-health',ready?'Core health replied':'Core: '+data.core.state.toLowerCase().replaceAll('_',' '));
    text('core-version',data.core.version?'Observed version: '+data.core.version:'No verified Core version');
    $('core-bar').style.width=ready?'100%':'0';
    $('machine-state').style.color=ready?'#3bd68d':'#e7c983';
  }catch{
    text('core-state','NO RESPONSE');
    text('side-health','Workspace status unavailable');
    text('machine-state','● Unknown');
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  drafts=readDrafts();renderDrafts();
  document.querySelectorAll('[data-route]').forEach(el=>el.addEventListener('click',()=>switchRoute(el.dataset.route)));
  document.querySelectorAll('[data-bottom]').forEach(el=>el.addEventListener('click',()=>switchBottom(el.dataset.bottom)));
  document.querySelectorAll('[data-need]').forEach(el=>el.addEventListener('click',()=>toast(
    'Not available: '+el.dataset.need+' owner-session control has not passed V2 enrollment.')));
  $('new-task').addEventListener('click',()=>{switchRoute('Chat');$('prompt').focus();});
  $('plus-task').addEventListener('click',()=>{switchRoute('Chat');$('prompt').focus();});
  $('save-draft').addEventListener('click',addDraft);
  $('prompt').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')addDraft();});
  $('refresh-status').addEventListener('click',refreshStatus);
  refreshStatus();refreshWorkflow();refreshReceipt();refreshArtifactProof();
  setInterval(()=>{if(!document.hidden){refreshStatus();refreshWorkflow();refreshReceipt();refreshArtifactProof();}},20000);
});
