import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const argv=process.argv.slice(2);let directory=null;
for(let i=0;i<argv.length;i++){const a=argv[i],v=argv[++i];if(v===undefined)throw new Error('WORKFLOW_FINALIZE_ARGUMENT');if(a==='--directory')directory=v;else throw new Error('WORKFLOW_FINALIZE_ARGUMENT');}
if(typeof directory!=='string'||!path.isAbsolute(directory)||/^(?:\\\\|\/\/)/.test(directory))throw new Error('WORKFLOW_FINALIZE_LOCAL_DIR');
const file=path.join(path.resolve(directory),'workflows.sqlite');
if(!fs.existsSync(file)){console.log(JSON.stringify({ok:true,present:false,userVersion:2}));process.exit(0);}
const db=new DatabaseSync(file,{allowExtension:false});
try{
 db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('WORKFLOW_FINALIZE_CORRUPT');
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
 for(const name of ['workflows','events','scheduler_jobs','operations','root_leases'])if(!tables.has(name))throw new Error('WORKFLOW_FINALIZE_TABLE_MISSING_'+name);
 const before=db.prepare('PRAGMA user_version').get().user_version;
 if(![1,2].includes(before))throw new Error('WORKFLOW_FINALIZE_UNSUPPORTED_VERSION');
 if(before===1){db.exec('BEGIN IMMEDIATE; PRAGMA user_version=2; COMMIT;');}
 const after=db.prepare('PRAGMA user_version').get().user_version;
 if(after!==2||db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('WORKFLOW_FINALIZE_VERIFY_FAIL');
 console.log(JSON.stringify({ok:true,present:true,before,after}));
}finally{db.close();}
