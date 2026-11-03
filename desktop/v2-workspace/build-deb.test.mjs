import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const archive=path.join(dir,'build-deb.sh');
const manifestHash=sha=>createHash('sha256').update(sha).digest('hex');
function shell(args){
 const result=spawnSync(args[0],args.slice(1),{encoding:'utf8',timeout:12000});
 return {...result,output:(result.stdout||'')+'\n'+(result.stderr||'')};
}
test('Native Linux DEB builds from only validated owner-local preview and preserves exact runtime bytes',async t=>{
 if(process.platform!=='linux')return t.skip('Native Debian builder only');
 if(shell(['dpkg-deb','--version']).status!==0)return t.skip('dpkg-deb missing');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-r18-deb-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const zip=path.join(root,'source.zip'),deb=path.join(root,'preview.deb'),extracted=path.join(root,'extracted');
 const b=shell(['python3',path.join(dir,'build-preview.py'),'--output',zip]);
 assert.equal(b.status,0,b.output);
 const z=JSON.parse(b.stdout);
 assert.equal(z.files,21);
 const output=shell(['bash',archive,zip,z.sha256,deb]);
 assert.equal(output.status,0,output.output);
 assert.match(output.stdout,/V2_R18_NATIVE_QA_DEB/);
 assert.equal(shell(['dpkg-deb','--field',deb,'Package']).stdout.trim(),'commander-v2-workspace-preview');
 assert.equal(shell(['dpkg-deb','--field',deb,'Architecture']).stdout.trim(),'all');
 assert.equal(shell(['dpkg-deb','--field',deb,'Version']).stdout.trim(),'0.18.0~qa20261103');
 assert.match(shell(['dpkg-deb','--field',deb,'Depends']).stdout,/nodejs \(>= 22\)/);
 assert.equal(shell(['dpkg-deb','--extract',deb,extracted]).status,0);
 const base=path.join(extracted,'usr/lib/commander-v2-workspace-preview');
 for(const name of ['server.mjs','app.js','index.html','local-model-evidence.mjs','upgrade-r18.mjs']){
   assert.equal(manifestHash(fs.readFileSync(path.join(base,name))),
     manifestHash(fs.readFileSync(path.join(dir,name))),name);
   assert.equal(fs.statSync(path.join(base,name)).mode&0o777,0o644);
 }
 const launcher=path.join(extracted,'usr/bin/commander-v2-workspace-preview');
 assert.equal(fs.statSync(launcher).mode&0o777,0o755);
 assert.match(fs.readFileSync(launcher,'utf8'),/desktop-app\.mjs/);
 assert.match(fs.readFileSync(path.join(extracted,'usr/share/applications/io.github.god13emad.commander-v2-workspace.desktop'),'utf8'),/Exec=commander-v2-workspace-preview/);
 const {createWorkspace}=await import(pathToFileURL(path.join(base,'server.mjs')).href);
 const workspace=await createWorkspace({port:0,coreUrl:''});
 try{
   const url='http://127.0.0.1:'+workspace.port;
   assert.equal((await fetch(url+'/')).status,200);
   assert.equal((await fetch(url+'/api/local-ai')).status,403);
   const response=await fetch(url+'/api/local-ai',{headers:{'X-Commander-Workspace-Token':workspace.token}});
   assert.equal(response.status,200);
   assert.equal((await response.json()).workerEffectVerified,false);
 }finally{await new Promise(r=>workspace.server.close(r));}
 assert.equal(shell(['bash',archive,zip,z.sha256,deb]).status,3,'must refuse overwriting a package');
 assert.equal(shell(['bash',archive,zip,'0'.repeat(64),path.join(root,'reject.deb')]).status,2);
 assert.equal(fs.existsSync(path.join(root,'reject.deb')),false);
});
