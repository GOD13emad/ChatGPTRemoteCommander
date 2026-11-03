#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args=process.argv.slice(2);
const opt=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
const need=name=>{const v=opt(name);if(v===null||v==='')throw new Error('MISSING_'+name.replace(/^--/,'').toUpperCase().replaceAll('-','_'));return v;};
const file=path.resolve(need('--file'));
const action=need('--action');

function read(){
  if(!fs.existsSync(file))return {schema:1,items:[],updatedAt:null};
  const j=JSON.parse(fs.readFileSync(file,'utf8'));
  if(j?.schema!==1||!Array.isArray(j.items))throw new Error('RETAINED_BACKENDS_INVALID');
  return j;
}
function write(j){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  j.schema=1;j.updatedAt=new Date().toISOString();
  const tmp=file+`.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp,JSON.stringify(j,null,2)+'\n',{encoding:'utf8',mode:0o600});
  fs.renameSync(tmp,file);
}
const key=x=>`${x.profile}\0${x.port}\0${x.commit}`;
const toPort=v=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>65535)throw new Error('INVALID_PORT');return n;};
const commitOk=v=>/^[0-9a-f]{40}$/i.test(v);

if(action==='add'){
  const item={
    profile:need('--profile'),
    port:toPort(need('--port')),
    version:need('--version'),
    commit:need('--commit'),
    configSha256:need('--config-sha'),
    configPath:path.resolve(need('--config-path')),
    projectDir:path.resolve(need('--project-dir')),
    terminalPids:String(opt('--terminal-pids')??'').split(',').filter(Boolean).map(Number).filter(Number.isInteger),
    retainedAt:new Date().toISOString()
  };
  if(!commitOk(item.commit)||!/^[0-9a-f]{64}$/i.test(item.configSha256))throw new Error('INVALID_IDENTITY');
  const doc=read();const k=key(item);const i=doc.items.findIndex(x=>key(x)===k);
  if(i>=0)doc.items[i]={...doc.items[i],...item,retainedAt:doc.items[i].retainedAt??item.retainedAt};
  else doc.items.push(item);
  write(doc);process.stdout.write(JSON.stringify({ok:true,count:doc.items.length,item})+'\n');
}else if(action==='remove'){
  const profile=need('--profile'),port=toPort(need('--port')),commit=need('--commit');
  const doc=read(),before=doc.items.length;
  doc.items=doc.items.filter(x=>!(x.profile===profile&&Number(x.port)===port&&x.commit===commit));
  if(doc.items.length!==before)write(doc);
  process.stdout.write(JSON.stringify({ok:true,removed:before-doc.items.length,count:doc.items.length})+'\n');
}else if(action==='list-tsv'){
  const doc=read();
  for(const x of doc.items){
    const fields=[x.profile,x.port,x.version,x.commit,x.configSha256,x.configPath,x.projectDir,(x.terminalPids??[]).join(',')];
    if(fields.some(v=>String(v).includes('\t')||String(v).includes('\n')))throw new Error('INVALID_FIELD');
    process.stdout.write(fields.join('\t')+'\n');
  }
}else if(action==='protected-projects'){
  const doc=read();
  for(const x of doc.items)process.stdout.write(path.resolve(x.projectDir)+'\n');
}else{
  throw new Error('UNKNOWN_ACTION');
}
