#!/usr/bin/env node
// CT Mesh pilot CLI - the transfer transport is the official Syncthing daemon.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
const root=path.resolve(process.env.COMMANDER_TRANSFER_HOME || (process.platform==='win32'
 ?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'CommanderTransferPilot')
 :path.join(os.homedir(),'.local','share','commander-transfer-pilot')));
const args=process.argv.slice(2),cmd=args.shift();
const arg=(k,fallback)=>{const i=args.indexOf('--'+k);if(i<0)return fallback;if(i===args.length-1)throw Error('Missing value '+k);return args[i+1];};
const validAlias=/^(PC|Linux|EmadServer|Amirreza)$/;
const validId=/^[A-Za-z0-9][A-Za-z0-9._-]{2,90}$/;
const fail=(m)=>{throw Error(m);};
const json=(o)=>process.stdout.write(JSON.stringify(o)+'\n');
function hash(file){let h=crypto.createHash('sha256'),b=Buffer.allocUnsafe(1048576),fd=fs.openSync(file,'r');
 try{for(;;){const n=fs.readSync(fd,b,0,b.length,null);if(!n)break;h.update(b.subarray(0,n));}}
 finally{fs.closeSync(fd);}return h.digest('hex');}
function transferPaths(peer,self,id){
 if(!validAlias.test(peer)||peer===self)fail('Unknown or self peer');
 if(!validId.test(id))fail('Invalid transfer ID');
 const dir=path.join(root,'pairs',peer,'transfers',id);
 return {dir,payload:path.join(dir,'payload.bin'),manifest:path.join(dir,'manifest.json')};
}
function checkIncoming(peer,self,id){
 const p=transferPaths(peer,self,id);
 if(!fs.existsSync(p.payload)||!fs.existsSync(p.manifest))fail('Transfer is pending');
 const m=JSON.parse(fs.readFileSync(p.manifest,'utf8'));
 if(m.schema!=='ctmesh-v1'||m.id!==id||m.from!==peer||m.to!==self)fail('Identity mismatch');
 if(typeof m.name!=='string'||m.name!==path.basename(m.name)||/[\\/:*?"<>|\x00-\x1f]/.test(m.name)||m.name==='.'||m.name==='..')fail('Unsafe filename');
 if(!Number.isSafeInteger(m.bytes)||m.bytes<0||!(/^[0-9a-f]{64}$/.test(m.sha256)))fail('Invalid metadata');
 const stat=fs.lstatSync(p.payload);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==m.bytes||hash(p.payload)!==m.sha256)fail('SHA256/size mismatch');
 return {m,p};
}
try{
 const self=JSON.parse(fs.readFileSync(path.join(root,'node.json'),'utf8')).alias;
 if(!validAlias.test(self))fail('Unrecognized local device');
 if(cmd==='info'){json({schema:'ctmesh-v1',device:self,transport:'Syncthing 2.1.6',root});}
 else{
   const peer=arg('peer');if(!peer)fail('Provide --peer');
   if(cmd==='send'){
     const filename=arg('path');if(!filename)fail('Provide --path');
     const file=path.resolve(filename),st=fs.lstatSync(file),name=path.basename(file);
     if(!st.isFile()||st.isSymbolicLink()||/[\\/:*?"<>|\x00-\x1f]/.test(name))fail('Unsafe source');
     const id=arg('id',crypto.randomUUID()),p=transferPaths(peer,self,id);
     fs.mkdirSync(path.dirname(p.dir),{recursive:true});
     fs.mkdirSync(p.dir); // reject duplicate transfer identifiers
     const staging=path.join(root,'staging',peer);
     fs.mkdirSync(staging,{recursive:true});
     const temp=path.join(staging,id+'.part');
     fs.copyFileSync(file,temp,fs.constants.COPYFILE_EXCL);
     const after=fs.statSync(file);
     if(after.size!==st.size||after.mtimeMs!==st.mtimeMs)fail('Source changed while copying');
     const sha256=hash(temp);
     fs.renameSync(temp,p.payload); // copy into observed folder only once complete
     const manifest={schema:'ctmesh-v1',id,from:self,to:peer,name,bytes:st.size,sha256,createdAt:new Date().toISOString()};
     fs.writeFileSync(p.manifest,JSON.stringify(manifest)+'\n',{flag:'wx',mode:0o600});
     json({status:'QUEUED',...manifest});
   }else if(cmd==='status'||cmd==='receive'){
     const id=arg('id');if(!id)fail('Provide --id');
     const p=transferPaths(peer,self,id);
     if(cmd==='status'&&(!fs.existsSync(p.payload)||!fs.existsSync(p.manifest))){json({status:'PENDING',id,peer});}
     else{
       const {m}=checkIncoming(peer,self,id);
       if(cmd==='status')json({status:'RECEIVED_HASH_VERIFIED',...m});
       else{
         const dest=path.resolve(arg('dest',path.join(root,'received')));
         fs.mkdirSync(dest,{recursive:true});
         const target=path.join(dest,m.name);
         if(fs.existsSync(target))fail('Destination exists; overwrite forbidden');
         const part=path.join(dest,'.ctmesh-'+id+'.part');
         fs.copyFileSync(p.payload,part,fs.constants.COPYFILE_EXCL);
         if(fs.statSync(part).size!==m.bytes||hash(part)!==m.sha256)fail('Temporary destination failed verification');
         fs.linkSync(part,target); // atomic, exclusive on NTFS/ext4
         fs.unlinkSync(part);
         if(hash(target)!==m.sha256)fail('Final verification failed');
         json({status:'DELIVERED_HASH_VERIFIED',id,path:target,bytes:m.bytes,sha256:m.sha256});
       }
     }
   }else fail('Valid commands: info | send --peer DEVICE --path FILE | status/receive --peer DEVICE --id TRANSFER [--dest DIR]');
 }
}catch(e){process.stderr.write('CTMESH_ERROR: '+e.message+'\n');process.exitCode=1;}
