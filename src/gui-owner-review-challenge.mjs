// Stage-only owner-review challenge transcript. It verifies binding/integrity,
// not owner identity. NEVER wire these results to GUI release or J01 mutation.
// A separately protected, OS-local broker must supply trusted enrollment,
// one-time challenge issuance, physical owner presence and dispatch quiescence.
import {createHash,createPublicKey,verify,constants} from 'node:crypto';

const fault=()=>Object.assign(new Error('GUI_OWNER_REVIEW_INVALID_TRANSCRIPT'),
 {code:'GUI_OWNER_REVIEW_INVALID_TRANSCRIPT'});
const J01_TOOLS=new Set(['gui_mouse_move','gui_mouse_delta','gui_mouse_scroll',
 'gui_mouse_click','gui_mouse_drag','gui_type_text','gui_key_press','gui_focus_window']);
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9-]{8,128}$/;
const saneUtc=s=>typeof s==='string' && ISO.test(s) &&
 Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s;
const sha=b=>createHash('sha256').update(b).digest('hex');

const freeze=x=>Object.freeze(x);
const noAuthority=valid=>freeze({
 signatureValid:valid,ownerAuthenticated:false,releaseAuthorized:false,
 fleetQuiescenceProven:false,nativeOutcome:'UNKNOWN',noReplay:true,
 reason:'OS_PROTECTED_OWNER_BROKER_NOT_AVAILABLE'
});

export function createIncidentReviewChallenge({incident,nonce,issuedUtc,expiryUtc}={}){
 if(!incident||typeof incident!=='object'||Array.isArray(incident)||
   !ID.test(incident.id??'')||!J01_TOOLS.has(incident.tool)||
   !saneUtc(incident.startedUtc)||incident.status!=='PENDING_NATIVE_EFFECT'||
   incident.nativeOutcome!=='UNKNOWN'||!HEX64.test(incident.evidenceSha256??'')||
   !Number.isSafeInteger(incident.evidenceBytes)||incident.evidenceBytes<1||
   incident.evidenceBytes>2048||!HEX64.test(nonce??'')||
   !saneUtc(issuedUtc)||!saneUtc(expiryUtc))throw fault();
 const issued=Date.parse(issuedUtc),expires=Date.parse(expiryUtc);
 if(expires<=issued||expires-issued>120000)throw fault();
 const challenge={
  schema:'rc-gui-owner-review-challenge-v1',
  purpose:'OWNER_REVIEW_UNKNOWN_NATIVE_EFFECT',
  incidentId:incident.id,
  incidentTool:incident.tool,
  incidentStartedUtc:incident.startedUtc,
  originalSha256:incident.evidenceSha256,
  originalBytes:incident.evidenceBytes,
  nativeOutcome:'UNKNOWN',
  nonce,issuedUtc,expiryUtc,
  ownerAuthenticated:false,
  releaseAuthorized:false,
  fleetQuiescenceProven:false
 };
 const digest=sha(reviewSignatureBytesUnchecked(challenge));
 return freeze({...challenge,challengeSha256:digest});
}

const reviewSignatureBytesUnchecked=c=>Buffer.from(
 'RC-GUI-OWNER-REVIEW-TRANSCRIPT-V1\n'+JSON.stringify([
 c.schema,c.purpose,c.incidentId,c.incidentTool,c.incidentStartedUtc,
 c.originalSha256,c.originalBytes,c.nativeOutcome,c.nonce,
 c.issuedUtc,c.expiryUtc
 ])+'\n','utf8');

function assertValidChallenge(challenge){
 if(!challenge||typeof challenge!=='object'||Array.isArray(challenge))throw fault();
 if(challenge.schema!=='rc-gui-owner-review-challenge-v1' ||
   challenge.purpose!=='OWNER_REVIEW_UNKNOWN_NATIVE_EFFECT' ||
   challenge.nativeOutcome!=='UNKNOWN' ||
   challenge.ownerAuthenticated!==false ||challenge.releaseAuthorized!==false ||
   challenge.fleetQuiescenceProven!==false ||
   !HEX64.test(challenge.challengeSha256??''))throw fault();
 const clean=createIncidentReviewChallenge({
  incident:{id:challenge.incidentId,tool:challenge.incidentTool,
   startedUtc:challenge.incidentStartedUtc,status:'PENDING_NATIVE_EFFECT',
   nativeOutcome:'UNKNOWN',evidenceSha256:challenge.originalSha256,
   evidenceBytes:challenge.originalBytes},
  nonce:challenge.nonce,issuedUtc:challenge.issuedUtc,
  expiryUtc:challenge.expiryUtc
 });
 if(clean.challengeSha256!==challenge.challengeSha256 ||
   Object.keys(challenge).sort().join(',')!==Object.keys(clean).sort().join(','))
   throw fault();
}

export function reviewSignatureBytes(challenge){
 assertValidChallenge(challenge);
 return reviewSignatureBytesUnchecked(challenge);
}

export function verifyIncidentReviewSignature({challenge,response,publicKey,nowUtc}={}){
 // Cryptographic diagnostics only: even a valid signature made with a
 // caller-supplied public key CANNOT establish a trusted owner enrollment.
 assertValidChallenge(challenge);
 if(!saneUtc(nowUtc)||Date.parse(nowUtc)<Date.parse(challenge.issuedUtc)||
   Date.parse(nowUtc)>Date.parse(challenge.expiryUtc))return noAuthority(false);
 if(!response||typeof response!=='object'||Array.isArray(response)||
   Object.keys(response).sort().join(',')!==
    ['schema','challengeSha256','signatureBase64'].sort().join(',')||
   response.schema!=='rc-gui-owner-signed-review-v1'||
   response.challengeSha256!==challenge.challengeSha256||
   typeof response.signatureBase64!=='string'||
   response.signatureBase64.length<32||response.signatureBase64.length>8192||
   !/^[A-Za-z0-9+/]+={0,2}$/.test(response.signatureBase64))
   return noAuthority(false);
 const sig=Buffer.from(response.signatureBase64,'base64');
 if(sig.length<128||sig.toString('base64')!==response.signatureBase64||
   typeof publicKey!=='string'||publicKey.length>8192)return noAuthority(false);
 try{
  const key=createPublicKey(publicKey);
  // Diagnostic protocol deliberately restricts RSA-2048+ PKCS1v1.5 SHA256.
  if(key.asymmetricKeyType!=='rsa'||
    (key.asymmetricKeyDetails?.modulusLength??0)<2048)return noAuthority(false);
  return noAuthority(verify('sha256',reviewSignatureBytesUnchecked(challenge),
   {key,padding:constants.RSA_PKCS1_PADDING},sig));
 }catch{return noAuthority(false);}
}
