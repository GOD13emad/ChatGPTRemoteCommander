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
