// V2 G1: mTLS for the local tunnel-client -> private MCP hop.
// This authenticates the installed OpenAI tunnel-client, NOT the ChatGPT user.
// The OpenAI tunnel control plane and OAuth bearer remain separate trust gates.
import {createHash,createPrivateKey,createPublicKey,X509Certificate} from 'node:crypto';

const CLIENT_AUTH_OID='1.3.6.1.5.5.7.3.2';
const SERVER_AUTH_OID='1.3.6.1.5.5.7.3.1';
function fail(code){throw Object.assign(new Error(code),{code});}
function sha(bytes){return createHash('sha256').update(bytes).digest('hex');}
function pin(value,code){
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))fail(code);
 return value.toLowerCase();
}
function certFromPem(value,code){
 if(typeof value!=='string'||value.length>65536
  ||(value.match(/-----BEGIN CERTIFICATE-----/g)||[]).length!==1)
  fail(code);
 try{return new X509Certificate(value);}catch{fail(code);}
}
function validAt(cert,now){
 const start=Date.parse(cert.validFrom),end=Date.parse(cert.validTo);
 return Number.isFinite(start)&&Number.isFinite(end)&&now>=start&&now<end;
}
function dnsNames(value){
 return typeof value==='string'?value.split(/,\s*/).map(x=>x.trim())
  .filter(x=>x.startsWith('DNS:')).map(x=>x.slice(4)):[];
}
function assertClock(now){
 if(!Number.isSafeInteger(now))fail('V2_SECURE_TUNNEL_CLOCK_INVALID');
}
function privateKeyMatches(cert,pem){
 let key;
 try{key=createPrivateKey(pem);}catch{fail('V2_SECURE_TUNNEL_SERVER_KEY_INVALID');}
 let a,b;
 try{
  a=createPublicKey(key).export({type:'spki',format:'der'});
  b=cert.publicKey.export({type:'spki',format:'der'});
 }catch{fail('V2_SECURE_TUNNEL_SERVER_KEY_INVALID');}
 if(!Buffer.from(a).equals(Buffer.from(b)))fail('V2_SECURE_TUNNEL_SERVER_KEY_MISMATCH');
}
export function createV2SecureTunnelServerTlsOptions({
 serverCertificatePem,serverPrivateKeyPem,clientCaPem,clientCaDerSha256,
 expectedServerDns='localhost',now=Date.now()
}={}){
 assertClock(now);
 const caPin=pin(clientCaDerSha256,'V2_SECURE_TUNNEL_CA_PIN_REQUIRED');
 const ca=certFromPem(clientCaPem,'V2_SECURE_TUNNEL_CA_INVALID');
 const server=certFromPem(serverCertificatePem,'V2_SECURE_TUNNEL_SERVER_CERT_INVALID');
 if(sha(ca.raw)!==caPin||!ca.ca||!ca.checkIssued(ca)||!ca.verify(ca.publicKey)
  ||!validAt(ca,now))fail('V2_SECURE_TUNNEL_CA_UNTRUSTED');
 if(server.ca||!server.checkIssued(ca)||!server.verify(ca.publicKey)
  ||!validAt(server,now)
  ||!dnsNames(server.subjectAltName).includes(expectedServerDns))
  fail('V2_SECURE_TUNNEL_SERVER_CERT_INVALID');
 privateKeyMatches(server,serverPrivateKeyPem);
 if(!Array.isArray(server.keyUsage)||!server.keyUsage.includes(SERVER_AUTH_OID))
  fail('V2_SECURE_TUNNEL_SERVER_USAGE_INVALID');
 return Object.freeze({
  cert:serverCertificatePem,key:serverPrivateKeyPem,
  ca:Object.freeze([clientCaPem]),requestCert:true,rejectUnauthorized:true,
  minVersion:'TLSv1.2',honorCipherOrder:true
 });
}
export function createV2SecureTunnelClientMtlsAttestor({
 clientCaDerSha256,clientCertificateSha256,
 expectedClientDns='commander-v2-tunnel-client',now=Date.now
}={}){
 const caPin=pin(clientCaDerSha256,'V2_SECURE_TUNNEL_CA_PIN_REQUIRED');
 const clientPin=pin(clientCertificateSha256,'V2_SECURE_TUNNEL_CLIENT_CERT_PIN_REQUIRED');
 if(typeof now!=='function')fail('V2_SECURE_TUNNEL_CLOCK_INVALID');
 return async request=>{
  const socket=request?.socket;
  if(!socket||socket.encrypted!==true||socket.authorized!==true
   ||typeof socket.getPeerCertificate!=='function'
   ||typeof socket.getProtocol!=='function')return Object.freeze({authenticated:false});
  const protocol=socket.getProtocol();
  if(!['TLSv1.2','TLSv1.3'].includes(protocol))return Object.freeze({authenticated:false});
  let cert;
  try{cert=socket.getPeerCertificate(true);}catch{return Object.freeze({authenticated:false});}
  if(!cert||!Buffer.isBuffer(cert.raw)||!Buffer.isBuffer(cert.issuerCertificate?.raw)
   ||cert.raw.equals(cert.issuerCertificate.raw))return Object.freeze({authenticated:false});
  if(sha(cert.raw)!==clientPin||sha(cert.issuerCertificate.raw)!==caPin)
   return Object.freeze({authenticated:false});
  if(!dnsNames(cert.subjectaltname).includes(expectedClientDns)
   ||!Array.isArray(cert.ext_key_usage)||!cert.ext_key_usage.includes(CLIENT_AUTH_OID))
   return Object.freeze({authenticated:false});
  const current=now(),start=Date.parse(cert.valid_from),end=Date.parse(cert.valid_to);
  if(!Number.isSafeInteger(current)||!Number.isFinite(start)||!Number.isFinite(end)
   ||current<start||current>=end)return Object.freeze({authenticated:false});
  // The TLS peer proves possession of the pinned local tunnel-client key.
  // Its authenticated outbound OpenAI Tunnel session is the source of the
  // forwarded openai/session metadata; OAuth and owner consent remain separate.
  return Object.freeze({
   authenticated:true,peerType:'openai-secure-mcp-tunnel',
   sessionSource:'openai/session'
  });
 };
}
