import http from 'node:http';
import { once } from 'node:events';
import { createBrowserController } from '../src/browser-tools.mjs';

const html='<!doctype html><html><meta charset="utf-8"><title>RC Background Browser</title><body><label>Message <input id="msg" aria-label="Message"></label><input id="pw" type="password" autocomplete="current-password"><a id="oauth" href="/next?code=secret-code#token-fragment">Continue</a><form id="f" action="/submit?token=secret-form"><button id="apply" type="button" onclick="document.querySelector(\'#out\').textContent=document.querySelector(\'#msg\').value">Apply</button></form><p id="out"></p></body></html>';
const server=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url='http://127.0.0.1:'+server.address().port;
const config={instance:{profile:'native-e2e'},powerMode:{enabled:true,browserControl:{enabled:true,allowNavigate:true,allowInput:true,allowScreenshot:true,backgroundFirst:true,foregroundFallback:'explicit-current-request-only',workflowBrowserAllowed:false,userBrowserProfileReuse:false,savedPasswordExtraction:false}}};
const ctl=createBrowserController();
let lease;
try{
 const status=await ctl.execute({config},'browser_status',{});
 if(!status.available){console.log(JSON.stringify({status:'BROWSER_NATIVE_SKIP',reason:'NO_CHROMIUM_BROWSER'}));process.exitCode=77;}
 else{
  const begun=await ctl.execute({config},'browser_session_begin',{mode:'isolated',profile:'acceptance',ttlSeconds:120});lease=begun.lease;
  if(begun.userDesktopTouched!==false||begun.savedPasswordStoreAccess!==false)throw Error('BACKGROUND_INVARIANT');
  const nav=await ctl.execute({config},'browser_navigate',{lease,url:url+'?oauth_code=secret-page#secret-fragment',timeoutMs:10000});
  if(String(nav.url).includes('secret-page')||nav.urlQueryRedacted!==true||nav.urlFragmentRedacted!==true)throw Error('NAV_URL_REDACTION_FAIL');
  const before=await ctl.execute({config},'browser_snapshot',{lease,maxTextChars:5000,maxElements:50});
  if(before.signals.passwordInputCount!==1||before.suggestedForegroundReason!=='saved-browser-credential'||before.passwordValuesReturned!==false)throw Error('AUTH_SIGNAL_OR_REDACTION_FAIL');
  if(String(before.url).includes('secret-page')||before.urlQueryRedacted!==true||before.urlFragmentRedacted!==true)throw Error('SNAPSHOT_PAGE_URL_REDACTION_FAIL');
  const link=before.elements.find(x=>x.id==='oauth'),form=before.elements.find(x=>x.id==='f');
  if(!link||String(link.href).includes('secret-code')||link.hrefQueryRedacted!==true||link.hrefFragmentRedacted!==true)throw Error('LINK_URL_REDACTION_FAIL');
  if(!form||String(form.action).includes('secret-form')||form.actionQueryRedacted!==true)throw Error('FORM_URL_REDACTION_FAIL');
  await ctl.execute({config},'browser_fill',{lease,selector:'#msg',text:'سلام_background_123'});
  await ctl.execute({config},'browser_click',{lease,selector:'#apply'});
  await ctl.execute({config},'browser_wait',{lease,textIncludes:'سلام_background_123',timeoutMs:5000});
  const after=await ctl.execute({config},'browser_snapshot',{lease,maxTextChars:5000,maxElements:50});
  if(!after.text.includes('سلام_background_123'))throw Error('DOM_VERIFY_FAIL');
  const image=await ctl.execute({config},'browser_screenshot',{lease,format:'png',maxBytes:2097152});
  if(image.__structuredContent?.mimeType!=='image/png'||image.__structuredContent.bytes<8)throw Error('SCREENSHOT_FAIL');
  const approval=await ctl.execute({config},'browser_foreground_requirement',{lease,reason:'saved-browser-credential',targetHost:'127.0.0.1',detail:'fixture only'});
  if(!approval.approvalRequired||approval.desktopTakenOver!==false)throw Error('APPROVAL_FLOW_FAIL');
  await ctl.execute({config},'browser_session_end',{lease});lease=null;
  console.log(JSON.stringify({status:'BROWSER_NATIVE_PASS',backend:status.backend,browserProduct:begun.browserProduct,background:true,userDesktopTouched:false,passwordStoreExtracted:false,urlSecretsRedacted:true,authSignal:true,domVerified:true,screenshotBytes:image.__structuredContent.bytes,approvalOnDemand:true}));
 }
}finally{
 if(lease)try{await ctl.execute({config},'browser_session_end',{lease});}catch{}
 ctl.close();await new Promise(r=>server.close(r));
}
