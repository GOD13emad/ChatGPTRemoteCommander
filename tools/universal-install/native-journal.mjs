// Crash-safe, user-owned one-install-per-host lock and bounded receipt journal.
// Never automatically clears an interrupted native operation or its lock.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const id=/^[a-f0-9]{64}$/;
const finiteString=s=>typeof s==='string'&&s.length<180
  &&!/[\u0000-\u001f\u007f]/.test(s);
const fail=c=>{throw Object.assign(new Error(c),{code:c});};
function ownerRoot(dir){
  if(!path.isAbsolute(dir)||!path.resolve(dir).startsWith(path.resolve(os.homedir())+path.sep))
    fail('UNIVERSAL_NATIVE_JOURNAL_OUTSIDE_OWNER');
  let cur=path.parse(path.resolve(dir)).root;
  for(const part of path.resolve(dir).slice(cur.length).split(path.sep).filter(Boolean)){
    cur=path.join(cur,part);
    if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())
      fail('UNIVERSAL_NATIVE_JOURNAL_ALIAS_REJECTED');
  }
  return path.resolve(dir);
}
export function createNativeFileJournal({
  directory=process.platform==='win32'
    ?path.join(process.env.LOCALAPPDATA||os.homedir(),
      'ChatGPTRemoteCommander','rc-universal-native-journal')
    :path.join(os.homedir(),'.local','state',
      'chatgpt-remote-commander','rc-universal-native-journal')
}={}){
  const root=ownerRoot(directory);
  let lockHandle=null,lockPath=path.join(root,'install.lock'),txn=null,terminal=false;
  function checkLock(){
    if(!lockHandle||!id.test(txn||''))
      fail('UNIVERSAL_NATIVE_JOURNAL_LOCK_REQUIRED');
  }
  return Object.freeze({
    async claim(transactionId){
      if(lockHandle||!id.test(transactionId))
        fail('UNIVERSAL_NATIVE_JOURNAL_INVALID_CLAIM');
      fs.mkdirSync(root,{recursive:true,mode:0o700});
      ownerRoot(root);
      try{lockHandle=fs.openSync(lockPath,'wx',0o600);}
      catch(e){if(e.code==='EEXIST')fail('UNIVERSAL_NATIVE_INSTALL_LOCK_BUSY');throw e;}
      txn=transactionId;
      const bytes=Buffer.from(JSON.stringify({
        schema:'rc-universal-native-lock-v1',transactionId,
        pid:process.pid,openedAt:new Date().toISOString()
      })+'\n');
      try{fs.writeSync(lockHandle,bytes);fs.fsyncSync(lockHandle);}
      catch(e){fs.closeSync(lockHandle);lockHandle=null;throw e;}
    },
    async write(stage,data){
      checkLock();
      if(!/^[A-Z][A-Z_]{2,50}$/.test(stage)||!data||typeof data!=='object')
        fail('UNIVERSAL_NATIVE_JOURNAL_INVALID_STAGE');
      // Never journal full manifests, absolute account paths or authorization.
      const summary=Object.create(null);
      for(const [k,v] of Object.entries(data)){
        if(!['transactionId','action','version','reason'].includes(k)
          ||!finiteString(v))
          fail('UNIVERSAL_NATIVE_JOURNAL_DATA_REJECTED');
        summary[k]=v;
      }
      const line=JSON.stringify({
        schema:'rc-universal-native-event-v1',txn,stage,summary,
        time:new Date().toISOString()
      })+'\n';
      const fd=fs.openSync(path.join(root,'events.jsonl'),'a',0o600);
      try{fs.writeSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(['VERIFIED','ROLLBACK_VERIFIED','NO_CHANGE_VERIFIED'].includes(stage))
        terminal=true;
    },
    async close(){
      if(!lockHandle)return;
      const h=lockHandle;lockHandle=null;
      fs.closeSync(h);
      // After uncertain outcome preserve lock as an explicit recovery gate.
      if(terminal){
        const saved=fs.readFileSync(lockPath,'utf8');
        if(!saved.includes('"transactionId":"'+txn+'"'))
          fail('UNIVERSAL_NATIVE_LOCK_OWNER_DRIFT');
        fs.unlinkSync(lockPath);
      }
    }
  });
}
