'use strict';
const statusEl=document.getElementById('status'),resultEl=document.getElementById('result'),start=document.getElementById('start'),stop=document.getElementById('stop');
const migrationEl=document.getElementById('migration');
async function preflight(){
  try{
    const r=await window.commander.preflight();
    show(migrationEl,{decision:r.decision,readOnly:r.readOnly,
      existingInstalled:r.existingInstalled,
      activeCoreUnits:r.activeCoreUnits,activeTunnelUnits:r.activeTunnelUnits,
      enabledCoreUnits:r.enabledCoreUnits,enabledTunnelUnits:r.enabledTunnelUnits,
      blocked:r.blocked,promotionAuthority:r.promotionAuthority});
  }catch(e){show(migrationEl,{decision:'NO_PROMOTE',
    error:'LOCAL_PREFLIGHT_UNAVAILABLE',readOnly:true});}
}
let busy=false;
const show=(el,v)=>{el.textContent=typeof v==='string'?v:JSON.stringify(v,null,2);};
async function refresh(){const state=await window.commander.status();show(statusEl,{version:state.version,source:state.source,platform:state.platform,packaged:state.packaged,liveDeployment:false,preview:state.preview,privilegedAccess:false});start.disabled=busy||state.preview==='running';stop.disabled=busy||state.preview!=='running';}
async function act(which){busy=true;start.disabled=true;stop.disabled=true;show(resultEl,'Working…');try{show(resultEl,await window.commander[which]());}catch(e){show(resultEl,{error:String(e.message||e)});}finally{busy=false;await refresh();}}
start.addEventListener('click',()=>act('startPreview'));stop.addEventListener('click',()=>act('stopPreview'));
refresh().catch(e=>show(statusEl,String(e.message||e)));
preflight();

const companionResult=document.getElementById('companion-result'),
  chatResult=document.getElementById('chat-result');
async function companionAction(fn,el){
  try{show(el,await window.commander[fn]());}
  catch(e){show(el,{error:String(e.message||e)});}
}
document.getElementById('chat-open').addEventListener('click',()=>companionAction('openChatBrowser',chatResult));
document.getElementById('chat-popup').addEventListener('click',()=>companionAction('openChatExtensionPopup',chatResult));
document.getElementById('companion-start').addEventListener('click',()=>companionAction('companionStart',companionResult));
document.getElementById('companion-stop').addEventListener('click',()=>companionAction('companionStop',companionResult));
document.getElementById('companion-code').addEventListener('click',()=>companionAction('companionPairCode',companionResult));
document.getElementById('companion-folder').addEventListener('click',()=>companionAction('companionExtensionFolder',companionResult));
window.commander.companionStatus().then(x=>show(companionResult,x)).catch(()=>{});

const target=document.getElementById('companion-browser-target');
const targetOpen=document.getElementById('companion-browser-open');
async function refreshBrowserTargets(){
  try{
    const options=await window.commander.companionBrowserList();
    target.replaceChildren();
    for(const item of options){
      const opt=document.createElement('option');
      opt.value=item.id;
      opt.textContent=item.label+(item.installed?(item.supported?' — installed':' — unsupported'):' — not found');
      opt.disabled=!item.installed||!item.supported;
      target.append(opt);
    }
    const chosen=[...target.options].find(o=>!o.disabled);
    target.value=chosen?.value??'';
    targetOpen.disabled=!chosen;
  }catch{targetOpen.disabled=true;show(companionResult,'Browser discovery unavailable');}
}
target.addEventListener('change',()=>{targetOpen.disabled=!target.value||target.selectedOptions[0]?.disabled;});
targetOpen.addEventListener('click',async()=>{
  targetOpen.disabled=true;
  try{show(companionResult,await window.commander.companionBrowserOpen(target.value));}
  catch(e){show(companionResult,{error:String(e.message||e)});}
  finally{targetOpen.disabled=!target.value||target.selectedOptions[0]?.disabled;}
});
void refreshBrowserTargets();


const monitorTarget=document.getElementById('monitor-instance');
const monitorSelect=document.getElementById('monitor-select');
const monitorRefresh=document.getElementById('monitor-refresh');
const monitorResult=document.getElementById('monitor-result');
const dashboardFreshness=document.getElementById('dashboard-freshness');
const dashboardKeys=['gui','browser','workflows','runs','extensions','relay','active','locks'];
let monitorGeneration=0, expirationTimer;
const countLabel=v=>Number.isSafeInteger(v)&&v>=0?String(v):'Unknown';
function readinessLabel(v){
  if(v?.uncertain===true)return 'Uncertain';
  if(v?.enabled===false)return 'Disabled';
  if(v?.enabled!==true||v?.uncertain!==false)return 'Unknown';
  return v.available===true?'Available (reported)':v.available===false?'Unavailable':'Unknown';
}
function workflowLabel(v){
  if(v?.enabled===false||v?.engineEnabled===false)return 'Disabled';
  return v?.enabled===true&&v?.engineEnabled===true?'Enabled (reported)':'Unknown';
}
function relayLabel(v){
  if(v?.enabled===false)return 'Disabled';
  if(v?.enabled!==true)return 'Unknown';
  return v.ready===true?'Ready (reported; delivery unverified)':v.ready===false?'Not ready':'Unknown';
}
function clearDashboard(message='Not selected',note='Select a local Core instance to inspect its snapshot.'){
  clearTimeout(expirationTimer);
  for(const key of dashboardKeys)show(document.getElementById('dashboard-'+key),message);
  show(dashboardFreshness,note);
}
function showDashboard(selected,generation){
  const summary=selected?.summary;
  const ttl=selected?.expiresAtEpochMs-Date.now();
  if(selected?.readOnly!==true||selected?.actionAuthorization!==false||
    !summary||!Number.isFinite(ttl)||ttl<=0||ttl>30000){
    clearDashboard('Unknown','Snapshot unavailable or stale. Select again.');
    return false;
  }
  const values={gui:readinessLabel(summary.gui),browser:readinessLabel(summary.browser),
    workflows:workflowLabel(summary.workflows),runs:countLabel(summary.workflows?.runCount),
    extensions:countLabel(summary.extensionCount),relay:relayLabel(summary.eventRelay),active:countLabel(summary.operations?.active),
    locks:countLabel(summary.operations?.lockedKeys)};
  for(const key of dashboardKeys)show(document.getElementById('dashboard-'+key),values[key]);
  show(dashboardFreshness,'Read-only snapshot · expires automatically. Not an action grant.');
  expirationTimer=setTimeout(()=>{
    if(generation!==monitorGeneration)return;
    clearDashboard('Stale','Snapshot expired. Select again to refresh.');
    show(monitorResult,'Selection stale or invalid. Refresh and select again.');
  },ttl);
  return true;
}
async function refreshMonitors(){
  const generation=++monitorGeneration;
  clearDashboard();
  monitorRefresh.disabled=true;monitorSelect.disabled=true;monitorTarget.disabled=true;monitorTarget.replaceChildren();
  const placeholder=document.createElement('option');
  placeholder.value='';placeholder.textContent='Choose an instance';monitorTarget.append(placeholder);
  try{
    const entries=await window.commander.monitorInstances();
    if(generation!==monitorGeneration)return;
    for(const entry of entries){
      const option=document.createElement('option');
      option.value=entry.scopeId;option.textContent=entry.profile+' : '+entry.port+' — '+entry.version;
      monitorTarget.append(option);
    }
    monitorTarget.value='';
    show(monitorResult,entries.length?'Select the exact Core profile and port.':'No fresh instance records.');
  }catch{if(generation===monitorGeneration)show(monitorResult,'Monitor discovery unavailable. No fallback selected.');}
  finally{if(generation===monitorGeneration){monitorRefresh.disabled=false;monitorTarget.disabled=false;}}
}
monitorRefresh.addEventListener('click',()=>void refreshMonitors());
monitorTarget.addEventListener('change',()=>{
  ++monitorGeneration;clearDashboard();monitorSelect.disabled=!monitorTarget.value;
  show(monitorResult,'Selection not yet validated.');
});
monitorSelect.addEventListener('click',async()=>{
  const id=monitorTarget.value,generation=++monitorGeneration;
  clearDashboard('Loading','Checking the selected local instance.');
  monitorSelect.disabled=true;
  show(monitorResult,'Checking selection…');
  try{
    const selected=await window.commander.monitorSelect(id);
    if(generation!==monitorGeneration||id!==monitorTarget.value)return;
    if(selected?.scopeId!==id){
      clearDashboard('Unknown','Selection did not match the requested instance.');
      show(monitorResult,'Selection stale or invalid. Refresh and select again.');return;
    }
    if(!showDashboard(selected,generation)){
      show(monitorResult,'Selection stale or invalid. Refresh and select again.');return;
    }
    show(monitorResult,selected);
  }catch{
    if(generation!==monitorGeneration)return;
    clearDashboard('Unknown','Snapshot unavailable or stale. Select again.');
    show(monitorResult,'Selection stale or invalid. Refresh and select again.');
  }
  finally{if(generation===monitorGeneration)monitorSelect.disabled=!monitorTarget.value;}
});
void refreshMonitors();

const addonsList=document.getElementById('addons-list'),addonsStatus=document.getElementById('addons-status'),addonsRefresh=document.getElementById('addons-refresh');
async function refreshAddons(){
  addonsRefresh.disabled=true;
  addonsList.replaceChildren();
  show(addonsStatus,'Inspecting committed catalog…');
  try{
    const data=await window.commander.catalogAddons();
    if(data?.actionAuthorization!==false||!Array.isArray(data.items)||data.items.length>64||
       data.items.some(x=>x?.installable!==false||x.state!=='PLANNED'||typeof x.name!=='string'||
       typeof x.platformSupported!=='boolean'))throw Error('WORKSPACE_CATALOG_INVALID');
    for(const item of data.items){
      const card=document.createElement('div'),name=document.createElement('dt'),state=document.createElement('dd');
      show(name,item.name);
      show(state,item.platformSupported?'Planned · not installable':'Planned · unsupported platform');
      card.append(name);card.append(state);addonsList.append(card);
    }
    show(addonsStatus,data.items.length+' planned add-ons · read-only');
  }catch{
    addonsList.replaceChildren();show(addonsStatus,'Catalog unavailable or invalid. No actions enabled.');
  }finally{addonsRefresh.disabled=false;}
}
addonsRefresh.addEventListener('click',()=>void refreshAddons());
void refreshAddons();
