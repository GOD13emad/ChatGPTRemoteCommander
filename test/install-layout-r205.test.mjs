import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {auditInstalledLayout} from '../tools/audit-install-layout-r205.mjs';
function fixture(fn){const base=fs.mkdtempSync(path.join(os.tmpdir(),'r205-'));try{return fn(base);}finally{fs.rmSync(base,{recursive:true,force:true});}}
function dir(p){fs.mkdirSync(p,{recursive:true});}
test('R205 Windows single current Junction and dormant manifest remain review only',()=>fixture(home=>{
 const local=path.join(home,'Local'),prog=path.join(local,'Programs','Remote Commander Browser');dir(prog);
 const old=path.join(prog,'v0.8.0-old'),current=path.join(prog,'v0.8.1-new');
 for(const p of [old,current]){dir(p);fs.writeFileSync(path.join(p,'product-install.json'),JSON.stringify({product:'Remote Commander Browser',version:path.basename(p).slice(1,6)}));}
 fs.symlinkSync(current,path.join(prog,'current'),'dir');
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
test('R205 Linux active runtime and obsolete-looking sandbox dependency protected',()=>fixture(home=>{
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
 fs.symlinkSync(path.join(home,'outside'),path.join(root,'current'),'dir');
 const a=auditInstalledLayout({home,platform:'win32',localAppData:local,roamingAppData:path.join(home,'Roaming')});
 assert.equal(a.products[0].current.status,'OUTSIDE_INSTALL_ROOT_PROTECTED');
 assert.equal(a.products[0].activeCount,0);
}));
