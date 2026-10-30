// V2 R7 candidate: honest Control Center readiness from trusted observations.
// No network calls, no credentials, no runtime deployment or auth shortcuts.
const HOST=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9._-]{0,80})?$/;
const PLATFORMS=new Set(['win32','linux']);
const BOUNDARY='TRUSTED_PROFILE_NOT_AUTHENTICATED_CHAT';
function fail(code){throw Object.assign(new Error(code),{code});}
/** observeHost(hostId) must be owner-trusted runtime attestation, NOT RPC input. */
export function createV2FleetReadiness({hosts,observeHost,now=Date.now,staleAfterMs=60000}={}){
 if(!Array.isArray(hosts)||hosts.length<1||hosts.length>25||
    typeof observeHost!=='function'||typeof now!=='function'||
    !Number.isSafeInteger(staleAfterMs)||staleAfterMs<1000||staleAfterMs>3600000)
   fail('V2_FLEET_TRUSTED_BOOTSTRAP_REQUIRED');
 const seen=new Set();
 const inventory=hosts.map(x=>{
  if(!x||typeof x!=='object'||Array.isArray(x)||
     typeof x.hostId!=='string'||!HOST.test(x.hostId)||
     !PLATFORMS.has(x.platform)||seen.has(x.hostId))
    fail('V2_FLEET_INVENTORY_INVALID');
  seen.add(x.hostId);
  return Object.freeze({hostId:x.hostId,platform:x.platform});
 });
 Object.freeze(inventory);
 return Object.freeze({
  async snapshot(){
   const at=now();
   if(!Number.isSafeInteger(at)||at<0)fail('V2_FLEET_CLOCK_INVALID');
   const fetched=await Promise.allSettled(inventory.map(x=>observeHost(x.hostId)));
   const nodes=fetched.map((r,i)=>{
    const host=inventory[i];
    const unknown=(reason)=>Object.freeze({
      ...host,transport:'UNKNOWN',v1Version:null,
      chatIdentity:'NOT_VERIFIED',guiOwner:'NOT_VERIFIED',
      v2Installed:'NOT_VERIFIED',reason
    });
    if(r.status==='rejected')return unknown('OBSERVATION_UNAVAILABLE');
    const d=r.value;
    if(!d||typeof d!=='object'||d.hostId!==host.hostId||
       typeof d.observedAtMs!=='number'||!Number.isSafeInteger(d.observedAtMs)||
       d.observedAtMs>at||at-d.observedAtMs>staleAfterMs)
      return unknown('EVIDENCE_STALE_OR_UNBOUND');
    if(d.transport!=='CONNECTED')
      return unknown('TRANSPORT_NOT_ATTESTED');
    const ver=typeof d.version==='string'&&VERSION.test(d.version)?d.version:null;
    // Runtime transport is NOT authentication. Only a separately attested
    // platform binding and authenticated OAuth proof may pass the chat gate.
    const authenticated=d.chatIdentity==='AUTHENTICATED_CHAT'&&
      d.chatIdentityAttested===true&&d.ownerSessionAttested===true;
    const gui=d.guiOwner?.configured===true&&d.guiOwner?.accepted===true&&
      d.guiOwner?.ownerSessionAttested===true&&d.guiOwner?.driverReady===true;
    const installed=d.v2?.installed===true&&d.v2?.exactBuildVerified===true&&
      d.v2?.liveAcceptancePassed===true;
    return Object.freeze({
      ...host,transport:'CONNECTED',v1Version:ver,
      chatIdentity:authenticated?'VERIFIED':'NOT_VERIFIED',
      guiOwner:gui?'READY':'NOT_VERIFIED',
      v2Installed:installed?'VERIFIED':'NOT_VERIFIED',
      reason:authenticated&&gui&&installed?'EVIDENCE_AVAILABLE':BOUNDARY
    });
   });
   return Object.freeze({
     schema:1,observedAtMs:at,
     nodes:Object.freeze(nodes),
     connected: nodes.filter(x=>x.transport==='CONNECTED').length,
     allHostsOperational:nodes.every(x=>
       x.transport==='CONNECTED'&&x.chatIdentity==='VERIFIED'&&
       x.guiOwner==='READY'&&x.v2Installed==='VERIFIED')
   });
  }
 });
}
