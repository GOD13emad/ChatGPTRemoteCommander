/**
 * Read-only local owner identity bound to the active, owner-private Router.
 *
 * This module has no network surface, native-control listener or startup side
 * effects. The trusted *resident* Core supplies its own configuration identity
 * and this same callback to its native IPC adapter; a client cannot choose or
 * change the route, profile or generation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateRouterState } from './stable-router.mjs';

const DEVICE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { managementCode:code }); };
const isInt=(n,min,max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n)&&n>=min&&n<=max;
const DIR_FLAGS=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC;
const FILE_FLAGS=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC;

function privateRouteFile(filename, uid) {
  if (typeof filename!=='string'||!path.isAbsolute(filename)||path.resolve(filename)!==filename||
      filename.includes('\0')||!filename.endsWith('.json')) fail('MANAGEMENT_ROUTE_PATH_UNVERIFIED');
  const folder=path.dirname(filename);
  let dirFd, fileFd;
  try {
    // Reject a symlink in an ancestor before opening the private directory.
    if (fs.realpathSync.native(folder)!==folder) fail('MANAGEMENT_ROUTE_DIRECTORY_UNTRUSTED');
    dirFd=fs.openSync(folder,DIR_FLAGS);
    const d=fs.fstatSync(dirFd);
    if (!d.isDirectory()||d.uid!==uid||(d.mode&0o777)!==0o700)
      fail('MANAGEMENT_ROUTE_DIRECTORY_UNTRUSTED');
    // Bind file lookup to the OPEN owner-only directory, not a later pathname
    // substitution. This is Linux-only by contract.
    fileFd=fs.openSync('/proc/self/fd/'+dirFd+'/'+path.basename(filename),FILE_FLAGS);
    const st=fs.fstatSync(fileFd);
    if (!st.isFile()||st.uid!==uid||(st.mode&0o077)!==0||st.nlink!==1||
        st.size<24||st.size>32768) fail('MANAGEMENT_ROUTE_FILE_UNTRUSTED');
    const raw=fs.readFileSync(fileFd,'utf8');
    if(Buffer.byteLength(raw)>32768)fail('MANAGEMENT_ROUTE_FILE_UNTRUSTED');
    return validateRouterState(JSON.parse(raw));
  } catch(error) {
    if (error?.managementCode)throw error;
    fail('MANAGEMENT_ROUTE_READ_UNVERIFIED');
  } finally {
    if(fileFd!==undefined)fs.closeSync(fileFd);
    if(dirFd!==undefined)fs.closeSync(dirFd);
  }
}

/**
 * Supplies a fresh exact target read from an owner-only live route state.
 * The call can fail closed whenever the router file is rotated or invalid.
 * Proof is OS-file ownership plus router equality, NOT authenticated chat/user
 * consent or protection against same-UID malware/root.
 */
export function createOwnerRouteIdentity({
  routerStatePath,deviceId,profileId,configSha256,port,
}={}) {
  if (process.platform!=='linux'||typeof process.getuid!=='function')
    fail('MANAGEMENT_PLATFORM_UNSUPPORTED');
  const uid=process.getuid();
  if(uid===0||uid!==process.geteuid()||process.getgid()!==process.getegid())
    fail('MANAGEMENT_OWNER_IDENTITY_UNAVAILABLE');
  if(typeof deviceId!=='string'||!DEVICE.test(deviceId)||
     typeof profileId!=='string'||!DEVICE.test(profileId)||
     typeof configSha256!=='string'||!HEX64.test(configSha256)||
     !isInt(port,1024,65535))fail('MANAGEMENT_CORE_IDENTITY_INVALID');

  function snapshot() {
    const state=privateRouteFile(routerStatePath,uid);
    if(state.profile!==profileId||state.active.port!==port||
       state.active.configSha256!==configSha256)
      fail('MANAGEMENT_ROUTER_ACTIVE_CORE_MISMATCH');
    return Object.freeze({
      deviceId,profileId,configSha256,routeGeneration:state.generation,
    });
  }
  const original=snapshot();
  return Object.freeze({
    target:original,
    // The native gateway re-reads this before every possible effect. Rotation
    // changes routeGeneration, making the old one-time session fail closed.
    readIdentity:snapshot,
  });
}
