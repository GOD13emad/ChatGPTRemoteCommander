import {classifyWorkspaceOutcome} from './workspace-routing.mjs';
// V2 R4/R5 owner-local method selection. This is an inert preflight;
// it NEVER attaches, launches, debugs, clicks, reads browser state or grants
// tool execution. Inputs must be observed by trusted native owner workers.
// A browser version or a consent flag cannot authenticate a ChatGPT caller.
const METHODS=Object.freeze({
 EXTENSION:'WEBEXTENSION_NATIVE_MESSAGING',
 CHROME:'CHROME_DEVTOOLS_MCP_AUTOCONNECT',
 UIA:'WINDOWS_UIA_OBSERVE',
 WINAPP:'WINAPP_UIA_OPTIONAL',
 ATSPI:'LINUX_AT_SPI_OBSERVE',
 PORTAL:'LINUX_XDG_PORTAL_INPUT'
});
const BROWSERS=new Set(['chrome','brave','edge','chromium','firefox','none']);
const OS=new Set(['windows','linux']);
const TARGET=new Set(['browser','app']);
const KEYS=new Set(['platform','target','browser','browserMajor','ownerSeatAttested',
 'exactWindowAttested','webExtensionInstalled','nativeHostVerified',
 'browserDebuggingEnabled','browserConsentVerified','uiaAvailable',
 'winappCliAvailable','atSpiAvailable','portalAvailable','portalConsentVerified']);
function fail(code){throw Object.assign(new Error(code),{code});}
/** Read-only V1 behavior reused without importing its journal or desktop broker.
 * A failure applies to the exact target, never a global input lock or replay.
 */
export function classifyV2WorkspaceControlOutcome({effect,refusedCode,hasFreshObservation}={}){
 if(effect!==undefined&&!['confirmed','uncertain','unknown'].includes(effect))
  throw Object.assign(new Error('V2_WORKSPACE_OUTCOME_INVALID'),{code:'V2_WORKSPACE_OUTCOME_INVALID'});
 if(refusedCode!==undefined&&!['background_unavailable','browser_input_trust_unavailable',
   'other'].includes(refusedCode))
  throw Object.assign(new Error('V2_WORKSPACE_OUTCOME_INVALID'),{code:'V2_WORKSPACE_OUTCOME_INVALID'});
 if(hasFreshObservation!==undefined&&typeof hasFreshObservation!=='boolean')
  throw Object.assign(new Error('V2_WORKSPACE_OUTCOME_INVALID'),{code:'V2_WORKSPACE_OUTCOME_INVALID'});
 return Object.freeze({...classifyWorkspaceOutcome({effect,refusedCode,hasFreshObservation}),
  globalInputLock:false,toolExecutionAuthorized:false});
}

function isPlain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)
 &&Object.getPrototypeOf(x)===Object.prototype;}
function candidate(method,state,reason){
 return Object.freeze({method,state,reason,toolExecutionAuthorized:false});
}
/**
 * Decision support only; never call this with raw model/RPC "grant" flags.
 * All status flags are observations from a trusted owner-session adapter;
 * even when true, actual attach and per-chat authorization are separate gates.
 */
export function planV2OwnerControlMethods(input={}){
 if(!isPlain(input)||Object.keys(input).some(k=>!KEYS.has(k)))fail('V2_CONTROL_PLAN_INPUT_INVALID');
 const {platform,target,browser='none',browserMajor=null}=input;
 if(!OS.has(platform)||!TARGET.has(target)||!BROWSERS.has(browser)||
   (target==='app'&&browser!=='none')||
   (target==='browser'&&browser==='none')||
   (browserMajor!==null&&(!Number.isInteger(browserMajor)||browserMajor<1||browserMajor>500))||
   (browser==='none'&&browserMajor!==null)||
   Object.entries(input).some(([k,v])=>k.endsWith('Attested')||k.endsWith('Available')||
    k==='webExtensionInstalled'||k==='nativeHostVerified'||k==='browserDebuggingEnabled'||
    k==='browserConsentVerified'?typeof v!=='boolean':false))
   fail('V2_CONTROL_PLAN_INPUT_INVALID');
 const onUncertainEffect=classifyV2WorkspaceControlOutcome({effect:'uncertain'});
 const methods=[];
 if(input.ownerSeatAttested!==true||input.exactWindowAttested!==true)
  return Object.freeze({status:'NATIVE_OWNER_EVIDENCE_REQUIRED',methods:Object.freeze(methods),
   selected:null,toolExecutionAuthorized:false,credentialAccessed:false,onUncertainEffect});
 if(target==='browser'){
  if(input.webExtensionInstalled===true)
   methods.push(candidate(METHODS.EXTENSION,
    input.nativeHostVerified===true?'NATIVE_HANDSHAKE_REQUIRED':'NATIVE_HOST_VERIFICATION_REQUIRED',
    'Extension and host must complete an exact-owner, per-chat, origin-pinned handshake'));
  if(browser==='chrome'&&browserMajor!==null&&browserMajor>=144)
   methods.push(candidate(METHODS.CHROME,
    input.browserDebuggingEnabled!==true?'BROWSER_DEBUGGING_OWNER_ENABLE_REQUIRED':
    input.browserConsentVerified!==true?'BROWSER_NATIVE_PROMPT_REQUIRED':
    'NATIVE_HANDSHAKE_REQUIRED',
    'Official Chrome 144+ consented autoConnect; not a Brave/Edge or silent-CDP grant'));
 }
 if(platform==='windows'){
  if(input.uiaAvailable===true)methods.push(candidate(METHODS.UIA,'READ_ONLY_CANDIDATE',
   'Native same-owner window accessibility does not authorize action'));
  if(input.winappCliAvailable===true)methods.push(candidate(METHODS.WINAPP,'INTEGRATION_VERIFICATION_REQUIRED',
   'winapp CLI UIA pattern access; foreground-changing commands need existing lease and owner grant'));
 }else{
  if(input.atSpiAvailable===true)methods.push(candidate(METHODS.ATSPI,'READ_ONLY_CANDIDATE',
   'Exact owner AT-SPI observation, not user input'));
  if(input.portalAvailable===true)methods.push(candidate(METHODS.PORTAL,
    input.portalConsentVerified===true?'PORTAL_SESSION_VERIFICATION_REQUIRED':
    'OS_NATIVE_CONSENT_REQUIRED',
    'XDG Portal RemoteDesktop EIS grant must remain owner- and session-scoped'));
 }
 const selected=methods.find(m=>m.state==='NATIVE_HANDSHAKE_REQUIRED')
   ??methods.find(m=>m.state==='READ_ONLY_CANDIDATE')??methods[0]??null;
 return Object.freeze({
  status:methods.length?'PLANNED_NOT_ATTACHED':'NO_VERIFIED_CONTROL_SURFACE',
  selected,methods:Object.freeze(methods),onUncertainEffect,toolExecutionAuthorized:false,
  credentialAccessed:false,liveChatIdentityVerified:false,
  nextGate:selected?.state??'OWNER_BACKEND_DISCOVERY_REQUIRED'
 });
}
