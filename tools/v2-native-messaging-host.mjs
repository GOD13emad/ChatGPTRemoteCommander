#!/usr/bin/env node
// Executable stdio transport for browser-launched Native Messaging only.
// Does not launch a browser, register an extension, open a socket, or delegate
// actions to V1. A native OwnerSeat + OAuth/Grant binding is a separate gate.
import {createV2NativeMessageDecoder,encodeV2NativeMessage,
 respondV2NativeOwnerPreflight,validateV2NativeExtensionOrigin}
 from '../src/v2-native-messaging-protocol.mjs';

function reject(){
 // No plaintext context, browser URL, token or request body in diagnostics.
 process.stderr.write('V2_NATIVE_HOST_DENIED\n');
 process.exitCode=1;
}
try{
 const browserOrigin=validateV2NativeExtensionOrigin(process.argv[2]);
 const registeredOrigin=validateV2NativeExtensionOrigin(
   process.env.RCV2_NATIVE_MESSAGING_ALLOWED_ORIGIN);
 if(browserOrigin!==registeredOrigin)throw Error('DENIED');
 const decoder=createV2NativeMessageDecoder();
 let handled=0;
 process.stdin.on('data',chunk=>{
  if(process.exitCode)return;
  try{
   for(const message of decoder.push(chunk)){
    if(++handled>16)throw Error('TOO_MANY_MESSAGES');
    const result=respondV2NativeOwnerPreflight(message,{
      browserOrigin,registeredOrigin
    });
    process.stdout.write(encodeV2NativeMessage(result));
   }
  }catch{reject();process.stdin.destroy();}
 });
 process.stdin.on('end',()=>{
  if(process.exitCode)return;
  try{decoder.finish();}catch{reject();}
 });
 process.stdin.on('error',reject);
}catch{reject();}
