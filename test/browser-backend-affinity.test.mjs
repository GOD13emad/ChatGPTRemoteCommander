import test from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserBackendRouter} from '../src/browser-tools.mjs';

function backendFixture(){
 const calls=[];
 let failure=null;
 const client=name=>({
  async invoke(request){
   calls.push({name,action:request.action});
   if(request.action==='end'&&name==='firefox'&&failure){
    const kind=failure; failure=null;
    if(kind==='throw')throw Error('BROWSER_HELPER_TIMEOUT');
    if(kind==='unconfirmed')return {ok:true,closed:false};
   }
   if(request.action==='end')return {ok:true,closed:true};
   if(request.action==='start')return {ok:true,browserProduct:name};
   return {ok:true};
  },
  close(){calls.push({name,action:'client.close'})}
 });
 const router=createBrowserBackendRouter({chromiumClient:client('chromium'),firefoxClient:client('firefox')});
 return {router,calls,setFailure:kind=>{failure=kind}};
}
test('failed Firefox end retains Firefox backend for same-helper cleanup retry',async()=>{
 const f=backendFixture();
 await f.router.invoke({action:'start',executable:'/usr/bin/firefox'});
 f.setFailure('throw');
 await assert.rejects(f.router.invoke({action:'end'}),/BROWSER_HELPER_TIMEOUT/);
 assert.equal((await f.router.invoke({action:'end'})).closed,true);
 assert.deepEqual(f.calls.map(x=>x.name+':'+x.action),[
  'firefox:start','firefox:end','firefox:end'
 ]);
});
test('unconfirmed Firefox end does not switch to Chromium',async()=>{
 const f=backendFixture();
 await f.router.invoke({action:'start',executable:'/usr/bin/firefox'});
 f.setFailure('unconfirmed');
 assert.equal((await f.router.invoke({action:'end'})).closed,false);
 assert.equal((await f.router.invoke({action:'end'})).closed,true);
 assert.equal(f.calls.filter(x=>x.action==='end'&&x.name==='chromium').length,0);
});
test('status checks do not mutate active backend; explicit close resets both clients',async()=>{
 const f=backendFixture();
 await f.router.invoke({action:'start',executable:'/usr/bin/firefox'});
 await f.router.invoke({action:'status',executable:'/usr/bin/google-chrome'});
 await f.router.invoke({action:'end'});
 await f.router.invoke({action:'start',executable:'/usr/bin/google-chrome'});
 await f.router.invoke({action:'end'});
 f.router.close();
 assert.deepEqual(f.calls.map(x=>x.name+':'+x.action),[
  'firefox:start','chromium:status','firefox:end',
  'chromium:start','chromium:end','chromium:client.close','firefox:client.close'
 ]);
});
