import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ProjectCoordinationDirectory} from '../src/project-coordination-directory.mjs';

const options=directory=>({
  directory,resolveAttestedRoute:async()=>({}),authorizeProject:async()=>false
});
const deny=e=>e?.projectHubCode==='PROJECT_HUB_DIRECTORY_UNSAFE';
const denyFile=e=>e?.projectHubCode==='PROJECT_HUB_DATABASE_ACL_UNSAFE';
function hasEveryoneAllow(file,isDir=false){
 const escaped=file.replaceAll("'","''");
 const kind=isDir?'Directory':'File';
 const script="$ErrorActionPreference='Stop';$a=[System.IO."+kind+"]::GetAccessControl('"+escaped+"'); "+
   "$b=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | Where-Object { "+
   "$_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and "+
   "$_.IdentityReference.Value -eq 'S-1-1-0' }); "+
   "if($b.Count -gt 0){'1'}else{'0'}";
 return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
   {timeout:7000,stdio:'pipe',encoding:'utf8'}).trim();
}
function fixture(callback){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-acl-negative-'));
 try{callback(path.join(base,'index'))}
 finally{fs.rmSync(base,{recursive:true,force:true})}
}
test('new Windows SQLite directory is owner-only with protected DACL; restart stays admitted',{skip:process.platform!=='win32'},()=>{
 fixture(directory=>{
  const first=new ProjectCoordinationDirectory(options(directory));
  first.close();
  const db=path.join(directory,'project-conversations.sqlite');
  assert.equal(hasEveryoneAllow(directory,true),'0');
  assert.equal(hasEveryoneAllow(db),'0');
  const second=new ProjectCoordinationDirectory(options(directory));
  second.close();
 });
});
test('broad existing Windows directory fails before SQLite created',{skip:process.platform!=='win32'},()=>{
 fixture(directory=>{
  fs.mkdirSync(directory);
  execFileSync('icacls.exe',[directory,'/grant','*S-1-1-0:(OI)(CI)RX'],{timeout:5000,stdio:'pipe'});
  assert.equal(hasEveryoneAllow(directory,true),'1','SYNTHETIC_EVERYONE_ACL_NOT_PROVISIONED');
  assert.throws(()=>new ProjectCoordinationDirectory(options(directory)),deny);
  assert.equal(fs.existsSync(path.join(directory,'project-conversations.sqlite')),false);
 });
});
test('broadened preexisting Windows DB is refused before reopening',{skip:process.platform!=='win32'},()=>{
 fixture(directory=>{
  const first=new ProjectCoordinationDirectory(options(directory));
  first.close();
  const db=path.join(directory,'project-conversations.sqlite');
  execFileSync('icacls.exe',[db,'/grant','*S-1-1-0:R'],{timeout:5000,stdio:'pipe'});
  assert.equal(hasEveryoneAllow(db),'1');
  assert.throws(()=>new ProjectCoordinationDirectory(options(directory)),denyFile);
 });
});

test('existing protected Windows directory with newly added broad ACE is rejected',{skip:process.platform!=='win32'},()=>{
 fixture(directory=>{
  const original=new ProjectCoordinationDirectory(options(directory));
  original.close();
  execFileSync('icacls.exe',[directory,'/grant','*S-1-1-0:(OI)(CI)RX'],{timeout:5000,stdio:'pipe'});
  assert.equal(hasEveryoneAllow(directory,true),'1');
  assert.throws(()=>new ProjectCoordinationDirectory(options(directory)),deny);
 });
});
