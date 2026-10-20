// Source-only QA: two real Win32 Desktops, each with its own UIA observer worker.
// Explicitly no mouse/keyboard/focus/switch, no user desktop, no ChatGPT identity grant.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,readdir,rm,lstat} from 'node:fs/promises';

const exec=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hostScript=path.join(root,'tools','native-uia-owned-host-win-qa.ps1');
const client=path.join(root,'tools','native-desktop-pipe-client-win-qa.mjs');
const pwsh=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=async file=>JSON.parse(await readFile(file,'utf8'));
async function req(pipe,command){
  const {stdout}=await exec(process.execPath,[client,pipe,command],{
    timeout:6500,windowsHide:true,maxBuffer:5000});
  const reply=JSON.parse(stdout.trim()).reply;
  assert.equal(reply?.ok,true);
  return reply;
}
test('two private Desktop workers use UIA to inspect THEIR OWN Win32 windows',
  {skip:process.platform!=='win32',timeout:49000},async()=>{
    const folder=await mkdtemp(path.join(os.tmpdir(),'rcqa-uia-owned-'));
    const pipe='rc_qa_desk_'+randomBytes(16).toString('hex');
    const host=spawn(pwsh,['-NoLogo','-NoProfile','-NonInteractive',
      '-File',hostScript,'-PipeName',pipe,'-LifetimeMs','42000'],{
       windowsHide:true,stdio:['ignore','pipe','pipe'],
       env:{...process.env,RC_QA_UIA_RECEIPT_DIR:folder}
    });
    let stdout='',stderr='',exited=false;
    const closed=new Promise(resolve=>host.once('close',code=>{exited=true;resolve(code)}));
    host.stdout.on('data',d=>stdout+=d);
    host.stderr.on('data',d=>stderr+=d);
    try{
      const start=Date.now();
      while(!stdout.includes('"ready":true')&&!exited&&Date.now()-start<17500)
        await delay(70);
      assert.equal(exited,false,'QA owned host failed: '+stderr.slice(-1200));
      assert.match(stdout,/"ready":true/);
      const status=await req(pipe,'status');
      assert.equal(status.workers.length,2);
      const [a,b]=status.workers;
      assert.notEqual(a.pid,b.pid);
      assert.notEqual(a.desktop,b.desktop);
      for(const w of [a,b]){
        assert.equal(w.ownWindow,true);
        assert.equal(w.windowCount,1);
        assert.equal(w.effectMode,'observation-only');
        const file=path.join(folder,'uia-'+w.pid+'.json');
        let evidence;
        const deadline=Date.now()+5000;
        while(Date.now()<deadline&&!evidence){
          try{evidence=await read(file)}catch(err){
            if(err.code!=='ENOENT')throw err;
            await delay(75);
          }
        }
        assert.ok(evidence,'NO_IN_DESKTOP_UIA_RECEIPT_'+w.pid+' '+stderr);
        assert.deepEqual(evidence,{
          schema:1,pid:w.pid,titleVerified:true,uiaElementVerified:true,
          effectMode:'observation-only',noPhysicalInput:true
        });
      }
      assert.deepEqual((await readdir(folder)).sort(),
        [a.pid,b.pid].map(pid=>'uia-'+pid+'.json').sort());
      assert.equal((await req(pipe,'shutdown')).stopping,true);
      const result=await Promise.race([closed,delay(7000).then(()=>{throw Error('QA_HOST_NOT_STOPPED')})]);
      assert.equal(result,0,'QA host cleanup: '+stderr.slice(-1200));
    }finally{
      if(!exited){
        host.kill();
        await Promise.race([closed,delay(3500)]).catch(()=>{});
      }
      const stat=await lstat(folder);
      assert.equal(stat.isSymbolicLink(),false);
      assert.equal(stat.isDirectory(),true);
      assert.ok(path.basename(folder).startsWith('rcqa-uia-owned-'));
      await rm(folder,{recursive:true,force:true});
    }
  });
