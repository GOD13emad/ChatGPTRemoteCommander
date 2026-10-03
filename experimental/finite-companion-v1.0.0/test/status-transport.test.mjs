import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once,EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {parseStatusJson} from '../src/strict-status-json.mjs';
import {createSaeedStatusTransport} from '../src/saeed-status-transport.mjs';

// Synthetic fingerprint, unrelated to any installed machine configuration.
const configSha256='e'.repeat(64);
const host={name:'chatgpt-remote-commander',deviceName:'saeid',platform:'win32',version:'0.10.6',
  instance:{profile:'default',isolated:false},configSha256};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function localFixture(handler,options={}) {
  const calls=[],connections=new Set();
  const server=http.createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const raw=Buffer.concat(chunks).toString('utf8'),body=JSON.parse(raw);
    calls.push({method:request.method,path:request.url,headers:request.headers,body});
    try{await handler(request,response,body);}catch{response.destroy();}
  });
  server.on('connection',socket=>{connections.add(socket);socket.once('close',()=>connections.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;
  return {calls,port,read:createSaeedStatusTransport({port,expectedConfigSha256:configSha256,...options}),
    async close(){for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
const envelope=(id,result)=>JSON.stringify({jsonrpc:'2.0',id,result});
function writeStatus(response,id,value=host){response.writeHead(200,{'content-type':'application/json'});response.end(envelope(id,{structuredContent:value}));}

test('strict parser accepts ordinary nested data and preserves escaped names',()=>{
  assert.deepEqual(parseStatusJson(Buffer.from('{"one":[1,true,null,{"دو":"fa"}]}')),{one:[1,true,null,{'دو':'fa'}]});
});
for(const [label,value] of [
  ['duplicate plain names','{"a":1,"a":2}'],['duplicate escaped names','{"a":1,"\\u0061":2}'],
  ['nested duplicate','{"a":{"b":1,"b":2}}'],['malformed utf8',Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d])],
  ['binary BOM',Buffer.from('\uFEFF{"a":1}')],['string BOM','\uFEFF{"a":1}'],
  ['lone surrogate','{"a":"\ud800"}'],['depth limit','['.repeat(33)+'0'+']'.repeat(33)],
  ['UTF8 byte limit','{"a":"'+'ف'.repeat(530000)+'"}'],['token limit','['+'0,'.repeat(50001)+'0]'],
  ['unterminated string','{"a":"unfinished}'],['unbalanced','{"a":[1,2}']])
  test('strict JSON rejects '+label,()=>assert.throws(()=>parseStatusJson(value),{code:'SAEED_TRANSPORT_JSON'}));

test('only fixed local POST system_status is sent; success waits for owned close and hashes exact bytes',async()=>{
  let raw;
  const f=await localFixture((_request,response,body)=>{raw=envelope(body.id,{structuredContent:host});response.end(raw);});
  try{
    const result=await f.read();assert.equal(result.requestClosed,true);assert.equal(result.automaticRetry,false);
    assert.equal(result.sourcePort,f.port);assert.equal(result.status.version,'0.10.6');assert.equal(f.calls.length,1);
    assert.equal(result.responseSha256,createHash('sha256').update(raw).digest('hex'));
    assert.deepEqual(f.calls[0].body,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'system_status',arguments:{}}});
    assert.equal(f.calls[0].method,'POST');assert.equal(f.calls[0].path,'/mcp');assert.equal(f.calls[0].headers.connection,'close');
    assert.equal(f.calls[0].headers.authorization,undefined);
  }finally{await f.close();}
});
test('single text MCP content is strictly parsed when structured content is absent',async()=>{
  const f=await localFixture((_request,response,body)=>response.end(envelope(body.id,{content:[{type:'text',text:JSON.stringify(host)}]})));
  try{assert.equal((await f.read()).status.deviceName,'saeid');assert.equal(f.calls.length,1);}finally{await f.close();}
});
for(const value of [{...host,deviceName:'Emad-PC-Ultimate'},{...host,version:'0.10.5'},{...host,platform:'linux'},
  {...host,configSha256:'f'.repeat(64)},{...host,instance:{profile:'other',isolated:false}},
  {...host,instance:{profile:'default',isolated:true}}])
  test('wrong host/runtime/config/profile is not evidence '+JSON.stringify(value),async()=>{
    const f=await localFixture((_request,response,body)=>writeStatus(response,body.id,value));
    try{await assert.rejects(f.read(),error=>error.code==='SAEED_TRANSPORT_IDENTITY_DRIFT'&&error.requestClosed===true);
      await delay(10);assert.equal(f.calls.length,1);}finally{await f.close();}
  });
for(const [label,handler,code] of [
  ['HTTP failure',(_q,r)=>{r.writeHead(503);r.end('fixture failure');},'SAEED_TRANSPORT_HTTP_503'],
  ['wrong RPC id',(_q,r,b)=>r.end(envelope(b.id+1,{structuredContent:host})),'SAEED_TRANSPORT_RPC'],
  ['RPC error',(_q,r,b)=>r.end(JSON.stringify({jsonrpc:'2.0',id:b.id,error:{code:-32603}})),'SAEED_TRANSPORT_RPC'],
  ['MCP isError',(_q,r,b)=>r.end(envelope(b.id,{isError:true,structuredContent:host})),'SAEED_TRANSPORT_RPC'],
  ['duplicate response keys',(_q,r,b)=>r.end('{"jsonrpc":"2.0","id":'+b.id+',"id":'+b.id+',"result":{}}'),'SAEED_TRANSPORT_JSON'],
  ['multiple text blocks',(_q,r,b)=>r.end(envelope(b.id,{content:[{type:'text',text:JSON.stringify(host)},{type:'text',text:'{}'}]})),'SAEED_TRANSPORT_STATUS_SHAPE'],
  ['duplicate nested text identity',(_q,r,b)=>r.end(envelope(b.id,{content:[{type:'text',text:'{"deviceName":"saeid","deviceName":"other"}'}]})),'SAEED_TRANSPORT_STATUS_SHAPE'],
  ['declared size limit',(_q,r)=>{r.writeHead(200,{'content-length':'2000'});r.end('{}');},'SAEED_TRANSPORT_SIZE'],
  ['streamed size limit',(_q,r)=>{r.writeHead(200,{'transfer-encoding':'chunked'});r.end(' '.repeat(2000));},'SAEED_TRANSPORT_SIZE']])
  test('one request, original classification and confirmed close on '+label,async()=>{
    const f=await localFixture(handler,{maxBytes:1024});
    try{await assert.rejects(f.read(),error=>error.code===code&&error.requestClosed===true);
      await delay(10);assert.equal(f.calls.length,1);}finally{await f.close();}
  });
test('timeout destroys only its request and never reconnects',async()=>{
  const f=await localFixture(()=>{}, {timeoutMs:100});
  try{await assert.rejects(f.read(),error=>error.code==='SAEED_TRANSPORT_TIMEOUT'&&error.requestClosed===true);
    await delay(110);assert.equal(f.calls.length,1);}finally{await f.close();}
});
test('in-flight busy admission is rejected without a second request',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const f=await localFixture(async(_q,r,b)=>{await wait;writeStatus(r,b.id);});
  try{const first=f.read();await assert.rejects(f.read(),{code:'SAEED_TRANSPORT_BUSY'});release();
    assert.equal((await first).requestClosed,true);assert.equal(f.calls.length,1);}finally{release();await f.close();}
});
test('pre-aborted signal sends no request',async()=>{
  const controller=new AbortController();controller.abort();
  const f=await localFixture((_q,r,b)=>writeStatus(r,b.id));
  try{await assert.rejects(f.read({signal:controller.signal}),{code:'SAEED_TRANSPORT_ABORTED'});assert.equal(f.calls.length,0);}finally{await f.close();}
});
test('abort during request closes it and preserves no-retry behavior',async()=>{
  let entered;const ready=new Promise(resolve=>{entered=resolve;});const controller=new AbortController();
  const f=await localFixture(()=>entered());
  try{const pending=f.read({signal:controller.signal});const rejected=assert.rejects(pending,error=>error.code==='SAEED_TRANSPORT_ABORTED'&&error.requestClosed===true);
    await ready;controller.abort();await rejected;assert.equal(f.calls.length,1);}finally{await f.close();}
});
test('unconfirmed owned close keeps the original failure and latches admission busy',async t=>{
  let calls=0,destroys=0;
  t.mock.method(http,'request',(_options,callback)=>{
    calls++;
    const request=new EventEmitter();
    request.destroy=()=>{destroys++;};
    request.end=()=>queueMicrotask(()=>{const response=new EventEmitter();response.statusCode=503;response.headers={};callback(response);});
    return request;
  });
  const read=createSaeedStatusTransport({port:48831,expectedConfigSha256:configSha256,timeoutMs:100});
  await assert.rejects(read(),error=>error.code==='SAEED_TRANSPORT_HTTP_503'&&error.requestClosed===false
    &&error.secondaryRecords.some(item=>item.code==='SAEED_TRANSPORT_CLOSE_UNCONFIRMED'));
  await assert.rejects(read(),{code:'SAEED_TRANSPORT_BUSY'});
  assert.equal(calls,1);assert.equal(destroys,1);
});
test('unconfigured/scoped port and option limits fail before network access',()=>{
  for(const value of [0,80,1023,65536,-1,48831.5,'48831'])assert.throws(()=>createSaeedStatusTransport({port:value,expectedConfigSha256:configSha256}),{code:'SAEED_TRANSPORT_OPTIONS'});
  for(const options of [{timeoutMs:99},{timeoutMs:10001},{maxBytes:1023},{maxBytes:1048577},
    {expectedConfigSha256:undefined},{expectedConfigSha256:'A'.repeat(64)}])
    assert.throws(()=>createSaeedStatusTransport({port:48831,expectedConfigSha256:configSha256,...options}),{code:'SAEED_TRANSPORT_OPTIONS'});
});
