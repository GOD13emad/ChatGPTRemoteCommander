// Owned localhost acceptance fixture: form QA + slow turn-based farming actions.
// NOT a Hay Day bot, arbitrary website agent, or real-time game controller.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { WorkflowStore, hash } from '../../src/workflow-store.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(repo,'var','browser-r1');
if(fs.existsSync(out)) throw Error('REFUSE_RERUN_EXISTING_BROWSER_EVIDENCE');
fs.mkdirSync(out,{recursive:true});
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Remote Commander acceptance fixture</title><body><h1>Local acceptance fixture</h1><label>Message <input aria-label="Message"></label><button id="apply">Apply</button><p role="status" data-testid="message-result">Empty</p><h2>Turn-based farm fixture</h2><button id="plot">Plant</button><p>Harvest: <span data-testid="score">0</span></p><script>
let planted=false,score=0;document.querySelector('#apply').onclick=()=>{document.querySelector('[data-testid="message-result"]').textContent=document.querySelector('input').value;};document.querySelector('#plot').onclick=()=>{if(planted){score++;document.querySelector('[data-testid="score"]').textContent=String(score);}planted=!planted;document.querySelector('#plot').textContent=planted?'Harvest':'Plant';};</script></body></html>`;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
const options={directory:path.join(out,'memory'),allowedRoots:[out],device:'owned-browser-fixture',configSha256:hash('fixture-r1')};
let browser,context,store;const startedAt=new Date().toISOString();
try{
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:process.env.RC_BROWSER_CHANNEL||'msedge'}:{})});
 context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
 await context.tracing.start({screenshots:true,snapshots:true,sources:false});
 const page=await context.newPage();page.setDefaultTimeout(5000);
 store=new WorkflowStore(options);
 const steps=[['navigate','Open owned fixture'],['fill','Fill Unicode form'],['submit','Submit locally'],['form_check','Assert exact text'],['plant','Plant fixture plot'],['harvest','Harvest fixture plot'],['score_check','Assert one harvest']];
 store.create({id:'browser_acceptance',root:out,goal:'Validate form QA and slow game controls with durable receipts',acceptance:['exact Unicode readback','exact harvest score','checkpoint survives new store instance'],steps:steps.map(([id,title])=>({id,title}))});
 const operations={
  navigate:async()=>{await page.goto(origin,{waitUntil:'domcontentloaded'});await page.screenshot({path:path.join(out,'before.png')});return{ok:true};},
  fill:async()=>{await page.getByRole('textbox',{name:'Message',exact:true}).fill('سلام_日本語_123');return{ok:true};},
  submit:async()=>{await page.getByRole('button',{name:'Apply',exact:true}).click();return{ok:true};},
  form_check:async()=>{await expect(page.getByTestId('message-result')).toHaveText('سلام_日本語_123');return{ok:true};},
  plant:async()=>{await page.getByRole('button',{name:'Plant',exact:true}).click();return{ok:true};},
  harvest:async()=>{await page.getByRole('button',{name:'Harvest',exact:true}).click();return{ok:true};},
  score_check:async()=>{await expect(page.getByTestId('score')).toHaveText('1');await page.screenshot({path:path.join(out,'after.png')});return{ok:true};}
 };
 for(const [stepId] of steps){const revision=store.get('browser_acceptance').state.revision;const r=await store.call({id:'browser_acceptance',stepId,expectedRevision:revision,tool:'browser_fixture',arguments:{stepId}}, {validate:async()=>{},dispatch:operations[stepId]});if(r.outcome!=='RECORDED_NOT_VALIDATED')throw Error('FIXTURE_STEP_UNCERTAIN_'+stepId);}
 await context.tracing.stop({path:path.join(out,'trace.zip')});
 const proof={startedAt,finishedAt:new Date().toISOString(),browser:browser.version(),playwright:'1.63.0',unicodeReadback:await page.getByTestId('message-result').textContent(),harvestScore:await page.getByTestId('score').textContent(),stepCount:7,scope:'owned localhost fixture only; not commercial game acceptance'};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2));
 store.checkpoint({id:'browser_acceptance',expectedRevision:store.get('browser_acceptance').state.revision,files:['result.json','before.png','after.png','trace.zip'],nextAction:'Independent review of fixture results; production adapters remain gated',summary:'Seven observed actions; no external service or account used'});
 const exported=store.export('browser_acceptance');fs.writeFileSync(path.join(out,'workflow-export.json'),JSON.stringify(exported,null,2));
 store.close();store=new WorkflowStore(options);const resumed=store.resume('browser_acceptance');if(resumed.blockers.length)throw Error('REOPEN_NOT_CLEAN');
 console.log(JSON.stringify({status:'BROWSER_FIXTURE_PASS',...proof,checkpointReopened:true,evidenceFiles:resumed.evidence.length,fullAgentAcceptance:false}));
}catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({status:'UNPROVEN',error:e.message},null,2));throw e;}
finally{store?.close();await context?.close();await browser?.close();await new Promise(r=>server.close(r));}
