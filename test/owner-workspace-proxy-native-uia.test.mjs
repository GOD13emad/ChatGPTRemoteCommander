import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOwnerWorkspaceProxy} from '../src/owner-workspace-proxy.mjs';

const config={ownerWorkspaceDelegation:{enabled:true,port:48838,authFile:'/owner/session/auth.key'}};
const secret='a'.repeat(64);
function fixture(){
 const calls=[];const timeouts=[];
 const proxy=createOwnerWorkspaceProxy({config,timeoutSignal:ms=>{timeouts.push(ms);return new AbortController().signal;},readFileImpl:async()=>secret,
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   return {status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:1,
    result:{structuredContent:{ok:true,mode:'OWNER_NATIVE_UIA',replayed:false}}})};
  }});
 return {proxy,calls,timeouts};
}
test('native UIA observe and mutations are delegated only through authenticated owner loopback broker',async()=>{
 const {proxy,calls,timeouts}=fixture();
 const observe=await proxy.execute('workspace_native_ui_observe',{pid:1234,windowId:9876,application:'brave'});
 assert.equal(observe.handled,true);
 const observed=JSON.parse(calls[0].init.body);
 assert.equal(observed.params.name,'workspace_native_ui_observe');
 assert.deepEqual(observed.params.arguments,{pid:1234,windowId:9876,application:'brave'});
 assert.equal(calls[0].url,'http://127.0.0.1:48838/mcp');
 assert.equal(calls[0].init.headers['x-rc-owner-workspace-auth'],secret);
 assert.equal(calls[0].init.redirect,'error');
 assert.equal(timeouts[0],14000,'owner observation budget must exceed the 11s native process bound');

 const value='private one-off candidate prompt';
 const result=await proxy.execute('workspace_native_ui_set_value',{
  pid:1234,windowId:9876,application:'brave',
  fingerprint:'0123456789abcdef01234567',controlName:'Message ChatGPT',value,
  foregroundChangeAuthorized:false,
  explicitUserAuthorization:'Owner permits a single exact-window UIA value operation'
 },{requestId:'outer-native-value-0001'});
 assert.equal(result.handled,true);
 const forwarded=JSON.parse(calls[1].init.body);
 assert.equal(forwarded.params.name,'workspace_native_ui_set_value');
 assert.equal(forwarded.params.arguments.value,value);
 const expected='owrk-'+createHash('sha256').update('workspace-v1:workspace_native_ui_set_value:outer-native-value-0001').digest('hex').slice(0,48);
 assert.equal(forwarded.params.arguments.requestId,expected);
 assert.equal(forwarded.params.arguments.explicitUserAuthorization.startsWith('Owner'),true);
 assert.equal(calls.length,2);
 assert.equal(timeouts[1],70000,'owner mutation budget must include owner consent and CUA action');
});

test('native UIA invoke is scoped, idempotency-rekeyed and explicit-consent gated',async()=>{
 const {proxy,calls,timeouts}=fixture();
 const args={pid:1234,windowId:9876,application:'brave',
  fingerprint:'0123456789abcdef01234567',controlName:'Send',
  foregroundChangeAuthorized:true,explicitUserAuthorization:'Owner permits one send invocation on the exact Brave window'};
 await assert.rejects(proxy.execute('workspace_native_ui_invoke',args),/WORKSPACE_OWNER_REQUEST_ID_REQUIRED/);
 const {explicitUserAuthorization,...withoutAuthorization}=args;
 await assert.rejects(proxy.execute('workspace_native_ui_invoke',withoutAuthorization,{requestId:'outer-native-send-0001'}),/WORKSPACE_EXPLICIT_AUTHORIZATION_REQUIRED/);
 assert.equal(calls.length,0);
 const result=await proxy.execute('workspace_native_ui_invoke',args,{requestId:'outer-native-send-0001'});
 assert.equal(result.handled,true);
 const forwarded=JSON.parse(calls[0].init.body);
 assert.equal(forwarded.params.name,'workspace_native_ui_invoke');
 assert.equal(forwarded.params.arguments.requestId,'owrk-'+createHash('sha256').update('workspace-v1:workspace_native_ui_invoke:outer-native-send-0001').digest('hex').slice(0,48));
 assert.equal(forwarded.params.arguments.pid,1234);
 assert.equal(forwarded.params.arguments.windowId,9876);
 assert.equal(forwarded.params.arguments.application,'brave');
 assert.equal(timeouts[0],70000,'Invoke owner response budget must include owner consent and CUA action');
 assert.equal(calls[0].init.signal.aborted,false);
});

test('native UIA cannot be forwarded when owner credential or loopback transport fails',async()=>{
 const bad=createOwnerWorkspaceProxy({config,readFileImpl:async()=> 'invalid'});
 await assert.rejects(bad.execute('workspace_native_ui_observe',{pid:1,windowId:2,application:'brave'}),/WORKSPACE_OWNER_CREDENTIAL_INVALID/);
 const unavailable=createOwnerWorkspaceProxy({config,readFileImpl:async()=>secret,
  fetchImpl:async()=>{throw Error('offline');}});
 await assert.rejects(unavailable.execute('workspace_native_ui_set_value',{
  pid:1,windowId:2,application:'brave',fingerprint:'0123456789abcdef01234567',
  controlName:'Message ChatGPT',value:'x',foregroundChangeAuthorized:false,
  explicitUserAuthorization:'Owner permits this exact write'
 },{requestId:'outer-native-failure-0001'}),/WORKSPACE_OWNER_AGENT_UNAVAILABLE/);
});


test('exact-window owner click retains native consent budget and stable request identity',async()=>{
 const {proxy,calls,timeouts}=fixture();
 const args={pid:61388,windowId:2559368,elementToken:'s00000001:11',
  explicitUserAuthorization:'Owner permits opening the current Remote Commander Operations Monitor'};
 const result=await proxy.execute('workspace_window_click',args,{requestId:'rc012-owner-window-click-20261113'});
 assert.equal(result.handled,true);
 assert.equal(timeouts[0],70000,'must not timeout before the native owner consent expires');
 const payload=JSON.parse(calls[0].init.body);
 assert.equal(payload.params.name,'workspace_window_click');
 assert.equal(payload.params.arguments.pid,61388);
 assert.equal(payload.params.arguments.windowId,2559368);
 assert.equal(payload.params.arguments.elementToken,'s00000001:11');
 assert.equal(payload.params.arguments.requestId,'owrk-'+createHash('sha256').update('workspace-v1:workspace_window_click:rc012-owner-window-click-20261113').digest('hex').slice(0,48));
 assert.equal(payload.params.arguments.explicitUserAuthorization,args.explicitUserAuthorization);
});
