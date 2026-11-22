import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ConversationStore} from '../src/conversation-store.mjs';
import {execFileSync} from 'node:child_process';

const skipPosix={skip:process.platform==='win32'};
const deny=e=>e?.conversationCode==='CONVERSATION_PRIVATE_DIRECTORY_UNSAFE';
const denyFile=e=>e?.conversationCode==='CONVERSATION_PRIVATE_DATABASE_UNSAFE';
function fixture(fn){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'rc013-conversation-storage-'));
  const directory=path.join(base,'state');
  const opened=[];
  const open=()=>{
    const store=new ConversationStore({directory,scope:'qa'});
    opened.push(store);
    return store;
  };
  try{return fn({base,directory,open});}
  finally{
    for(const store of opened)store.close();
    fs.rmSync(base,{recursive:true,force:true});
  }
}
test('ConversationStore creates private owner-only POSIX directory and DB',skipPosix,()=>fixture(({directory,open})=>{
  const store=open();
  try{
    assert.equal(fs.statSync(directory).mode&0o077,0);
    assert.equal(fs.statSync(path.join(directory,'conversation.sqlite')).mode&0o077,0);
  }finally{store.close();}
}));
test('ConversationStore rejects existing group-readable directory BEFORE creating SQLite',skipPosix,()=>fixture(({directory,open})=>{
  fs.mkdirSync(directory,{mode:0o700});fs.chmodSync(directory,0o750);
  assert.throws(open,deny);
  assert.equal(fs.existsSync(path.join(directory,'conversation.sqlite')),false);
}));
test('ConversationStore rejects existing world-writable directory BEFORE creating SQLite',skipPosix,()=>fixture(({directory,open})=>{
  fs.mkdirSync(directory,{mode:0o700});fs.chmodSync(directory,0o777);
  assert.throws(open,deny);
  assert.equal(fs.existsSync(path.join(directory,'conversation.sqlite')),false);
}));
test('ConversationStore rejects broadly readable existing DB BEFORE opening or changing its permissions',skipPosix,()=>fixture(({directory,open})=>{
  const store=open();store.close();
  const db=path.join(directory,'conversation.sqlite');
  fs.chmodSync(db,0o644);
  assert.throws(open,denyFile);
  assert.equal(fs.statSync(db).mode&0o077,0o044);
}));

const skipWindows={skip:process.platform!=='win32'};
function everyoneAllow(file,isDir){
  const escaped=file.replaceAll("'","''");
  const cls=isDir?'Directory':'File';
  const script="$ErrorActionPreference='Stop';$a=[IO."+cls+"]::GetAccessControl('"+escaped+"'); "+
    "$b=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | Where-Object { "+
    "$_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and "+
    "$_.IdentityReference.Value -eq 'S-1-1-0' });if($b.Count -gt 0){'1'}else{'0'}";
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],
    {encoding:'utf8',timeout:8000,stdio:'pipe'}).trim()==='1';
}
test('ConversationStore new Windows directory and DB deny Everyone ACL',skipWindows,()=>fixture(({directory,open})=>{
  const store=open();store.close();
  assert.equal(everyoneAllow(directory,true),false);
  assert.equal(everyoneAllow(path.join(directory,'conversation.sqlite'),false),false);
}));
test('ConversationStore rejects existing Everyone-readable Windows directory BEFORE SQLite',skipWindows,()=>fixture(({directory,open})=>{
  fs.mkdirSync(directory);
  execFileSync('icacls.exe',[directory,'/grant','*S-1-1-0:(OI)(CI)RX'],
    {timeout:8000,stdio:'pipe'});
  assert.equal(everyoneAllow(directory,true),true);
  assert.throws(open,deny);
  assert.equal(fs.existsSync(path.join(directory,'conversation.sqlite')),false);
}));
test('ConversationStore rejects existing Everyone-readable Windows DB before changing ACL',skipWindows,()=>fixture(({directory,open})=>{
  const store=open();store.close();
  const db=path.join(directory,'conversation.sqlite');
  execFileSync('icacls.exe',[db,'/grant','*S-1-1-0:R'],
    {timeout:8000,stdio:'pipe'});
  assert.equal(everyoneAllow(db,false),true);
  assert.throws(open,denyFile);
  assert.equal(everyoneAllow(db,false),true);
}));
