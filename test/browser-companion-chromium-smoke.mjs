// Real Chromium extension end-to-end smoke, using an isolated disposable
// browser context and synthetic, locally fulfilled ChatGPT navigation only.
// No existing user profile, credentials, live ChatGPT content, or tool grants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'packaging/unified/package.json'));
const {createCompanionBridge}=require(path.join(root,'packaging/unified/browser-companion-bridge.cjs'));
const pw=process.env.RC_PLAYWRIGHT_MODULE
  ?require(process.env.RC_PLAYWRIGHT_MODULE)
  :require('playwright-core');
const extension=path.join(root,'packaging/unified/.stage/companion/extensions/chatgpt-companion');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-companion-chromium-'));
const fixtureUrl='https://chatgpt.com/c/11111111-1111-4111-8111-111111111111';
let context=null,bridge=null;
const wait=async(fn,label)=>{
  const until=Date.now()+8000;
  while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,150));}
  throw Error(label);
};
try{
  assert.ok(fs.existsSync(path.join(extension,'manifest.json')),'STAGED_EXTENSION_MISSING');
  assert.ok(fs.existsSync(pw.chromium.executablePath()),'PINNED_CHROMIUM_MISSING');
  bridge=createCompanionBridge();
  await bridge.start();
  context=await pw.chromium.launchPersistentContext(temp,{
    channel:'chromium',headless:false,chromiumSandbox:true,
    args:['--disable-extensions-except='+extension,'--load-extension='+extension],
    timeout:15000
  });
  // Never contact the actual ChatGPT site; this is an isolated fixture.
  await context.route('https://chatgpt.com/**',route=>route.fulfill({
    status:200,contentType:'text/html',body:'<!doctype html><title>Local Companion QA fixture</title><p>synthetic only</p>'
  }));
  let worker=context.serviceWorkers()[0];
  if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:10000});
  const id=new URL(worker.url()).hostname;
  assert.match(id,/^[a-p]{32}$/);
  const popup=await context.newPage();
  await popup.goto('chrome-extension://'+id+'/popup.html');
  await popup.getByText('Not connected',{exact:true}).waitFor({timeout:8000});
  await popup.locator('#code').fill(bridge.newCode().code);
  await popup.locator('#pair').click();
  await popup.getByText('Paired',{exact:true}).waitFor({timeout:8000});
  assert.equal(bridge.status().pairedBrowsers,1);
  const chat=await context.newPage();
  await chat.goto(fixtureUrl);
  await wait(()=>bridge.observe().some(x=>x.phase==='CHAT_OPEN'&&typeof x.localRef==='string'),'CHROMIUM_SYNTHETIC_CHAT_OBSERVATION_MISSING');
  assert.ok(!JSON.stringify(bridge.observe()).includes('11111111-1111-4111-8111-111111111111'));
  await chat.close();
  await wait(()=>bridge.observe().some(x=>x.phase==='NO_CHAT'),'CHROMIUM_TAB_CLOSE_NOT_OBSERVED');
  await popup.locator('#disconnect').click();
  await popup.getByText('Disconnected',{exact:true}).waitFor({timeout:8000});
  assert.equal(bridge.status().pairedBrowsers,0);
  console.log(JSON.stringify({result:'RC012_EXTERNAL_CHROMIUM_COMPANION_PASS',
    actualMv3Worker:true,actualPair:true,syntheticObservation:true,
    tabClose:true,actualRevoke:true,realChatGPTAccountTested:false,
    ownerBrowserProfileChanged:false,coreAuthorityGranted:false}));
}finally{
  try{await context?.close();}finally{
    try{await bridge?.stop();}finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:3});}
  }
}
