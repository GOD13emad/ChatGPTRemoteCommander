// V2 owner-local application selection. Uses a native OS/browser broker only.
// Never reads, copies, decrypts or replays saved passwords, cookies, profile
// directories, session tokens or origin storage. This module does not launch a
// process itself: native registered-app launch and owner consent are mandatory.
import { normalizeV2Route } from './v2-routing-contract.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODES = new Set(['observe', 'background']);
const KINDS = new Set(['browser-target', 'app-window']);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const valid = v => typeof v === 'string' && ID.test(v) && v !== '.' && v !== '..';
const sameRoute = (a,b) => ['hostId','principalId','profileId','conversationId','operationId']
  .every(k=>a[k]===b[k]) && a.target.kind===b.target.kind && a.target.id===b.target.id;
const own = Object.prototype.hasOwnProperty;
function exactWindow(d,{appId,route,seatId}){
 if(!d || typeof d !== 'object' || Array.isArray(d)
   || d.appId!==appId || d.hostId!==route.hostId
   || d.principalId!==route.principalId || d.seatId!==seatId
   || !valid(d.windowId) || !valid(d.processStartId) || !Number.isSafeInteger(d.pid)
   || d.pid<=0 || d.present!==true || typeof d.backgroundReady!=='boolean'
   || typeof d.ownerSessionReady!=='boolean')
   fail('V2_OWNER_APP_WINDOW_UNVERIFIED');
 return Object.freeze({
   appId:d.appId,hostId:d.hostId,principalId:d.principalId,
   seatId:d.seatId,windowId:d.windowId,processStartId:d.processStartId,
   pid:d.pid,backgroundReady:d.backgroundReady,ownerSessionReady:d.ownerSessionReady
 });
}
function sameWindow(a,b){
 return ['appId','hostId','principalId','seatId','windowId','processStartId','pid']
   .every(k=>a[k]===b[k]);
}
function needs(...fns){if(fns.some(fn=>typeof fn!=='function'))fail('V2_OWNER_APP_TRUSTED_BROKER_REQUIRED');}
async function observed({route,sessionHandle,services}){
 const actual=normalizeV2Route(await services.sessions.resolveNativeRoute(sessionHandle));
 if(!sameRoute(route,actual))fail('V2_OWNER_APP_SESSION_ROUTE_CHANGED');
 const seatId=await services.observedNativeSeat(sessionHandle);
 if(!valid(seatId))fail('V2_OWNER_APP_NATIVE_SEAT_REQUIRED');
 return seatId;
}
async function windows({route,sessionHandle,appId,services}){
 const seatId=await observed({route,sessionHandle,services});
 const values=await services.listOwnerWindows(Object.freeze({
   appId,hostId:route.hostId,principalId:route.principalId,seatId,sessionHandle
 }));
 if(!Array.isArray(values)||values.length>128)fail('V2_OWNER_APP_INVENTORY_INVALID');
 const matched=values.filter(v=>v?.appId===appId);
 const byId=new Set();
 const resolved=matched.map(d=>{
  const w=exactWindow(d,{appId,route,seatId});
  if(byId.has(w.windowId))fail('V2_OWNER_APP_WINDOW_AMBIGUOUS');
  byId.add(w.windowId);return w;
 });
 return Object.freeze({seatId,windows:Object.freeze(resolved)});
}
/**
 * Select an already-running exact native app/browser window and use its
 * existing login in-place; or request owner-approved launch of an installed
 * registered app under the SAME interactive user (no custom profile copy).
 *
 * Actual background control is allowed only if native broker positively
 * attests the capability and browser-native consent has already succeeded.
 * No hidden credential, debugging flag or SYSTEM-to-user impersonation path.
 * The returned selection is not permission to execute tools: downstream
 * grant registry, workflow leases and per-action owner checks remain required.
 */
export async function openV2OwnerApplication({
 route,sessionHandle,appId,windowId,
 mode='background',openIfMissing=false,services
}={}){
 const r=normalizeV2Route(route);
 if(!KINDS.has(r.target.kind)||!valid(sessionHandle)||!valid(appId)||r.target.id!==appId
   || !MODES.has(mode)||typeof openIfMissing!=='boolean'
   || (windowId!==undefined&&!valid(windowId)))
   fail('V2_OWNER_APP_SELECTION_INVALID');
 if(!services||typeof services!=='object'||!services.sessions)fail('V2_OWNER_APP_TRUSTED_BROKER_REQUIRED');
 needs(services.sessions.resolveNativeRoute,services.observedNativeSeat,
  services.listOwnerWindows,services.authorizeAttach,
  services.attachExisting,services.verifyAttachment);
 let inventory=await windows({route:r,sessionHandle,appId,services});
 let matches=windowId===undefined?inventory.windows:inventory.windows.filter(w=>w.windowId===windowId);
 let launched=false;
 if(matches.length===0){
  if(windowId!==undefined||!openIfMissing)fail('V2_OWNER_APP_NOT_RUNNING');
  needs(services.authorizeLaunch,services.launchRegisteredApp);
  if(mode==='background')needs(services.canLaunchWithoutFocus);
  // Opening any installed app is a separate owner-granted action, not a
  // privilege inferred from a prior chat or the ability to inspect windows.
  const intent=Object.freeze({appId,route:r,sessionHandle,seatId:inventory.seatId,mode});
  if(mode==='background'&&await services.canLaunchWithoutFocus(intent)!==true)
    fail('V2_OWNER_APP_BACKGROUND_LAUNCH_UNAVAILABLE');
  if(await services.authorizeLaunch(intent)!==true)fail('V2_OWNER_APP_LAUNCH_CONSENT_REQUIRED');
  // Avoid a launch when another chat/window opened the app during approval.
  const before=await windows({route:r,sessionHandle,appId,services});
  if(before.seatId!==inventory.seatId)fail('V2_OWNER_APP_SEAT_CHANGED');
  if(before.windows.length)fail('V2_OWNER_APP_LAUNCH_RACE_RESELECT');
  if(mode==='background'&&await services.canLaunchWithoutFocus(intent)!==true)
    fail('V2_OWNER_APP_BACKGROUND_LAUNCH_UNAVAILABLE');
  const result=await services.launchRegisteredApp(intent);
  if(result?.ok!==true||!valid(result.windowId)||!Number.isSafeInteger(result.pid)||result.pid<=0
    ||(mode==='background'&&result.backgroundSafe!==true))
    fail('V2_OWNER_APP_LAUNCH_UNCERTAIN');
  launched=true;
  inventory=await windows({route:r,sessionHandle,appId,services});
  matches=inventory.windows.filter(w=>w.windowId===result.windowId&&w.pid===result.pid);
  if(matches.length!==1)fail('V2_OWNER_APP_LAUNCH_UNVERIFIED');
 }
 if(matches.length!==1)fail('V2_OWNER_APP_WINDOW_AMBIGUOUS');
 const selected=matches[0];
 if(selected.ownerSessionReady!==true)fail('V2_OWNER_APP_OWNER_NOT_READY');
 if(mode==='background'&&selected.backgroundReady!==true)
   fail('V2_OWNER_APP_BACKGROUND_UNAVAILABLE');
 const intent=Object.freeze({appId,route:r,sessionHandle,mode,
   windowId:selected.windowId,pid:selected.pid});
 if(await services.authorizeAttach(intent)!==true)
   fail('V2_OWNER_APP_ATTACH_CONSENT_REQUIRED');
 // Re-attest the exact native handle, process generation and owner seat after
 // potentially asynchronous user authorization, before any driver attach.
 const again=await windows({route:r,sessionHandle,appId,services})
  .catch(()=>fail('V2_OWNER_APP_CHANGED_DURING_CONSENT'));
 const fresh=again.windows.find(w=>w.windowId===selected.windowId);
 if(again.seatId!==inventory.seatId||!fresh||!sameWindow(fresh,selected)
   ||fresh.ownerSessionReady!==true||(mode==='background'&&fresh.backgroundReady!==true))
   fail('V2_OWNER_APP_CHANGED_DURING_CONSENT');
 let attachment;
 try {
  attachment=await services.attachExisting(Object.freeze({...intent,window:selected}));
 }catch {fail('V2_OWNER_APP_ATTACH_UNCERTAIN');}
 if(attachment?.ok!==true||!valid(attachment.attachmentId)
   ||(mode==='background'&&attachment.foregroundChanged!==false))
   fail('V2_OWNER_APP_ATTACH_UNCERTAIN');
 // Never return the native driver's raw object (which may contain secrets).
 const verified=await services.verifyAttachment(Object.freeze({
   ...intent,window:selected,attachmentId:attachment.attachmentId
 })).catch(()=>false);
 if(verified!==true)fail('V2_OWNER_APP_ATTACH_UNCERTAIN');
 const final=await windows({route:r,sessionHandle,appId,services}).catch(()=>null);
 const after=final?.windows?.find(w=>w.windowId===selected.windowId);
 if(!final||final.seatId!==inventory.seatId||!after||!sameWindow(after,selected))
   fail('V2_OWNER_APP_ATTACH_UNCERTAIN');
 return Object.freeze({
  status:'NATIVE_SESSION_BOUND',appId,windowId:selected.windowId,
  pid:selected.pid,mode,launched,existingSessionReused:!launched,
  credentialExported:false,passwordStoreAccessed:false,
  // No assertion that a website accepted its previous login until page
  // accessibility / native UI has itself verified an authenticated state.
  authenticatedLoginVerified:false,
  foregroundChanged:attachment.foregroundChanged===false?false:'NOT_VERIFIED',
  toolExecutionAuthorized:false
 });
}
