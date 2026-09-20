import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function localDir(v){if(typeof v!=='string'||!path.isAbsolute(v)||/^(?:\\\\|\/\/)/.test(v))throw new Error('WORKFLOW_COPY_LOCAL_DIR');return path.resolve(v);}
function parse(argv){const o={};for(let i=0;i<argv.length;i++){const a=argv[i],v=argv[++i];if(v===undefined)throw new Error('WORKFLOW_COPY_ARGUMENT');if(a==='--source-dir')o.source=localDir(v);else if(a==='--dest-dir')o.dest=localDir(v);else throw new Error('WORKFLOW_COPY_ARGUMENT');}if(!o.source||!o.dest)throw new Error('WORKFLOW_COPY_REQUIRED');return o;}
const a=parse(process.argv.slice(2));fs.mkdirSync(a.dest,{recursive:true});
const source=path.join(a.source,'workflows.sqlite'),dest=path.join(a.dest,'workflows.sqlite');
if(!fs.existsSync(source)){console.log(JSON.stringify({ok:true,present:false,source,dest}));process.exit(0);}
if(fs.existsSync(dest))fs.rmSync(dest,{force:true});
const db=new DatabaseSync(source,{readOnly:true,allowExtension:false});
try{
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('WORKFLOW_COPY_SOURCE_CORRUPT');
 const escaped=dest.replaceAll("'","''");db.exec("VACUUM INTO '"+escaped+"'");
}finally{db.close();}
const verify=new DatabaseSync(dest,{readOnly:true,allowExtension:false});
try{
 const check=verify.prepare('PRAGMA quick_check').get().quick_check;if(check!=='ok')throw new Error('WORKFLOW_COPY_DEST_CORRUPT');
 console.log(JSON.stringify({ok:true,present:true,source,dest,userVersion:verify.prepare('PRAGMA user_version').get().user_version,integrity:check}));
}finally{verify.close();}
