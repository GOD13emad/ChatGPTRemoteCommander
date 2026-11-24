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
const monitorResult=document.getElementById('monitor-result');
async function refreshMonitors(){
  monitorSelect.disabled=true;monitorTarget.replaceChildren();
  const placeholder=document.createElement('option');
  placeholder.value='';placeholder.textContent='Choose an instance';monitorTarget.append(placeholder);
  try{
    const entries=await window.commander.monitorInstances();
    for(const entry of entries){
      const option=document.createElement('option');
      option.value=entry.scopeId;option.textContent=entry.profile+' : '+entry.port+' — '+entry.version;
      monitorTarget.append(option);
    }
    monitorTarget.value='';
    show(monitorResult,entries.length?'Select the exact Core profile and port.':'No fresh instance records.');
  }catch{show(monitorResult,'Monitor discovery unavailable. No fallback selected.');}
}
document.getElementById('monitor-refresh').addEventListener('click',()=>void refreshMonitors());
monitorTarget.addEventListener('change',()=>{monitorSelect.disabled=!monitorTarget.value;show(monitorResult,'Selection not yet validated.');});
monitorSelect.addEventListener('click',async()=>{
  monitorSelect.disabled=true;
  try{
    const selected=await window.commander.monitorSelect(monitorTarget.value);
    show(monitorResult,selected);
  }catch{show(monitorResult,'Selection stale or invalid. Refresh and select again.');}
  finally{monitorSelect.disabled=!monitorTarget.value;}
});
void refreshMonitors();
