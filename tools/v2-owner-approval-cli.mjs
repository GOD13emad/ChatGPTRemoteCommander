#!/usr/bin/env node
// Owner-console boundary. Deliberately unavailable from background MCP requests.
// Interactive TTY establishes an operator review step, NOT a cryptographic OS
// presence proof. Host authorization still relies on the current Unix user.
import process from 'node:process';
import {createInterface} from 'node:readline/promises';
import {createV2OwnerApprovalQueue} from '../src/v2-owner-approval-queue.mjs';

if(process.getuid?.()===0){process.stderr.write('OWNER_UID_REQUIRED\n');process.exit(2);}
const [command,id]=process.argv.slice(2);
const queue=createV2OwnerApprovalQueue();
if(command==='list'&&id===undefined){
 for(const r of queue.list()){
  process.stdout.write(JSON.stringify({id:r.id,title:r.title,status:r.status,
     expiresAtMs:r.createdAtMs+600000,expired:r.expired})+'\n');
 }
}else if(command==='approve'&&id){
 if(!process.stdin.isTTY||!process.stdout.isTTY){
  process.stderr.write('NATIVE_INTERACTIVE_CONSOLE_REQUIRED\n');process.exit(2);
 }
 const item=queue.inspect(id);
 if(item.status!=='PENDING'||item.expired){
  process.stderr.write('REQUEST_NOT_PENDING_OR_EXPIRED\n');process.exit(2);
 }
 process.stdout.write('Exact V2 owner-local note proposal (no shell, GUI, workflow or arbitrary path):\n');
 process.stdout.write(JSON.stringify({requestId:item.id,title:item.title,text:item.text},null,2)+'\n');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{
  const answer=await rl.question('Type APPROVE '+id.slice(0,8)+' to create V2-local note: ');
  if(answer!==('APPROVE '+id.slice(0,8))){
   process.stderr.write('OWNER_DENIED\n');process.exitCode=3;
  }else process.stdout.write(JSON.stringify(queue.approve(id))+'\n');
 }finally{rl.close();}
}else{
 process.stderr.write('Usage: node v2-owner-approval-cli.mjs list | approve <request-id>\n');
 process.exitCode=2;
}
