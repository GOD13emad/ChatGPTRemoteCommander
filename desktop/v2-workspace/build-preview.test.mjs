import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const sha=data=>createHash('sha256').update(data).digest('hex');
const python=(args,opts={})=>spawnSync('python3',args,{encoding:'utf8',timeout:20000,...opts});
test('Linux builder creates two byte-identical verified portable preview ZIPs',t=>{
 if(process.platform!=='linux')return t.skip('Linux builder only');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'v2-workspace-zip-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const builder=path.join(here,'build-preview.py');
 const a=path.join(root,'a.zip'),b=path.join(root,'b.zip');
 for(const output of [a,b]){
   const result=python([builder,'--output',output]);
   assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
   const contract=JSON.parse(result.stdout);
   assert.equal(contract.status,'QA_ZIP_BUILT_NOT_INSTALLED');
   assert.equal(contract.files,21);
   assert.equal(contract.mode,'LOCAL_GUI_PREVIEW_NO_PROMOTION');
   assert.equal(contract.sha256,sha(fs.readFileSync(output)));
 }
 assert.equal(sha(fs.readFileSync(a)),sha(fs.readFileSync(b)));
 const deny=python([builder,'--output',a]);
 assert.equal(deny.status,2);
 assert.match(deny.stderr,/OUTPUT_EXISTS/);
 const extracted=path.join(root,'unpacked');
 fs.mkdirSync(extracted,{mode:0o700});
 const verify=python(['-c',String.raw`
import hashlib,json,pathlib,sys,zipfile
z=zipfile.ZipFile(sys.argv[1]); dest=pathlib.Path(sys.argv[2])
names=z.namelist(); manifest=json.loads(z.read('MANIFEST.json'))
assert len(names)==22 and len(set(names))==len(names)
assert manifest['mode']=='LOCAL_GUI_PREVIEW_NO_PROMOTION'
assert {f['path'] for f in manifest['files']}==set(names)-{'MANIFEST.json'}
for f in manifest['files']:
 n=f['path']; b=z.read(n)
 assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256']
 assert '/' not in n and '..' not in n
 (dest/n).write_bytes(b)
(dest/'MANIFEST.json').write_bytes(z.read('MANIFEST.json'))
print('EXTRACTED_PACKAGE_VALID')
`,a,extracted]);
 assert.equal(verify.status,0,verify.stderr+verify.stdout);
 const home=path.join(root,'test-home'); fs.mkdirSync(home,{mode:0o700});
 const install=spawnSync('bash',[path.join(extracted,'install-user-linux.sh')],{
    encoding:'utf8',timeout:10000,env:{...process.env,HOME:home}
 });
 assert.equal(install.status,0,install.stdout+'\n'+install.stderr);
 assert.match(install.stdout,/USER_INSTALL_VERIFIED/);
 assert.equal(fs.existsSync(path.join(home,'.local/share/CommanderV2/WorkspacePreview/v1-runtime-bridge.mjs')),true);
});
