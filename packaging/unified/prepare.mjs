import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const dir=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(dir,'../..');
const stage=path.join(dir,'.stage');
const core=path.join(stage,'core');
const runGit=(args)=>execFileSync('git',args,{
  cwd:repo,encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1'},timeout:20000
}).trim();
const head=runGit(['rev-parse','HEAD']);
const tree=runGit(['rev-parse','HEAD^{tree}']);
if(!/^[0-9a-f]{40}$/.test(head)||!/^[0-9a-f]{40}$/.test(tree))
  throw Error('UNIFIED_GIT_SOURCE_INVALID');
const touched=runGit(['status','--porcelain=v1','--','src','tools','assets','vendor','extensions','config.json','package.json']);
if(touched)throw Error('UNIFIED_SOURCE_UNCOMMITTED: '+touched.slice(0,300));
if(fs.existsSync(core)){
  const marker=path.join(core,'source-manifest.json');
  if(!fs.existsSync(marker)||JSON.parse(fs.readFileSync(marker,'utf8')).schema!==1)
    throw Error('UNIFIED_STAGE_UNKNOWN_CONTENT_REFUSED');
  fs.rmSync(core,{recursive:true,force:true});
}
fs.mkdirSync(core,{recursive:true});
const tar=path.join(stage,'committed-core.tar');
if(fs.existsSync(tar))throw Error('UNIFIED_ARCHIVE_PREEXISTS');
try{
  execFileSync('git',['-c','core.autocrlf=false','archive','--format=tar','--output',tar,head,
    'src','tools','vendor','assets','extensions','config.json','package.json'],{
      cwd:repo,timeout:30000,env:{...process.env,GIT_NO_LAZY_FETCH:'1'}
    });
  execFileSync('tar',['-xf',tar,'-C',core],{timeout:30000});
}finally{if(fs.existsSync(tar))fs.rmSync(tar);}
const hash=p=>createHash('sha256').update(fs.readFileSync(path.join(core,p))).digest('hex');
const paths=['src/server-v0.3.mjs','package.json','config.json'];
const manifest={schema:1,head,tree,files:Object.fromEntries(paths.map(p=>[p,hash(p)])),
  packaging:'unified-pilot-no-promotion'};
fs.writeFileSync(path.join(core,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const pkg=JSON.parse(fs.readFileSync(path.join(core,'package.json'),'utf8'));
if(pkg.version!=='0.12.0-dev.1')throw Error('UNIFIED_WRONG_CORE_VERSION');
console.log('UNIFIED_SOURCE_PREPARED',JSON.stringify({head,tree,files:Object.keys(manifest.files),version:pkg.version}));
