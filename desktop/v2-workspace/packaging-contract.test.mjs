import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const sha=name=>createHash('sha256').update(fs.readFileSync(name)).digest('hex');
const entries=[
 'server.mjs','desktop-app.mjs','local-evidence.mjs','owner-seat-evidence.mjs',
 'workflow-view.mjs','transport-evidence.mjs','owner-diagnostic-reader.mjs',
 'v1-runtime-bridge.mjs','continuation-handoff.mjs','local-model-evidence.mjs',
 'app.js','app.css','index.html','README.md'
];
test('both OS installers and bundle carry complete local runtime module imports',()=>{
 const runtime=new Set(['server.mjs','desktop-app.mjs']);
 for(const name of [...runtime]){
  const text=read(name);
  for(const m of text.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+\.mjs)['"]/g))
    runtime.add(m[1]);
 }
 assert.deepEqual([...runtime].sort(),entries.filter(x=>x.endsWith('.mjs')).sort());
 const linux=read('install-user-linux.sh');
 const windows=read('install-user-windows.ps1');
 const builder=read('build-preview.ps1');
 for(const name of entries){
  assert.equal(fs.existsSync(path.join(dir,name)),true,name);
  assert.ok(builder.includes("'"+name+"'"),'bundle missing '+name);
  assert.ok(windows.includes("'"+name+"'"),'Windows installer missing '+name);
  assert.ok(linux.includes(name),'Linux installer missing '+name);
 }
 assert.ok(builder.includes("'upgrade-r18.mjs'"),'R18 reversible upgrade missing from bundle');
 assert.ok(!builder.includes("'upgrade-user.mjs'"),'old historical upgrader in active bundle');
});
test('Linux package install, idempotent re-install and live imported server are owner-local',async t=>{
 if(process.platform!=='linux')return t.skip('Linux-specific');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-owner-bundle-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source');const home=path.join(root,'home');
 fs.mkdirSync(source,{mode:0o700});fs.mkdirSync(home,{mode:0o700});
 const files=entries.map(name=>({path:name,sha256:sha(path.join(dir,name))}));
 for(const name of entries)fs.copyFileSync(path.join(dir,name),path.join(source,name));
 fs.copyFileSync(path.join(dir,'install-user-linux.sh'),path.join(source,'install-user-linux.sh'));
 fs.writeFileSync(path.join(source,'MANIFEST.json'),JSON.stringify({mode:'LOCAL_GUI_PREVIEW_NO_PROMOTION',files}));
 const install=()=>spawnSync('bash',[path.join(source,'install-user-linux.sh')],{
  encoding:'utf8',timeout:10000,env:{...process.env,HOME:home}
 });
 const result=install();
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/USER_INSTALL_VERIFIED=/);
 assert.equal(install().status,0,'same-content reinstall must be no-op');
 const dest=path.join(home,'.local','share','CommanderV2','WorkspacePreview');
 for(const name of entries)assert.equal(sha(path.join(dest,name)),sha(path.join(source,name)),name);
 const {createWorkspace}=await import(pathToFileURL(path.join(dest,'server.mjs')).href);
 const workspace=await createWorkspace({port:0,coreUrl:''});
 try{
  const url='http://127.0.0.1:'+workspace.port;
  assert.equal((await fetch(url+'/')).status,200);
  assert.equal((await fetch(url+'/api/v1-project')).status,403);
 }finally{await new Promise(resolve=>workspace.server.close(resolve));}
 fs.appendFileSync(path.join(source,'v1-runtime-bridge.mjs'),'\n// changed source');
 const negative=install();
 assert.notEqual(negative.status,0);
 assert.match(negative.stderr,/MANIFEST_HASH_INVALID/);
 assert.equal(sha(path.join(dest,'v1-runtime-bridge.mjs')),files.find(x=>x.path==='v1-runtime-bridge.mjs').sha256);
});
