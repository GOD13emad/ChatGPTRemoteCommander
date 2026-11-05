import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  legacyPrivilegedMcpQuarantine, rejectLegacyPrivilegedMcp
} from '../src/full-access-http-quarantine.mjs';

const high = {ok:true,isAdmin:true,elevation:'high',source:'local-process-token'};
const filtered = {ok:true,isAdmin:false,elevation:'filtered',source:'local-process-token'};

test('full access configuration is quarantined even with a filtered Windows token',()=>{
  const r=legacyPrivilegedMcpQuarantine({
    platform:'win32',configuredTier:'FULL_ACCESS',windowsAdminToken:filtered
  });
  assert.equal(r.quarantine,true);
  assert.equal(r.privilegedProcess,false);
  assert.equal(r.code,'TRUSTED_V2_INGRESS_REQUIRED');
});
test('elevated Windows token is quarantined regardless of configured tier',()=>{
  for(const configuredTier of ['STANDARD','FULL_POWER','FULL_ACCESS']){
    const r=legacyPrivilegedMcpQuarantine({
      platform:'win32',configuredTier,windowsAdminToken:high
    });
    assert.equal(r.quarantine,true);
    assert.equal(r.privilegedProcess,true);
  }
});
test('failed or inconsistent Windows admin token proof cannot be a bypass',()=>{
  for(const windowsAdminToken of [null,{ok:false,code:'PROBE_FAILED'},
    {ok:true,isAdmin:true,elevation:'filtered',source:'local-process-token'}]){
    assert.equal(legacyPrivilegedMcpQuarantine({
      platform:'win32',configuredTier:'FULL_POWER',windowsAdminToken
    }).quarantine,true);
  }
});
test('filtered Windows FULL_POWER retains legacy availability',()=>{
  const r=legacyPrivilegedMcpQuarantine({
    platform:'win32',configuredTier:'FULL_POWER',windowsAdminToken:filtered
  });
  assert.equal(r.quarantine,false);
  assert.equal(r.code,'LEGACY_OWNER_TOKEN_ONLY');
});
test('actual Linux root token always quarantines legacy MCP even if tier is STANDARD',()=>{
  for(const configuredTier of ['STANDARD','FULL_POWER','FULL_ACCESS']){
    assert.equal(legacyPrivilegedMcpQuarantine({
      platform:'linux',configuredTier,effectiveUid:0
    }).quarantine,true);
  }
});
test('normal Linux owner-token FULL_POWER works; unknown UID blocks',()=>{
  assert.equal(legacyPrivilegedMcpQuarantine({
    platform:'linux',configuredTier:'FULL_POWER',effectiveUid:1000
  }).quarantine,false);
  assert.equal(legacyPrivilegedMcpQuarantine({
    platform:'linux',configuredTier:'FULL_ACCESS',effectiveUid:1000
  }).quarantine,true);
  assert.equal(legacyPrivilegedMcpQuarantine({
    platform:'linux',configuredTier:'FULL_POWER',effectiveUid:null
  }).quarantine,true);
});
test('unknown platform is never considered a safe legacy privileged listener',()=>{
  assert.equal(legacyPrivilegedMcpQuarantine({
    platform:'freebsd',configuredTier:'FULL_POWER'
  }).quarantine,true);
});
test('anonymous, forged Bearer and Host headers cannot cause privileged dispatch',async()=>{
  const guarded=legacyPrivilegedMcpQuarantine({
    platform:'win32',configuredTier:'FULL_ACCESS',windowsAdminToken:high
  });
  let dispatches=0;
  const server=http.createServer((req,res)=>{
    if(rejectLegacyPrivilegedMcp(req,res,guarded))return;
    dispatches++;res.writeHead(200);res.end('unsafe');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const port=server.address().port;
    for(const headers of [{}, {authorization:'Bearer forged'}, {'x-chat-id':'forged'}]){
      const res=await fetch('http://127.0.0.1:'+port+'/mcp',{
        method:'POST',headers:{'content-type':'application/json',...headers},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})
      });
      assert.equal(res.status,403);
      assert.equal(res.headers.get('cache-control'),'no-store');
      assert.deepEqual(await res.json(),{error:'trusted_transport_required'});
    }
    assert.equal(dispatches,0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});
test('guard does not intercept a verified filtered owner process',()=>{
  const safe=legacyPrivilegedMcpQuarantine({
    platform:'win32',configuredTier:'FULL_POWER',windowsAdminToken:filtered
  });
  assert.equal(rejectLegacyPrivilegedMcp({}, {}, safe),false);
});
