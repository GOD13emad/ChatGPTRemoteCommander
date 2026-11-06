import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {legacyPrivilegedMcpQuarantine,rejectLegacyPrivilegedMcp} from '../../src/full-access-http-quarantine.mjs';

// Untrusted/incomplete dependency answers are never equivalent to a verified filtered token.
const cases=[
 ['missing admin state',{ok:true,source:'local-process-token',elevation:'filtered'}],
 ['missing source',{ok:true,isAdmin:false,elevation:'filtered'}],
 ['wrong source',{ok:true,isAdmin:false,elevation:'filtered',source:'caller-json'}],
 ['missing elevation',{ok:true,isAdmin:false,source:'local-process-token'}],
 ['high plus false admin',{ok:true,isAdmin:false,elevation:'high',source:'local-process-token'}],
 ['string false admin',{ok:true,isAdmin:'false',elevation:'filtered',source:'local-process-token'}],
 ['unknown elevation',{ok:true,isAdmin:false,elevation:'unknown',source:'local-process-token'}],
 ['null proof',null]
];
for(const [name,proof] of cases)test('Windows incomplete token proof blocks legacy HTTP: '+name,()=>{
 const decision=legacyPrivilegedMcpQuarantine({platform:'win32',configuredTier:'FULL_POWER',windowsAdminToken:proof});
 assert.equal(decision.quarantine,true);
 assert.equal(decision.tokenUncertain,true);
 assert.equal(decision.code,'TRUSTED_V2_INGRESS_REQUIRED');
});
test('a filtered owner proof still preserves ordinary existing FULL_POWER',()=>{
 const proof={ok:true,isAdmin:false,elevation:'filtered',source:'local-process-token'};
 assert.equal(legacyPrivilegedMcpQuarantine({platform:'win32',configuredTier:'FULL_POWER',windowsAdminToken:proof}).quarantine,false);
});
test('invalid dependency proof never reaches a dispatcher even with forged client headers',async()=>{
 let dispatches=0;
 const invalid={ok:true,isAdmin:false,elevation:'high',source:'caller-json'};
 const decision=legacyPrivilegedMcpQuarantine({platform:'win32',configuredTier:'FULL_POWER',windowsAdminToken:invalid});
 const server=http.createServer((req,res)=>{if(rejectLegacyPrivilegedMcp(req,res,decision))return;dispatches++;res.writeHead(200);res.end('unsafe-dispatch');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const result=await fetch('http://127.0.0.1:'+server.address().port+'/mcp',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer forged','x-chat-id':'forged'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'native_probe'}})});
  assert.equal(result.status,403);assert.equal(dispatches,0);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
