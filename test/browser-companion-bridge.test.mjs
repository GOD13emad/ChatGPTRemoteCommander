import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {observationFromUrl,chatFromUrl} from '../extensions/chatgpt-companion/protocol.js';
const require=createRequire(import.meta.url);
const {createCompanionBridge}=require('../packaging/unified/browser-companion-bridge.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const chromium='chrome-extension://'+'a'.repeat(32),chromium2='chrome-extension://'+'b'.repeat(32);
const chatId='11111111-1111-4111-8111-111111111111';
const post=(port,origin,route,body={},token='')=>new Promise((resolve,reject)=>{
  const payload=JSON.stringify(body);
  const req=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',timeout:2500,headers:{
    Host:'127.0.0.1:'+port,Origin:origin,'Content-Type':'application/json',
    'Content-Length':Buffer.byteLength(payload),...(token?{'Authorization':'Bearer '+token}:{})
  }},res=>{
    let raw='';res.setEncoding('utf8');
    res.on('data',x=>{raw+=x;});
    res.on('end',()=>{
      let data;try{data=JSON.parse(raw);}catch{data=null;}
      resolve({status:res.statusCode,data,headers:res.headers});
    });
  });
  req.on('timeout',()=>req.destroy(Error('TIMEOUT')));
  req.on('error',reject);req.end(payload);
});

test('Companion is explicitly paired to exact extension origin and can revoke',async t=>{
  const bridge=createCompanionBridge({port:0});
  await bridge.start();t.after(()=>bridge.stop());
  const {port}=bridge.status(),code=bridge.newCode().code;
  assert.equal((await post(port,'https://chatgpt.com','/pair',{code})).status,403);
  assert.equal((await post(port,chromium,'/pair',{code:'0000000000000000'})).status,403);
  const joined=await post(port,chromium,'/pair',{code});
  assert.equal(joined.status,200);
  assert.equal(joined.data.app,'REMOTE_COMMANDER_CHAT_COMPANION');
  const token=joined.data.token;
  assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal((await post(port,chromium,'/pair',{code})).status,403); // one-time
  assert.equal((await post(port,chromium2,'/observation',{schema:1,phase:'CHAT_OTHER'},token)).status,403);
  const observation={schema:1,phase:'CHAT_OPEN',conversationId:chatId};
  const accepted=await post(port,chromium,'/observation',observation,token);
  assert.equal(accepted.status,200);
  assert.equal(accepted.data.receipt,1);
  assert.equal(bridge.observe().length,1);
  assert.equal(bridge.observe()[0].phase,'CHAT_OPEN');
  assert.match(bridge.observe()[0].localRef,/^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(bridge.observe()).includes(chatId)); // raw chat ID not retained
  assert.equal((await post(port,chromium,'/observation',{schema:1,phase:'CHAT_OTHER'},token)).status,200);
  assert.equal(bridge.observe()[0].localRef,null);
  assert.equal((await post(port,chromium,'/revoke',{},token)).status,200);
  assert.equal(bridge.status().pairedBrowsers,0);
  assert.equal((await post(port,chromium,'/observation',observation,token)).status,403);
});
test('Bad JSON schema, non-extension origins and unpaired clients always fail closed',async t=>{
  const bridge=createCompanionBridge({port:0});await bridge.start();t.after(()=>bridge.stop());
  const port=bridge.status().port;
  const token=(await post(port,chromium,'/pair',{code:bridge.newCode().code})).data.token;
  for(const body of [
    {schema:2,phase:'CHAT_OPEN',conversationId:chatId},
    {schema:1,phase:'CHAT_OPEN',conversationId:'javascript:alert(1)'},
    {schema:1,phase:'NO_CHAT',conversationId:chatId},
    {schema:1,phase:'INVALID'},
  ])assert.equal((await post(port,chromium,'/observation',body,token)).status,400);
  assert.equal((await post(port,'null','/observation',{schema:1,phase:'NO_CHAT'},token)).status,403);
  assert.equal((await post(port,'https://bad.example','/revoke',{},token)).status,403);
  assert.equal((await post(port,chromium,'/health',{},token)).status,404);
  assert.equal((await post(port,chromium,'/observation',{schema:1,phase:'NO_CHAT'})).status,401);
  assert.equal(bridge.status().observationsReceived,0);
});
test('Bridge pairing is short-lived and cannot be silently replayed',async t=>{
  let now=1000;
  const bridge=createCompanionBridge({port:0,now:()=>now,maxClients:1});await bridge.start();t.after(()=>bridge.stop());
  const port=bridge.status().port,code=bridge.newCode().code;
  now+=300001;
  assert.equal((await post(port,chromium,'/pair',{code})).status,403);
  const fresh=bridge.newCode().code;
  assert.equal((await post(port,chromium,'/pair',{code:fresh})).status,200);
  assert.equal((await post(port,chromium2,'/pair',{code:bridge.newCode().code})).status,409);
  assert.equal(bridge.status().pairedBrowsers,1);
});
test('Only exact ChatGPT hosts and canonical conversation URLs become observations',()=>{
  assert.equal(chatFromUrl('https://chatgpt.com/c/'+chatId),chatId);
  assert.equal(chatFromUrl('https://chatgpt.com/g/g-xyz/c/'+chatId),chatId);
  for(const url of [
    'https://chatgpt.com.evil.example/c/'+chatId,
    'http://chatgpt.com/c/'+chatId,
    'https://chatgpt.com:8443/c/'+chatId,
    'https://bad@chatgpt.com/c/'+chatId,
    'https://chatgpt.com/c/../../admin',
    'https://chatgpt.com/c/not-a-uuid'
  ])assert.equal(chatFromUrl(url),null);
  assert.deepEqual(observationFromUrl('https://chatgpt.com/'),{schema:1,phase:'CHAT_OTHER'});
});
test('Owned Browser Core observes only ChatGPT URL state without extension credentials',async t=>{
  const bridge=createCompanionBridge({port:0});
  await bridge.start();t.after(()=>bridge.stop());
  assert.equal(bridge.observeOwned('https://chatgpt.com/c/'+chatId).phase,'CHAT_OPEN');
  const state=bridge.status().ownedBrowser;
  assert.equal(state.actionAuthorization,false);
  assert.equal(state.chatAuthentication,'NOT_VERIFIED');
  assert.match(state.localRef,/^[a-f0-9]{32}$/);
  assert.ok(!JSON.stringify(state).includes(chatId));
  assert.equal(bridge.observeOwned('https://accounts.google.com/').phase,'NO_CHAT');
  assert.equal(bridge.status().ownedBrowser.localRef,null);
});
test('No broad browser permissions and embedded archive includes the companion',()=>{
  const file=p=>fs.readFileSync(path.join(root,p),'utf8');
  const manifest=JSON.parse(file('extensions/chatgpt-companion/manifest.json'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['storage']);
  assert.deepEqual(manifest.host_permissions,['http://127.0.0.1:41267/*']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://chatgpt.com/*','https://chat.openai.com/*']);
  assert.ok(!JSON.stringify(manifest).includes('debugger'));
  const prep=file('packaging/unified/prepare.mjs');
  assert.match(prep,/'src','tools','vendor','assets','config.json','package.json'/);
  assert.doesNotMatch(prep,/'assets','extensions','config.json'/);
  assert.match(prep,/OPTIONAL_COMPANION_STAGED/);
  assert.match(file('packaging/unified/electron-builder.yml'),/from: \.stage\/companion/);
  assert.match(file('packaging/unified/electron-builder.yml'),/browser-companion-bridge.cjs/);
  assert.match(file('packaging/unified/main.cjs'),/partition='persist:commander-owned-chat'/);
  assert.match(file('packaging/unified/main.cjs'),/session\.fromPartition\(partition\)/);
  assert.ok(fs.statSync(path.join(root,'extensions/chatgpt-companion/popup.html')).size>100);
});

test('MV3 worker mock enforces content/popup separation and never exposes pairing token to ChatGPT',async t=>{
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;});
  const id='a'.repeat(32),stores={},requests=[];
  let listener=null;
  globalThis.chrome={
    runtime:{id,onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}}},
    storage:{local:{
      async get(key){return {[key]:stores[key]};},
      async set(obj){Object.assign(stores,obj);},
      async remove(key){delete stores[key];}
    }}
  };
  globalThis.fetch=async(url,opts)=>{
    requests.push({url,body:JSON.parse(opts.body),headers:opts.headers});
    if(url.endsWith('/pair'))return {ok:true,async json(){return {
      ok:true,app:'REMOTE_COMMANDER_CHAT_COMPANION',token:'b'.repeat(64)
    };}};
    return {ok:true,async json(){return {ok:true,receipt:1};}};
  };
  await import('../extensions/chatgpt-companion/background.js?qa-protocol-v1');
  assert.equal(typeof listener,'function');
  const send=(m,sender)=>new Promise(resolve=>listener(m,sender,resolve));
  const popup={id},page={id,tab:{id:5},url:'https://chatgpt.com/c/'+chatId};
  assert.equal((await send({kind:'STATUS'},popup)).paired,false);
  assert.equal((await send({kind:'PAIR',code:'A'.repeat(16)},page)).error,'POPUP_ONLY');
  assert.equal((await send({kind:'PAIR',code:'A'.repeat(16)},popup)).paired,true);
  assert.equal(stores.commanderPairToken,'b'.repeat(64));
  assert.equal((await send({kind:'CHAT_URL'},page)).ok,true);
  const observed=requests.filter(x=>x.url.endsWith('/observation'));
  assert.equal(observed.length,1);
  assert.equal(observed[0].body.conversationId,chatId);
  assert.equal(observed[0].headers.Authorization,'Bearer '+'b'.repeat(64));
  assert.ok(!JSON.stringify(observed[0].body).includes('messageText'));
  assert.ok(!(await send({kind:'CHAT_URL'},{id,tab:{id:6},url:'https://evil.example/'})).ok);
  assert.equal((await send({kind:'DISCONNECT'},popup)).paired,false);
  assert.equal(stores.commanderPairToken,undefined);
  assert.ok(requests.some(x=>x.url.endsWith('/revoke')));
});
