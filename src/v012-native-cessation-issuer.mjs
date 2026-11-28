// Owner-broker library primitive, not a network endpoint or a grant issuer.
// Caller must own the admitted reservation, isolated key and observed native
// process. Never accept these inputs directly from a Worker or MCP request.
import {createHash,createPublicKey,sign,KeyObject} from 'node:crypto';
import {isTrustedProcessCessationProof,serializeProcessCessationProof} from './process-containment.mjs';
import {NATIVE_CESSATION_CERTIFICATE_DOMAIN,encodeNativeCessationCertificateClaims,
  normalizeNativeCessationExpected,verifyNativeCessationCertificate} from './v012-native-cessation-certificate.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const terminal=new Set(['SUCCEEDED','FAILED','TIMED_OUT','CANCELLED']);
export function issueObservedNativeCessationCertificate({
  expected,proof,receiptBytes,privateKey,now=Date.now()
}={}){
  try{
    expected=normalizeNativeCessationExpected(expected);
    // Reject serialized or copied proofs, even if their public digest matches.
    if(!isTrustedProcessCessationProof(proof,expected?.binding)
      ||proof.cleanupRequired!==false||proof.provider!==expected.provider
      ||!(privateKey instanceof KeyObject)||privateKey.type!=='private'
      ||privateKey.asymmetricKeyType!=='ed25519'
      ||!Number.isSafeInteger(now)||now<0
      ||!Number.isSafeInteger(expected.admittedAtMs)||expected.admittedAtMs<0
      ||!Buffer.isBuffer(receiptBytes)||receiptBytes.length<2
      ||receiptBytes.length>1024*1024)return null;
    const finished=Date.parse(proof.completedAt);
    if(!Number.isSafeInteger(finished)||finished<expected.admittedAtMs||finished>now)return null;
    const bytes=Buffer.from(receiptBytes);
    if(sha(bytes)!==expected.receiptSha256)return null;
    const receipt=JSON.parse(bytes.toString('utf8'));
    if(!receipt||receipt.operationId!==expected.binding.operationId
      ||receipt.inputHash!==expected.inputHash||!terminal.has(receipt.status))return null;
    const publicKey=createPublicKey(privateKey);
    if(sha(publicKey.export({format:'der',type:'spki'}))!==expected.keySha256)return null;
    const claims=Object.freeze({
      schema:1,kind:NATIVE_CESSATION_CERTIFICATE_DOMAIN,
      hostId:expected.hostId,brokerId:expected.brokerId,keySha256:expected.keySha256,
      inputHash:expected.inputHash,receiptSha256:expected.receiptSha256,
      issuedAtMs:now,proof:Object.freeze(serializeProcessCessationProof(proof))
    });
    const packet=Object.freeze({claims,
      signature:sign(null,encodeNativeCessationCertificateClaims(claims),privateKey).toString('base64')});
    // Verify against the original protected admission record, not the packet.
    if(!verifyNativeCessationCertificate({packet,expected,now,
      publicKeyPem:publicKey.export({format:'pem',type:'spki'})}))return null;
    return packet;
  }catch{return null;}
}
