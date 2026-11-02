// Isolated visual QA only: starts ephemeral read-only UI, captures a fresh headless browser,
// closes it and removes its disposable profile. Never uses an owner's browser profile.
import { createWorkspace } from './server.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const browser = process.argv[2];
const imagePath = process.argv[3];
if (!browser || !imagePath) throw new Error('Usage: node visual-qa.mjs <browser-bin> <screenshot-path>');
const profile=await mkdtemp(join(tmpdir(),'commander-v2-headless-qa-'));
const app=await createWorkspace({ port:0, coreUrl:'' });
try {
  const args=['--headless=new','--disable-extensions','--no-first-run','--no-default-browser-check',
    '--disable-background-mode','--user-data-dir='+profile,'--window-size=1600,1000',
    '--virtual-time-budget=2800','--screenshot='+imagePath,app.url];
  const outcome=await new Promise((resolve,reject)=>{
    const p=spawn(browser,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
    let stderr='';
    p.stderr.on('data',d=>{stderr+=d.toString().slice(0,1000);});
    p.on('error',reject);
    p.on('exit',(code)=>resolve({code,stderr:stderr.slice(-800)}));
  });
  if (outcome.code!==0) throw new Error('HEADLESS_BROWSER_EXIT '+JSON.stringify(outcome));
  let image;
  try { image=await stat(imagePath); }
  catch(error) { throw new Error('SCREENSHOT_NOT_CREATED '+JSON.stringify(outcome)+' '+error.code); }
  if (image.size<5000) throw new Error('SCREENSHOT_TOO_SMALL '+image.size);
  process.stdout.write(JSON.stringify({status:'SCREENSHOT_CREATED',bytes:image.size,exitCode:outcome.code,viewport:'1600x1000'})+'\n');
} finally {
  await new Promise(resolve=>app.server.close(resolve));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
