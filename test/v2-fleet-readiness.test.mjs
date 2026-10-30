import test from 'node:test';
import assert from 'node:assert/strict';
import {createV2FleetReadiness} from '../src/v2-fleet-readiness.mjs';
const hosts=[
 {hostId:'win-owner',platform:'win32'},{hostId:'win-server',platform:'win32'},
 {hostId:'linux-owner',platform:'linux'},{hostId:'offline',platform:'linux'}
];
test('fleet snapshot shows connected transport but never invents ChatGPT auth or V2 deployment',async()=>{
 const f=createV2FleetReadiness({hosts,now:()=>50000,
  observeHost:async hostId=>{
   if(hostId==='offline')throw Error('socket timeout / key details should be redacted');
   return {hostId,observedAtMs:49000,transport:'CONNECTED',
    version:'0.11.0-dev.18',chatIdentity:'TRUSTED_PROFILE_NOT_AUTHENTICATED_CHAT',
    guiOwner:{configured:true,accepted:false},v2:{installed:false}};
  }});
 const r=await f.snapshot();
 assert.equal(r.connected,3);
 assert.equal(r.allHostsOperational,false);
 assert.equal(r.nodes[0].chatIdentity,'NOT_VERIFIED');
 assert.equal(r.nodes[0].guiOwner,'NOT_VERIFIED');
 assert.equal(r.nodes[0].v2Installed,'NOT_VERIFIED');
 assert.equal(r.nodes[3].reason,'OBSERVATION_UNAVAILABLE');
 assert.equal(JSON.stringify(r).includes('socket timeout'),false);
});
test('authenticated chat alone does not imply owner GUI or installed version',async()=>{
 const f=createV2FleetReadiness({hosts:[hosts[0]],now:()=>10000,
  observeHost:async hostId=>({hostId,transport:'CONNECTED',observedAtMs:9900,
   version:'1.0.0',chatIdentity:'AUTHENTICATED_CHAT',chatIdentityAttested:true,
   ownerSessionAttested:true,guiOwner:{configured:true,accepted:true,driverReady:false},
   v2:{installed:true,exactBuildVerified:true}})});
 const r=await f.snapshot();
 assert.equal(r.nodes[0].chatIdentity,'VERIFIED');
 assert.equal(r.nodes[0].guiOwner,'NOT_VERIFIED');
 assert.equal(r.nodes[0].v2Installed,'NOT_VERIFIED');
 assert.equal(r.allHostsOperational,false);
});
test('stale and cross-host spoofed evidence never permits readiness',async()=>{
 const f=createV2FleetReadiness({hosts:[hosts[0],hosts[1]],now:()=>50000,
  staleAfterMs:3000,observeHost:async hostId=>({hostId:hostId==='win-owner'?'other':hostId,
  transport:'CONNECTED',observedAtMs:1000,chatIdentity:'AUTHENTICATED_CHAT',
  chatIdentityAttested:true,ownerSessionAttested:true,
  guiOwner:{configured:true,accepted:true,ownerSessionAttested:true,driverReady:true},
  v2:{installed:true,exactBuildVerified:true,liveAcceptancePassed:true}})});
 const r=await f.snapshot();
 assert.ok(r.nodes.every(x=>x.transport==='UNKNOWN'));
 assert.equal(r.allHostsOperational,false);
});
test('full acceptance needs independent exact build, chat, GUI, and transport evidence',async()=>{
 const f=createV2FleetReadiness({hosts:[hosts[0]],now:()=>20000,
  observeHost:async hostId=>({hostId,transport:'CONNECTED',observedAtMs:20000,
   version:'2.0.0',chatIdentity:'AUTHENTICATED_CHAT',chatIdentityAttested:true,
   ownerSessionAttested:true,
   guiOwner:{configured:true,accepted:true,ownerSessionAttested:true,driverReady:true},
   v2:{installed:true,exactBuildVerified:true,liveAcceptancePassed:true}})});
 const r=await f.snapshot();
 assert.equal(r.allHostsOperational,true);
 assert.equal(r.nodes[0].guiOwner,'READY');
 assert.equal(r.nodes[0].v2Installed,'VERIFIED');
});
test('unknown and duplicate hosts, untrusted callbacks and bad clock fail closed',async()=>{
 assert.throws(()=>createV2FleetReadiness({hosts,observeHost:null}),{code:'V2_FLEET_TRUSTED_BOOTSTRAP_REQUIRED'});
 assert.throws(()=>createV2FleetReadiness({hosts:[hosts[0],hosts[0]],observeHost:async()=>({})}),
  {code:'V2_FLEET_INVENTORY_INVALID'});
 const f=createV2FleetReadiness({hosts:[hosts[0]],now:()=>NaN,observeHost:async()=>({})});
 await assert.rejects(f.snapshot(),{code:'V2_FLEET_CLOCK_INVALID'});
});
