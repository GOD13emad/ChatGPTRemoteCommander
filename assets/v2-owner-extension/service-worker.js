// User-click only. No tabs, cookies, scripting, activeTab or content scripts.
// This is a pairing preflight; it never authenticates a ChatGPT conversation.
const HOST='com.chatgpt_remote_commander.v2';
chrome.action.onClicked.addListener(async()=>{
 const id='owner-probe-'+crypto.randomUUID();
 try{
  const response=await chrome.runtime.sendNativeMessage(HOST,{
   schema:1,type:'owner_preflight',requestId:id
  });
  if(chrome.runtime.lastError||!response||
    response.schema!==1||response.requestId!==id||
    response.type!=='owner_preflight_result'||
    response.status!=='OWNER_BINDING_AND_CHAT_CONSENT_REQUIRED'||
    response.toolsAuthorized!==false||response.chatAuthorized!==false)
   throw new Error('NATIVE_OWNER_NOT_PAIRED');
  await chrome.action.setBadgeText({text:'PAIR'});
 }catch{
  await chrome.action.setBadgeText({text:'OFF'});
 }
});
