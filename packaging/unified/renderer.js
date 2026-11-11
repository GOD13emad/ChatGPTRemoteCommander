'use strict';
const statusEl=document.getElementById('status'),resultEl=document.getElementById('result'),start=document.getElementById('start'),stop=document.getElementById('stop');
let busy=false;
const show=(el,v)=>{el.textContent=typeof v==='string'?v:JSON.stringify(v,null,2);};
async function refresh(){const state=await window.commander.status();show(statusEl,{version:state.version,source:state.source,platform:state.platform,packaged:state.packaged,liveDeployment:false,preview:state.preview,privilegedAccess:false});start.disabled=busy||state.preview==='running';stop.disabled=busy||state.preview!=='running';}
async function act(which){busy=true;start.disabled=true;stop.disabled=true;show(resultEl,'Working…');try{show(resultEl,await window.commander[which]());}catch(e){show(resultEl,{error:String(e.message||e)});}finally{busy=false;await refresh();}}
start.addEventListener('click',()=>act('startPreview'));stop.addEventListener('click',()=>act('stopPreview'));
refresh().catch(e=>show(statusEl,String(e.message||e)));
