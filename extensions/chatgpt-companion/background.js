import {observationFromUrl} from './protocol.js';
const APP='REMOTE_COMMANDER_CHAT_COMPANION';
const ENDPOINT='http://127.0.0.1:41267';
const PAIR_KEY='commanderPairToken';
let inFlight=false,latest=null,latestEpoch=0;
async function token(){const data=await chrome.storage.local.get(PAIR_KEY);return data[PAIR_KEY]??null;}
async function call(route,body,credential=null){
  const result=await fetch(ENDPOINT+route,{method:'POST',
    headers:{'Content-Type':'application/json',...(credential?{'Authorization':'Bearer '+credential}:{})},
    body:JSON.stringify(body),cache:'no-store',redirect:'error',credentials:'omit'});
  const reply=await result.json();
  if(!result.ok||!reply?.ok)throw Error(reply?.code||'BRIDGE_UNAVAILABLE');
  return reply;
}
async function deliver(){
  if(inFlight||!latest)return;
  inFlight=true;
  try{
    const credential=await token();
    if(!credential)return;
    // A new navigation during an in-flight request must not be lost.
    for(let i=0;i<3;i++){
      const current=latest,epoch=latestEpoch;
      await call('/observation',current,credential);
      if(epoch===latestEpoch)break;
    }
  }catch{/* Not paired or bridge stopped: retry at next periodic tab heartbeat. */}
  finally{inFlight=false;}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  (async()=>{
    if(message?.kind==='CHAT_URL'){
      if(sender.id!==chrome.runtime.id||typeof sender.url!=='string'||!sender.tab)
        throw Error('CONTENT_ORIGIN_DENIED');
      const url=new URL(sender.url);
      if(url.protocol!=='https:'||!['chatgpt.com','chat.openai.com'].includes(url.hostname)
         ||url.username||url.password||url.port)
        throw Error('CONTENT_ORIGIN_DENIED');
      // Always use the browser-authenticated sender URL, never a page-provided URL.
      latest=observationFromUrl(sender.url);latestEpoch++;
      await deliver();
      return {ok:true};
    }
    // Sender metadata is browser-supplied. Electron's extension popup can
    // legitimately have sender.tab, unlike the native Chrome action popup;
    // origin URL is the security boundary, not the tab-presence heuristic.
    // A content script cannot forge its sender.url as an extension page.
    const popupUrl='chrome-extension://'+chrome.runtime.id+'/popup.html';
    if(sender.id!==chrome.runtime.id||sender.url!==popupUrl)
      throw Error('POPUP_ONLY');
    if(message?.kind==='STATUS')return {ok:true,paired:Boolean(await token())};
    if(message?.kind==='PAIR'){
      if(typeof message.code!=='string'||!/^[A-F0-9]{16}$/.test(message.code))
        throw Error('CODE_INVALID');
      const reply=await call('/pair',{code:message.code});
      if(reply.app!==APP||typeof reply.token!=='string'||!/^[a-f0-9]{64}$/.test(reply.token))
        throw Error('BRIDGE_IDENTITY_INVALID');
      await chrome.storage.local.set({[PAIR_KEY]:reply.token});
      await deliver();
      return {ok:true,paired:true};
    }
    if(message?.kind==='DISCONNECT'){
      const old=await token();
      if(old)try{await call('/revoke',{},old);}catch{throw Error('BRIDGE_REVOKE_UNCONFIRMED');}
      await chrome.storage.local.remove(PAIR_KEY);
      return {ok:true,paired:false};
    }
    throw Error('MESSAGE_DENIED');
  })().then(respond,error=>respond({ok:false,error:String(error.message||error)}));
  return true;
});
chrome.runtime.onStartup?.addListener(()=>{void deliver();});
