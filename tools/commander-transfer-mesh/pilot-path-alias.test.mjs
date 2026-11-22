import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('./pilot-cli.mjs',import.meta.url));
const cases=[
  ['pairs'],['pairs','Linux'],['pairs','Linux','transfers'],
  ['staging'],['staging','Linux']
];

for(const components of cases){
 test('pilot send rejects existing internal symlink at '+components.join('/'),
  {skip:process.platform==='win32'},()=>{
   const base=fs.mkdtempSync(path.join(os.tmpdir(),'ctmesh-pilot-alias-'));
   const home=path.join(base,'home'),outside=path.join(base,'outside');
   try{
    fs.mkdirSync(home);fs.mkdirSync(outside);
    fs.writeFileSync(path.join(home,'node.json'),JSON.stringify({alias:'PC'}));
    const source=path.join(base,'safe.bin');
    fs.writeFileSync(source,'owner-owned test bytes');
    const alias=path.join(home,...components);
    fs.mkdirSync(path.dirname(alias),{recursive:true});
    fs.symlinkSync(outside,alias,'dir');
    const r=spawnSync(process.execPath,[cli,'send','--peer','Linux','--path',source,'--id','alias-escape-001'],{
      encoding:'utf8',timeout:7000,env:{...process.env,COMMANDER_TRANSFER_HOME:home}
    });
    assert.notEqual(r.status,0,'CLI accepted an internal symlink alias');
    assert.match(r.stderr,/TRANSFER_DIRECTORY_UNSAFE/);
    assert.deepEqual(fs.readdirSync(outside),[],'outside-root bytes were modified');
   }finally{
    fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100});
   }
 });
}
