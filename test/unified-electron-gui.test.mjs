import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const exe=process.platform==='linux'
  ? '/opt/Remote Commander/remote-commander-unified'
  : path.join(root,'dist','unified','win-unpacked','Remote Commander.exe');
const enabled=(process.platform==='win32' && process.env.RC_TEST_PACKAGED_GUI==='1')
  ||(process.platform==='linux' && process.env.RC_TEST_INSTALLED_GUI==='1');
const require=createRequire(path.join(root,'packaging','unified','package.json'));

test('real packaged GUI: sandboxed renderer and preview Start/Stop, isolated from active Commander',
  {skip:!enabled,timeout:45000},async()=>{
    assert.ok(fs.existsSync(exe),'native OS executable is missing');
    const {_electron}=require('playwright-core');
    const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'rc-unified-e2e-'));
    const launchEnv={...process.env,APPDATA:isolated,XDG_CONFIG_HOME:isolated};
    let app=null;
    try{
      app=await _electron.launch({executablePath:exe,args:[],
        env:launchEnv,timeout:25000});
      const page=await app.firstWindow({timeout:20000});
      assert.match(await page.title(),/Remote Commander/);
      await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('stopped'),
        null,{timeout:12000});
      // Selectable external-browser setup is part of the same native GUI,
      // but this test must never open or modify any host browser profile.
      await page.locator('#companion-browser-target').waitFor({timeout:8000});
      const known=await page.evaluate(()=>window.commander.companionBrowserList());
      assert.deepEqual(known.map(x=>x.id),['chrome','edge','brave','chromium','firefox']);
      assert.ok(known.every(x=>typeof x.installed==='boolean' && !Object.hasOwn(x,'executable')));
      assert.ok(!known.find(x=>x.id==='firefox').supported);
      const before=await page.locator('#status').innerText();
      assert.match(before,/source/);
      assert.match(before,/[0-9a-f]{40}/);
      assert.equal(await page.evaluate(()=>typeof require==='undefined' && typeof process==='undefined'),true,
        'Renderer must not expose Node integration');
      await page.waitForFunction(()=>{
        const t=document.querySelector('#migration')?.textContent||'';
        return t.includes('NO_PROMOTE')||t.includes('LOCAL_PREFLIGHT_UNAVAILABLE');
      },null,{timeout:12000});
      const check=await page.locator('#migration').innerText();
      assert.match(check,/NO_PROMOTE/);
      assert.match(check,/"readOnly": true/);
      assert.doesNotMatch(check,/api[_-]?key|password|bearer/i);
      await page.getByRole('button',{name:'Start isolated preview'}).click();
      await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('running'),
        null,{timeout:18000});
      const running=await page.locator('#result').innerText();
      assert.match(running,/isolated STANDARD loopback/);
      assert.match(running,/"privilegedAccess": false/);
      await page.getByRole('button',{name:'Stop preview'}).click();
      await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('stopped'),
        null,{timeout:12000});
    }finally{
      try{if(app)await app.close();}finally{
        fs.rmSync(isolated,{recursive:true,force:true,maxRetries:8,retryDelay:180});
      }
    }
  });


test('real packaged owned chat window: owner compose/send/answer/reopen on local fixture',
  {skip:!enabled,timeout:75000},async()=>{
    assert.ok(fs.existsSync(exe),'native OS executable is missing');
    const {_electron}=require('playwright-core');
    const isolated=fs.mkdtempSync(path.join(os.tmpdir(),'rc-unified-chat-fixture-'));
    const launchEnv={...process.env,APPDATA:isolated,XDG_CONFIG_HOME:isolated};
    const conversation='/c/11111111-1111-4111-8111-111111111111';
    let app=null;
    try{
      app=await _electron.launch({executablePath:exe,args:['--user-data-dir='+isolated],env:launchEnv,timeout:25000});
      const gui=await app.firstWindow({timeout:20000});
      assert.match(await gui.title(),/Remote Commander/);
      await gui.locator('#chat-open').waitFor({timeout:10000});
      // Test process only: intercept HTTPS in the ACTUAL app-owned partition.
      // Fail closed on all other HTTPS hosts. No production code, account,
      // cookie, API credential, or live ChatGPT response is involved.
      const partition='persist:commander-owned-chat';
      const html=`<!doctype html><title>Commander synthetic chat fixture</title>
      <label for="prompt">Synthetic message</label><textarea id="prompt"></textarea>
      <button id="send">Send fixture</button><p id="answer" role="status"></p>
      <script>
      const answer=document.getElementById('answer');
      const prompt=document.getElementById('prompt');
      answer.textContent=localStorage.getItem('fixtureAnswer')||'';
      document.getElementById('send').addEventListener('click',()=>{
        if(prompt.value!=='Commander QA fixture')return;
        const response='Synthetic answer receipt 012';
        localStorage.setItem('fixtureAnswer',response);
        answer.textContent=response;
        history.pushState({},'', '/c/11111111-1111-4111-8111-111111111111');
        prompt.value='';
      });
      </script>`;
      const actualUserData=await app.evaluate(({app})=>app.getPath('userData'));
      const relative=path.relative(isolated,actualUserData);
      assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative),'Fixture must use a disposable userData root');
      await app.evaluate(({session},{partition,html})=>{
        const ses=session.fromPartition(partition);
        ses.protocol.handle('https',request=>{
          const u=new URL(request.url);
          return new Response(u.origin==='https://chatgpt.com'&&
            (u.pathname==='/'||u.pathname==='/c/11111111-1111-4111-8111-111111111111')?html:'Blocked fixture request',
            {status:u.origin==='https://chatgpt.com'&&(u.pathname==='/'||u.pathname==='/c/11111111-1111-4111-8111-111111111111')?200:403,
              headers:{'Content-Type':'text/html; charset=utf-8'}});
        });
        // Block plain HTTP except the dedicated unprivileged Companion bridge.
        ses.webRequest.onBeforeRequest({urls:['http://*/*']},(details,callback)=>{
          callback({cancel:!details.url.startsWith('http://127.0.0.1:41267/')});
        });
      },{partition,html});
      await gui.locator('#companion-start').click();
      await gui.waitForFunction(()=>document.querySelector('#companion-result')?.textContent?.includes('"listening": true'),
        null,{timeout:10000});
      const next=app.waitForEvent('window',{timeout:15000});
      await gui.locator('#chat-open').click();
      const chat=await next;
      await chat.locator('#prompt').waitFor({timeout:15000});
      assert.equal(new URL(chat.url()).origin,'https://chatgpt.com');
      assert.equal(await chat.evaluate(()=>typeof require==='undefined'&&typeof process==='undefined'&&typeof window.commander==='undefined'),true);
      await chat.getByLabel('Synthetic message').fill('Commander QA fixture');
      await chat.getByRole('button',{name:'Send fixture'}).click();
      await chat.waitForFunction(()=>document.querySelector('#answer')?.textContent==='Synthetic answer receipt 012',
        null,{timeout:8000});
      assert.equal(new URL(chat.url()).pathname,conversation);
      await gui.waitForFunction(async()=>{
        const s=await window.commander.companionStatus();
        return s.ownedBrowser?.phase==='CHAT_OPEN'&&s.ownedBrowser?.chatAuthentication==='NOT_VERIFIED'
          &&s.ownedBrowser?.actionAuthorization===false;
      },null,{timeout:8000});
      // Reload proves the exact isolated conversation's fixture receipt survives.
      await chat.reload();
      await chat.waitForFunction(()=>document.querySelector('#answer')?.textContent==='Synthetic answer receipt 012',
        null,{timeout:8000});
      await chat.close();
      await gui.waitForFunction(async()=>(await window.commander.companionStatus()).ownedBrowser?.phase==='NO_CHAT',
        null,{timeout:8000});
      await gui.locator('#companion-stop').click();
      await gui.waitForFunction(()=>document.querySelector('#companion-result')?.textContent?.includes('"listening": false'),
        null,{timeout:8000});
      console.log('RC012_OWNED_CHAT_FIXTURE_PASS '+JSON.stringify({actualPackagedWindow:true,
        syntheticComposeSendAnswer:true,syntheticReloadReceipt:true,nativeObservation:true,
        realChatGPTAccountTested:false,providerResponseTested:false,coreAuthorityGranted:false}));
    }finally{
      try{if(app)await app.close();}finally{
        fs.rmSync(isolated,{recursive:true,force:true,maxRetries:8,retryDelay:180});
      }
    }
  });
