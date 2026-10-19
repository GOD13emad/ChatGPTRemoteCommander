// SOURCE-ONLY QA: verifies a short-lived signed native workspace permission.
// NO private signer, account authorization or protected OS broker is installed.
// Without a separately protected signer and authenticated Core caller identity,
// this module must NOT grant installed Commander GUI access.
// A same-user mutable public-key file is NOT a trusted authorization root.
import {createPublicKey, randomBytes, verify} from 'node:crypto';

const HEX=/^[a-f0-9]{64}$/;
const IDENT=/^[A-Za-z0-9._:@/-]{3,160}$/;
const BASE64URL=/^[A-Za-z0-9_-]+$/;
const SCOPES=new Set(['observe','control']);
const DOMAIN=Buffer.from('RC_NATIVE_WORKSPACE_APPROVAL_V1\0','utf8');
const fault=code=>Object.assign(new Error(code),{code});

function decodeBase64url(value,maxBytes){
  if(typeof value!=='string'||value.length===0||
     value.length>Math.ceil(maxBytes*4/3)+8||!BASE64URL.test(value))
    throw fault('NATIVE_APPROVAL_MALFORMED');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length===0||bytes.length>maxBytes||
     bytes.toString('base64url')!==value)
    throw fault('NATIVE_APPROVAL_MALFORMED');
  return bytes;
}
function identity(label,value){
  if(typeof value!=='string'||!IDENT.test(value))
    throw fault('NATIVE_APPROVAL_CONFIGURATION_INVALID_'+label);
  return value;
}
function ref(label,value){
  if(typeof value!=='string'||!HEX.test(value))
    throw fault('NATIVE_APPROVAL_TARGET_INVALID_'+label);
  return value;
}
function tokenStructure(body){
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw fault('NATIVE_APPROVAL_MALFORMED');
  const fields=['schema','issuer','audience','host','instance','scope',
    'workspaceRef','backendRef','ownerRef','subjectRef','nonce','issuedAt','expiresAt'];
  if(Object.keys(body).length!==fields.length||
     fields.some(key=>!Object.hasOwn(body,key)))
    throw fault('NATIVE_APPROVAL_MALFORMED');
  return {
    schema:body.schema,issuer:body.issuer,audience:body.audience,
    host:body.host,instance:body.instance,scope:body.scope,
    workspaceRef:body.workspaceRef,backendRef:body.backendRef,ownerRef:body.ownerRef,
    subjectRef:body.subjectRef,nonce:body.nonce,
    issuedAt:body.issuedAt,expiresAt:body.expiresAt
  };
}

// The trusted verifier public key must come from an *independently provisioned*
// secure authority. Its authenticity cannot be proved by this factory.
// processInstance is public nonce/challenge (NOT caller authentication).
// An explicit deterministic instance injection is permitted only for tests.
export function createNativeWorkspaceApprovalVerifier({
  trustedPublicKey=null,
  issuer='',
  audience='',
  host='',
  clock=Date.now,
  processInstance=randomBytes(32).toString('hex'),
  maxConsumed=512
}={}){
  const expectedIssuer=identity('ISSUER',issuer);
  const expectedAudience=identity('AUDIENCE',audience);
  const expectedHost=identity('HOST',host);
  if(typeof processInstance!=='string'||!HEX.test(processInstance)||
     !Number.isSafeInteger(maxConsumed)||maxConsumed<1||maxConsumed>8192)
    throw fault('NATIVE_APPROVAL_CONFIGURATION_INVALID');
  let key=null;
  if(trustedPublicKey!==null){
    try{
      key=(trustedPublicKey?.type==='public'&&
           trustedPublicKey?.asymmetricKeyType==='ed25519')
        ? trustedPublicKey : createPublicKey(trustedPublicKey);
      if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')
        throw Error('Not Ed25519 public key');
    }catch{throw fault('NATIVE_APPROVAL_TRUST_ANCHOR_INVALID');}
  }
  const consumed=new Map();

  function verifyAndConsume(approval,{
    scope,workspaceRef,backendRef,ownerRef,subjectRef,ttlSeconds
  }={}){
    // Every call is synchronous: two calls in this Node process cannot race
    // past the nonce map. No claim about cross-process coordination.
    if(!key)throw fault('NATIVE_APPROVAL_TRUST_ANCHOR_UNCONFIGURED');
    if(!SCOPES.has(scope)||!Number.isInteger(ttlSeconds)||
       ttlSeconds<10||ttlSeconds>(scope==='control'?120:180))
      throw fault('NATIVE_APPROVAL_SCOPE_INVALID');
    ref('WORKSPACE',workspaceRef);
    ref('BACKEND',backendRef);
    ref('OWNER',ownerRef);
    ref('SUBJECT',subjectRef);
    if(!approval||typeof approval!=='object'||Array.isArray(approval)||
       Object.keys(approval).length!==2||
       !Object.hasOwn(approval,'body')||!Object.hasOwn(approval,'signature'))
      throw fault('NATIVE_APPROVAL_MALFORMED');
    const raw=decodeBase64url(approval.body,1024);
    const signature=decodeBase64url(approval.signature,64);
    if(signature.length!==64)throw fault('NATIVE_APPROVAL_MALFORMED');
    let parsed;
    try{parsed=JSON.parse(raw.toString('utf8'));}
    catch{throw fault('NATIVE_APPROVAL_MALFORMED');}
    const body=tokenStructure(parsed);
    // Strict ordered serialization rejects duplicate JSON keys, unknown
    // fields, coercions, alternate encodings and noncanonical number forms.
    if(Buffer.from(JSON.stringify(body)+'','utf8').compare(raw)!==0)
      throw fault('NATIVE_APPROVAL_MALFORMED');
    const valid=body.schema===1&&body.issuer===expectedIssuer&&
      body.audience===expectedAudience&&body.host===expectedHost&&
      body.instance===processInstance&&body.scope===scope&&
      body.workspaceRef===workspaceRef&&body.backendRef===backendRef&&
      body.ownerRef===ownerRef&&
      body.subjectRef===subjectRef&&
      typeof body.nonce==='string'&&HEX.test(body.nonce)&&
      Number.isSafeInteger(body.issuedAt)&&body.issuedAt>0&&
      Number.isSafeInteger(body.expiresAt)&&body.expiresAt>body.issuedAt&&
      body.expiresAt-body.issuedAt===ttlSeconds*1000;
    if(!valid)throw fault('NATIVE_APPROVAL_TARGET_DENIED');
    const now=clock();
    if(!Number.isSafeInteger(now)||now<body.issuedAt-2000||
       now>=body.expiresAt||body.issuedAt>now+2000)
      throw fault('NATIVE_APPROVAL_EXPIRED_OR_FUTURE');
    const signed=Buffer.concat([DOMAIN,raw]);
    if(!verify(null,signed,key,signature))
      throw fault('NATIVE_APPROVAL_BAD_SIGNATURE');
    for(const [nonce,expiry] of consumed){
      if(expiry<=now)consumed.delete(nonce);
    }
    if(consumed.has(body.nonce))
      throw fault('NATIVE_APPROVAL_REPLAY_DENIED');
    if(consumed.size>=maxConsumed)
      throw fault('NATIVE_APPROVAL_REPLAY_STORE_FULL');
    consumed.set(body.nonce,body.expiresAt);
    return true;
  }
  return Object.freeze({
    verifyAndConsume,
    challenge:()=>({processInstance,issuer:expectedIssuer,
      audience:expectedAudience,host:expectedHost,
      status:'UNAUTHENTICATED_CHALLENGE_ONLY'}),
    status:()=>({configured:!!key,consumed:consumed.size,
      productionIdentityVerified:false,osKeyCustodyVerified:false,
      nativeGuiEnabled:false})
  });
}
