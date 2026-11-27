// The owner-enrolled witness runtime paths are per-host inputs, never a
// product-source profile map. The already enrolled pin and signed native
// broker remain authoritative for the owner, executable and tunnel.
import path from 'node:path';

const SEGMENT=/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function resolveLinuxNativeOwnerWitnessPaths({
  home,profile,uid,socketPath,publicKeyPath
}={}){
  if(process.platform!=='linux'||typeof home!=='string'
    ||!path.isAbsolute(home)||path.normalize(home)!==home
    ||!Number.isSafeInteger(uid)||uid<1
    ||typeof profile!=='string'||!SEGMENT.test(profile)
    ||profile==='.'||profile==='..')
    fail('RC012_OWNER_WITNESS_PATHS_SCOPE_INVALID');
  // Only an immediate owner-private runtime directory below the actual
  // Linux user runtime may carry the signed attest socket.
  const runtime='/run/user/'+uid;
  if(typeof socketPath!=='string'
    ||socketPath!==path.normalize(socketPath)
    ||!socketPath.startsWith(runtime+'/')
    ||path.basename(socketPath)!=='proof.sock'
    ||path.dirname(path.dirname(socketPath))!==runtime
    ||Buffer.byteLength(socketPath)>100)
    fail('RC012_OWNER_WITNESS_SOCKET_NOT_PINNED');
  const label=path.basename(path.dirname(socketPath));
  if(!SEGMENT.test(label)||label==='.'||label==='..')
    fail('RC012_OWNER_WITNESS_SOCKET_NOT_PINNED');
  const expectedPublicKey=path.join(home,
    '.local/state/chatgpt-remote-commander',
    'private-pair-security-'+profile,'native-witness','public.pem');
  if(publicKeyPath!==expectedPublicKey)
    fail('RC012_OWNER_WITNESS_PUBLIC_KEY_NOT_PINNED');
  return Object.freeze({socketPath,publicKeyPath});
}
