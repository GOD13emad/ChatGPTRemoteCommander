import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const helper=path.join(root,'tools','verify-browser-setup-digest.ps1');
const compiler=fs.readFileSync(path.join(root,'installer','build-setup.ps1'),'utf8');

test('Windows setup revalidates exact BrowserSetup catalog identity before and after compilation',()=>{
  assert.match(compiler,/verify-browser-setup-digest\.ps1/);
  assert.equal((compiler.match(/-File \$BrowserVerifier/g)||[]).length,2);
  assert.match(compiler,/BROWSER_CATALOG_PIN_VERIFICATION_FAILED/);
  assert.match(compiler,/BROWSER_CATALOG_PIN_CHANGED_DURING_BUILD/);
  assert.match(compiler,/BrowserSha=\[string\]\$verified\[0\]/);
  assert.match(compiler,/\/DBrowserSetupSHA256=/);
});

test('Inno [Run] extracts a dontcopy Browser payload and validates its actual bytes before execution',()=>{
  const iss=fs.readFileSync(path.join(root,'installer','RemoteCommander.iss'),'utf8');
  assert.match(iss,/#error BROWSER_SETUP_EXACT_DIGEST_REQUIRED/);
  assert.match(iss,/Source: "\{#BrowserSetup\}".*Flags: dontcopy/);
  assert.match(iss,/Filename: "\{tmp\}\\\{#BrowserSetupName\}".*Check: ShouldInstallBundledBrowser/);
  const functionStart=iss.indexOf('function ShouldInstallBundledBrowser(): Boolean;');
  const functionEnd=iss.indexOf('end;',functionStart);
  assert.ok(functionStart>=0 && functionEnd>functionStart);
  const functionBody=iss.slice(functionStart,functionEnd);
  assert.match(functionBody,/ExtractTemporaryFile\('\{#BrowserSetupName\}'\)/);
  assert.match(functionBody,/GetSHA256OfFile\(BrowserPath\)/);
  assert.match(functionBody,/CompareText\(ActualSha, '\{#BrowserSetupSHA256\}'\)/);
  assert.match(functionBody,/BROWSER_PAYLOAD_EXTRACTED_SHA256_MISMATCH/);
});

const available=spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{
  encoding:'utf8',timeout:5000,windowsHide:true
});
test('pinned BrowserSetup verifier accepts exact bytes and rejects mismatch, drift and invalid catalog', {
  skip:available.error?.code==='ENOENT'?'pwsh unavailable on this OS':false
},()=>{
  assert.equal(available.status,0,available.stderr);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc-browser-pin-'));
  try{
    const file=path.join(tmp,'BrowserSetup.exe');
    const manifest=path.join(tmp,'products.json');
    const bytes=Buffer.from('Synthetic browser installer fixture: never execute this file.');
    fs.writeFileSync(file,bytes);
    const pinned=createHash('sha256').update(bytes).digest('hex');
    const data=JSON.parse(fs.readFileSync(path.join(root,'installer','products.json'),'utf8'));
    const browser=data.products.find(x=>x.id==='browser');
    assert.ok(browser);
    browser.platforms.windows.sha256=pinned;
    fs.writeFileSync(manifest,JSON.stringify(data));
    function verify(target=file){
      return spawnSync('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-File',helper,
        '-BrowserInstaller',target,'-CatalogPath',manifest],
      {encoding:'utf8',timeout:8000,windowsHide:true});
    }
    let result=verify();
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),pinned);
    fs.writeFileSync(file,Buffer.from('Changed untrusted BrowserSetup bytes'));
    result=verify();
    assert.notEqual(result.status,0,'mismatched browser bytes must fail');
    assert.match(result.stderr+result.stdout,/BROWSER_PIN_SHA256_MISMATCH/);
    result=verify(path.join(tmp,'missing.exe'));
    assert.notEqual(result.status,0,'missing BrowserSetup must fail');
    result=verify(path.join(tmp,'products.json'));
    assert.notEqual(result.status,0,'non-exe BrowserSetup must fail');
    fs.writeFileSync(file,bytes);
    browser.platforms.windows.sha256='0'.repeat(64);
    fs.writeFileSync(manifest,JSON.stringify(data));
    result=verify();
    assert.notEqual(result.status,0,'wrong catalog pin must fail');
    browser.platforms.windows.sha256='invalid';
    fs.writeFileSync(manifest,JSON.stringify(data));
    result=verify();
    assert.notEqual(result.status,0,'malformed catalog pin must fail');
    browser.platforms.windows.sha256=pinned;
    data.products.push(structuredClone(browser));
    fs.writeFileSync(manifest,JSON.stringify(data));
    result=verify();
    assert.notEqual(result.status,0,'ambiguous Browser catalog must fail');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
