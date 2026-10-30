import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {auditInstalledLayout,classifyCoreReleaseUse,windowsCommanderProcessReferences} from '../tools/audit-install-layout-r205.mjs';
function fixture(fn){const base=fs.mkdtempSync(path.join(os.tmpdir(),'r205-'));try{return fn(base);}finally{fs.rmSync(base,{recursive:true,force:true});}}
function dir(p){fs.mkdirSync(p,{recursive:true});}
function makeDirLink(target,link){
 if(process.platform==='win32'){
  const quoted=p=>"'"+p.replaceAll("'","''")+"'";
  const command='New-Item -ItemType Junction -Path '+quoted(link)+' -Target '+quoted(target)+' -ErrorAction Stop | Out-Null';
  execFileSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{stdio:'pipe'});
 }else fs.symlinkSync(target,link,'dir');
}
test('R205 Windows single current Junction and dormant manifest remain review only',()=>fixture(home=>{
 const local=path.join(home,'Local'),prog=path.join(local,'Programs','Remote Commander Browser');dir(prog);
 const old=path.join(prog,'v0.8.0-old'),current=path.join(prog,'v0.8.1-new');
 for(const p of [old,current]){dir(p);fs.writeFileSync(path.join(p,'product-install.json'),JSON.stringify({product:'Remote Commander Browser',version:path.basename(p).slice(1,6)}));}
 makeDirLink(current,path.join(prog,'current'));
 const userdata=path.join(local,'chatgpt-cef-v2');dir(userdata);
 fs.writeFileSync(path.join(userdata,'Local State'),'TOP_SECRET_SENTINEL_NEVER_READ');
 const result=auditInstalledLayout({platform:'win32',home,localAppData:local,roamingAppData:path.join(home,'Roaming')});
 const b=result.products.find(x=>x.kind==='BROWSER_STABLE');
 assert.equal(b.activeCount,1);
 assert.equal(b.versionEntries.find(x=>x.name==='v0.8.0-old').classification,'REVIEW_RETIRED_BINARY_ONLY_NO_DELETE');
 assert.equal(result.protectedData[0].classification,'PROTECTED_USER_DATA_NEVER_AUTO_DELETE');
 assert.equal(JSON.stringify(result).includes('TOP_SECRET_SENTINEL_NEVER_READ'),false);
 assert.equal(result.deletionAuthorized,false);
}));
test('R205 Linux active runtime and obsolete-looking sandbox dependency protected',{skip:process.platform==='win32'},()=>fixture(home=>{
 const browser=path.join(home,'.local','share','chatgpt-cef-v2');
 const old=path.join(browser,'runtime-v0.8.0'),active=path.join(browser,'runtime-v0.8.1');dir(old);dir(active);dir(path.join(browser,'.stage-r77-v0.8.2'));
 const bin=path.join(home,'.local','bin');dir(bin);
 fs.writeFileSync(path.join(bin,'chatgpt-cef-v2'),'RUNTIME='+active+'\nEXPECTED_SANDBOX_REAL='+path.join(old,'chrome-sandbox')+'\n');
 const result=auditInstalledLayout({platform:'linux',home});
 assert.equal(result.browser.entries.find(x=>x.name==='runtime-v0.8.1').classification,'ACTIVE_RUNTIME_KEEP');
 assert.equal(result.browser.entries.find(x=>x.name==='runtime-v0.8.0').classification,'ACTIVE_SANDBOX_DEPENDENCY_KEEP');
 assert.equal(result.browser.entries.find(x=>x.name==='.stage-r77-v0.8.2').classification,'REVIEW_UNREFERENCED_RUNTIME_OR_STAGE_NO_DELETE');
 assert.equal(result.retirementGate.mayDeleteNow,false);
}));
test('R205 unknown or malicious link outside root must fail closed',()=>fixture(home=>{
 const local=path.join(home,'Local'),root=path.join(local,'Programs','Remote Commander');dir(root);dir(path.join(home,'outside'));
 makeDirLink(path.join(home,'outside'),path.join(root,'current'));
 const a=auditInstalledLayout({home,platform:'win32',localAppData:local,roamingAppData:path.join(home,'Roaming')});
 assert.equal(a.products[0].current.status,'OUTSIDE_INSTALL_ROOT_PROTECTED');
 assert.equal(a.products[0].activeCount,0);
}));

test('R205 active legacy Node process blocks retirement even when routing points at newer version',()=>fixture(home=>{
 const root=path.join(home,'releases'),legacy=path.join(root,'v0.11.0-dev.14'),current=path.join(root,'v0.11.0-dev.18');
 dir(legacy);dir(current);
 for(const p of [legacy,current])fs.writeFileSync(path.join(p,'package.json'),JSON.stringify({version:'0.11.0-dev.18'}));
 const routes=[{slots:[{slot:'active',projectRoot:current}]}];
 const cmd='node "'+path.join(legacy,'src','server-v0.3.mjs')+'"';
 const rows=classifyCoreReleaseUse(root,routes,{verified:true,commands:[cmd]});
 const found=rows.find(x=>x.name==='v0.11.0-dev.14');
 assert.equal(found.classification,'ACTIVE_PROCESS_DEPENDENCY_KEEP');
 assert.equal(found.activeNodeReferences,1);
 assert.equal(rows.find(x=>x.name==='v0.11.0-dev.18').classification,'ACTIVE_OR_PREVIOUS_ROUTED_KEEP');
 assert.equal(JSON.stringify(rows).includes('server-v0.3.mjs'),false);
 const unknown=classifyCoreReleaseUse(root,routes,{verified:false,commands:[]});
 assert.equal(unknown.find(x=>x.name==='v0.11.0-dev.14').classification,'PROCESS_USAGE_UNKNOWN_NO_DELETE');
 const clean=classifyCoreReleaseUse(root,routes,{verified:true,commands:[]});
 assert.equal(clean.find(x=>x.name==='v0.11.0-dev.14').classification,'REVIEW_IMMUTABLE_RELEASE_UNREFERENCED_NO_DELETE');
 assert.equal(classifyCoreReleaseUse(root,routes,{verified:true,commands:[cmd.replace('v0.11.0-dev.14','v0.11.0-dev.14-other')]}).find(x=>x.name==='v0.11.0-dev.14').activeNodeReferences,0);
}));
test('R205 native Windows evidence inventory is bounded and never emits process arguments',{skip:process.platform!=='win32'},()=>{
 const calls=[];
 const r=windowsCommanderProcessReferences({exec:(file,args,opts)=>{
  calls.push({file,args,opts});
  return JSON.stringify(['node C:/root/release/src/server.mjs']);
 }});
 assert.equal(r.verified,true);
 assert.equal(r.commands.length,1);
 assert.equal(calls[0].opts.windowsHide,true);
 assert.ok(calls[0].opts.timeout<=6000);
 assert.equal(calls[0].file,'powershell.exe');
});
