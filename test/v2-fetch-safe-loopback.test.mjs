import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {listenOnFetchSafePort,isFetchSafeLoopbackPort} from './v2-fetch-safe-loopback.mjs';
test('Fetch forbidden-port guard rejects Windows low ephemeral range',()=>{
 for(const port of [0,53,554,6000,6667,10080,10081,-1,65536,NaN])
  assert.equal(isFetchSafeLoopbackPort(port),false);
 for(const port of [20000,49152,59999])
  assert.equal(isFetchSafeLoopbackPort(port),true);
});
test('loopback server always yields a browser-compatible port',async()=>{
 const server=http.createServer((_,res)=>res.writeHead(204).end());
 try{
  const port=await listenOnFetchSafePort(server);
  assert.equal(isFetchSafeLoopbackPort(port),true);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/test')).status,204);
 }finally{if(server.listening)await new Promise((ok,fail)=>server.close(e=>e?fail(e):ok()));}
});
test('already listening test server fails closed without shutting it down',async()=>{
 const server=http.createServer((_,res)=>res.end());
 try{
  await listenOnFetchSafePort(server);
  await assert.rejects(()=>listenOnFetchSafePort(server),{code:'V2_TEST_LOOPBACK_SERVER_INVALID'});
  assert.equal(server.listening,true);
 }finally{await new Promise(ok=>server.close(ok));}
});
