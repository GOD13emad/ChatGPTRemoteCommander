import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerPrivatePairBootstrap}
  from '../src/rc012-owner-native-scoped-canary-bootstrap-linux.mjs';
test('production canary requires explicit opt-in and Core-provided durable Worker store',async()=>{
 const original=process.env.RC012_OWNER_BOOTSTRAP_SCOPE;
 try{
   process.env.RC012_OWNER_BOOTSTRAP_SCOPE='OWNER_ENROLLED_NO_GRANT';
   await assert.rejects(createOwnerPrivatePairBootstrap({
     profileId:'MMZ-v012',configSha256:'0'.repeat(64),
     ownerWorkerRegistry:{get:async()=>null,register:async()=>false,
       revoke:async()=>false,isRevoked:async()=>false}
   }),{code:'RC012_CANARY_OWNER_BOOTSTRAP_REQUIRED'});
   process.env.RC012_OWNER_BOOTSTRAP_SCOPE='OWNER_PINNED_READ_ONLY_CANARY';
   await assert.rejects(createOwnerPrivatePairBootstrap({
     profileId:'MMZ-v012',configSha256:'0'.repeat(64)
   }),{code:'RC012_CANARY_OWNER_BOOTSTRAP_REQUIRED'});
   await assert.rejects(createOwnerPrivatePairBootstrap({
     profileId:'../wrong',configSha256:'0'.repeat(64),
     ownerWorkerRegistry:{get:()=>{},register:()=>{},revoke:()=>{},isRevoked:()=>{}}
   }),{code:'RC012_CANARY_OWNER_BOOTSTRAP_REQUIRED'});
 }finally{
   if(original===undefined)delete process.env.RC012_OWNER_BOOTSTRAP_SCOPE;
   else process.env.RC012_OWNER_BOOTSTRAP_SCOPE=original;
 }
});
test('canary cannot inherit legacy J01-only NO_GRANT mode as operational permission',async()=>{
 const original=process.env.RC012_OWNER_BOOTSTRAP_SCOPE;
 try{
   for(const scope of ['OWNER_ENROLLED_NO_GRANT','FULL_ACCESS','UNRESTRICTED','']){
     process.env.RC012_OWNER_BOOTSTRAP_SCOPE=scope;
     await assert.rejects(createOwnerPrivatePairBootstrap({
       profileId:'qa-profile',configSha256:'0'.repeat(64),
       ownerWorkerRegistry:{get:async()=>null,register:async()=>false,
         revoke:async()=>false,isRevoked:async()=>false}
     }),{code:'RC012_CANARY_OWNER_BOOTSTRAP_REQUIRED'});
   }
 }finally{
   if(original===undefined)delete process.env.RC012_OWNER_BOOTSTRAP_SCOPE;
   else process.env.RC012_OWNER_BOOTSTRAP_SCOPE=original;
 }
});
