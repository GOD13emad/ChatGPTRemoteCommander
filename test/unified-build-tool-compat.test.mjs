import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=createRequire(path.join(root,'packaging/unified/package.json'));

test('installed electron-builder legacy glob and dir-compare retain callable minimatch APIs',()=>{
  // This test is intentionally run AFTER packaging/unified npm ci on both CI OSes.
  // Source-only lockfile checks cannot prove the actual Node resolution/API.
  const glob=pkg('glob');
  const compare=pkg('dir-compare');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rc012-build-dep-'));
  try{
    const left=path.join(tmp,'left'),right=path.join(tmp,'right');
    fs.mkdirSync(left);fs.mkdirSync(right);
    fs.writeFileSync(path.join(left,'example.txt'),'value');
    fs.writeFileSync(path.join(right,'example.txt'),'value');
    fs.writeFileSync(path.join(left,'ignored.tmp'),'omit');
    assert.deepEqual(glob.sync('*.txt',{cwd:left}),['example.txt']);
    const result=compare.compareSync(left,right,{
      compareContent:true,excludeFilter:'*.tmp'
    });
    assert.equal(result.same,true);
    assert.equal(result.equalFiles,1);
  }finally{
    fs.rmSync(tmp,{force:true,recursive:true});
  }
});
