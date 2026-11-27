// Explicit opt-in owner-local read-only Core canary. Uses the SAME enrolled
// account+host Tunnel and real J01/Worker grant registry as v0.12. This is
// NOT a public enrollment endpoint or Full Access. NO_GRANT staging mode is
// deliberately unchanged. No automatic consent, grants, install or cutover.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,X509Certificate} from 'node:crypto';
import {createLinuxNativeOwnerSessionProvider}
  from './native-owner-session-provider-linux.mjs';
import {readLinuxOwnerTunnelPin,resolvePinnedOwnerTunnelDirectory}
  from './linux-private-tunnel-owner-pin.mjs';
import {createLinuxSignedBrokerTransport}
  from './linux-native-tunnel-broker-client.mjs';
import {deriveV101PrivatePairSessionHandle}
  from './v101-private-pair-native-owner-stack.mjs';
import {deriveWorkerId} from './worker-identity-authority.mjs';
import {normalizeV2Route} from './v2-routing-contract.mjs';
import {createV012NativeOwnerWorkerSecurityFactory}
  from './v012-native-owner-worker-security-factory.mjs';
import {createV012OwnerGrantAdministration}
  from './v012-owner-grant-administration.mjs';
import {createLinuxOwnerWorkerKeyEvidence}
  from './v012-owner-worker-key-evidence-linux.mjs';
import {createOwnerNativeSignedWorkerClient}
  from './v012-owner-worker-signer-client-linux.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEX=/^[a-f0-9]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const ident=x=>typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
const sha=x=>typeof x==='string'&&HEX.test(x);
function privateDir(dir,uid){
  const s=fs.lstatSync(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid
    ||(s.mode&0o077)!==0||fs.realpathSync.native(dir)!==dir)
    fail('RC012_CANARY_OWNER_DIRECTORY_UNTRUSTED');
}
function privateFile(p,uid,max=131072){
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1
    ||s.uid!==uid||(s.mode&0o077)!==0||s.size<12||s.size>max)
    fail('RC012_CANARY_OWNER_FILE_UNTRUSTED');
  return fs.readFileSync(p,'utf8');
}
const none=async()=>fail('RC012_CANARY_UNTRUSTED_ACTION_DENIED');
const CANARY_OP='system-status-canary';
const CANARY_TARGET=Object.freeze({kind:'host-shell',id:'system-status'});
const REGISTER_ARGS=['workerId','keyId','deviceProvider','deviceIdHash',
  'tunnelProvider','tunnelIdHash','capabilityPolicyDigest','grantRevision'];

function acceptArguments(tool,args){
  if(!args||typeof args!=='object'||Array.isArray(args)
    ||Object.getPrototypeOf(args)!==Object.prototype
      &&Object.getPrototypeOf(args)!==null)return false;
  const keys=Reflect.ownKeys(args);
  if(tool==='system_status')return keys.length===0;
  if(tool!=='worker.register'||keys.length!==REGISTER_ARGS.length)return false;
  for(const name of REGISTER_ARGS){
    const d=Object.getOwnPropertyDescriptor(args,name);
    if(!d?.enumerable||!Object.hasOwn(d,'value'))return false;
  }
  return typeof args.workerId==='string'&&/^cw_[a-f0-9]{64}$/.test(args.workerId)
    &&['keyId','deviceIdHash','tunnelIdHash','capabilityPolicyDigest']
      .every(k=>sha(args[k]))
    &&args.deviceProvider==='native-key-store'
    &&args.tunnelProvider==='openai-secure-mcp-tunnel'
    &&Number.isSafeInteger(args.grantRevision)&&args.grantRevision>=1;
}
export async function createOwnerPrivatePairBootstrap({
  profileId,configSha256,ownerWorkerRegistry
}={}){
  if(process.platform!=='linux'||process.getuid?.()<1
    ||process.env.RC012_OWNER_BOOTSTRAP_SCOPE!=='OWNER_PINNED_READ_ONLY_CANARY'
    ||!ident(profileId)||!sha(configSha256)
    ||!ownerWorkerRegistry
    ||['get','register','revoke','isRevoked']
      .some(k=>typeof ownerWorkerRegistry[k]!=='function'))
    fail('RC012_CANARY_OWNER_BOOTSTRAP_REQUIRED');
  const selected=process.env.RC012_OWNER_TUNNEL_PROFILE;
  const port=Number(process.env.RC012_OWNER_PRIVATE_HTTPS_PORT);
  if(!ident(selected)||!Number.isSafeInteger(port)
    ||port<1024||port>65535)
    fail('RC012_CANARY_PAIR_PORT_REQUIRED');
  const uid=process.getuid(),home=os.homedir();
  const configDir=path.join(home,'.local/state/chatgpt-remote-commander/profiles',profileId);
  privateDir(configDir,uid);
  const expectedConfig=path.join(configDir,'config.json');
  if(process.env.REMOTE_COMMANDER_CONFIG!==expectedConfig)
    fail('RC012_CANARY_CONFIG_NOT_PINNED');
  const raw=privateFile(expectedConfig,uid);
  if(createHash('sha256').update(raw).digest('hex')!==configSha256)
    fail('RC012_CANARY_CONFIG_CHANGED');
  const config=JSON.parse(raw);
  const principalId=config.capabilityProfile?.id;
  if(config.instance?.profile!==profileId||config.host!=='127.0.0.1'
    ||!ident(config.deviceName)||!ident(principalId)
    ||principalId==='owner-not-enrolled'
    ||config.durableWorkflows?.enabled!==true)
    fail('RC012_CANARY_PROFILE_CONFIGURATION_INVALID');
  const globalLease=config.durableWorkflows.rootLeaseDirectory;
  const commonLease=path.join(home,'.local/state/chatgpt-remote-commander/shared/root-leases');
  if(globalLease!==commonLease)
    fail('RC012_CANARY_GLOBAL_LEASE_NOT_PINNED');
  privateDir(commonLease,uid);
  const pairDir=resolvePinnedOwnerTunnelDirectory({home,profile:selected,ownerUid:uid});
  privateDir(pairDir,uid);
  const enrolled=readLinuxOwnerTunnelPin({directory:pairDir,ownerUid:uid});
  if(enrolled.hostId!==config.deviceName||enrolled.profileId!==selected)
    fail('RC012_CANARY_TUNNEL_PROFILE_HOST_MISMATCH');
  const cert=privateFile(path.join(pairDir,'client.crt'),uid);
  const clientSha=createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  if(clientSha!==enrolled.expectedClientLeafDerSha256)
    fail('RC012_CANARY_CLIENT_CERT_CHANGED');
  const owner=createLinuxNativeOwnerSessionProvider({ownerIdentityMode:'host-uid-v2'});
  const osOwner=await owner.resolveOwnerSidHash();
  const signedBroker=await createLinuxSignedBrokerTransport({
    hostId:enrolled.hostId,profileId:enrolled.profileId,
    expectedOwnerSidHash:osOwner,
    expectedClientLeafDerSha256:clientSha,
    expectedExecutableSha256:enrolled.expectedExecutableSha256,
    pinFile:path.join(pairDir,'owner-tunnel-trust.json'),
    socketPath:process.env.RC012_OWNER_WITNESS_SOCKET_PATH,
    publicKeyPath:process.env.RC012_OWNER_WITNESS_PUBLIC_KEY_PATH,
    resolveOwnerSidHash:owner.resolveOwnerSidHash
  });
  // This is a feasibility check, never owner consent or a Worker grant.
  const currentTransport=await signedBroker.resolveTransportIdentity();
  if(currentTransport.authenticated!==true||currentTransport.controlPlanePollOk!==true)
    fail('RC012_CANARY_TUNNEL_NOT_READY');
  const pairHandle=deriveV101PrivatePairSessionHandle({
    profileId:selected,expectedTunnelIdHash:signedBroker.expectedTunnelIdHash,
    expectedOwnerSidHash:osOwner
  });
  const ownerRoute=Object.freeze({
    hostId:enrolled.hostId,profileId:selected,principalId,
    conversationId:pairHandle,operationId:'owner-bind',
    target:Object.freeze({kind:'desktop-seat',id:'current-owner'})
  });
  const canaryRoute=normalizeV2Route({
    hostId:enrolled.hostId,profileId:selected,principalId,
    conversationId:pairHandle,operationId:CANARY_OP,
    target:CANARY_TARGET
  });
  const keyAttestor=createLinuxOwnerWorkerKeyEvidence({
    home,profile:selected,hostId:enrolled.hostId,
    resolveOwnerSidHash:owner.resolveOwnerSidHash,
    resolveTransportIdentity:signedBroker.resolveTransportIdentity
  });
  const keyProof=await keyAttestor.resolveVerifiedWorkerKey();
  const signer=createOwnerNativeSignedWorkerClient({home,profile:selected});
  const securityDir=path.join(home,'.local/state/chatgpt-remote-commander/private-pair-security-'+selected);
  privateDir(securityDir,uid);
  const socketDir='/run/user/'+uid+'/rc012-owner-admin-'+selected;
  privateDir(socketDir,uid); // systemd RuntimeDirectory must be owner-provisioned.
  const socketPath=path.join(socketDir,'admin.sock');
  if(Buffer.byteLength(socketPath)>96)
    fail('RC012_CANARY_OWNER_SOCKET_TOO_LONG');
  let stackRef=null;
  async function currentOwnerContext(){
    if(!stackRef)fail('RC012_CANARY_OWNER_STACK_NOT_READY');
    const before=await owner.resolveOwnerSidHash();
    if(before!==osOwner)fail('RC012_CANARY_OWNER_CHANGED');
    const context=await stackRef.nativeSessionBindings.resolveNativeOwnerContext(pairHandle);
    const route=normalizeV2Route(await stackRef.nativeSessionBindings.resolveNativeRoute(pairHandle));
    const after=await owner.resolveOwnerSidHash();
    if(before!==after||context.hostId!==enrolled.hostId||context.profileId!==selected
      ||context.principalId!==principalId||context.conversationId!==pairHandle
      ||route.target.kind!=='desktop-seat'||route.target.id!=='current-owner'
      ||route.operationId!=='owner-bind')
      fail('RC012_CANARY_J01_BINDING_CHANGED');
    return context;
  }
  async function trustedRoute({ownerContext,tool,arguments:args}={}){
    const context=await currentOwnerContext();
    if(!context||context.bindingId!==ownerContext?.bindingId
      ||context.ownerSidHash!==ownerContext.ownerSidHash
      ||!acceptArguments(tool,args))
      fail('RC012_CANARY_TOOL_ROUTE_DENIED');
    return canaryRoute;
  }
  const securityFactory=createV012NativeOwnerWorkerSecurityFactory({
    issuer:'commander.local',audience:'remote-commander',
    workerRegistry:ownerWorkerRegistry,
    resolveDeviceIdentity:async()=>{
      const k=await keyAttestor.resolveVerifiedWorkerKey();
      return Object.freeze({source:'native-device-attestor',
        provider:k.deviceProvider,deviceIdHash:k.deviceIdHash,
        ownerSidHash:k.ownerSidHash,verified:true,
        attestedAtMs:k.attestedAtMs,expiresAtMs:k.expiresAtMs});
    },
    resolveCapabilityPolicyDigest:async()=>{
      return (await keyAttestor.resolveVerifiedWorkerKey()).capabilityPolicyDigest;
    },
    resolveTrustedToolRoute:trustedRoute,
    authorizeExactArguments:async({route,tool,arguments:args,ownerContext})=>{
      try{
        const expected=await trustedRoute({ownerContext,tool,arguments:args});
        return route.hostId===expected.hostId
          &&route.profileId===expected.profileId
          &&route.principalId===expected.principalId
          &&route.conversationId===expected.conversationId
          &&route.operationId===expected.operationId
          &&route.target.kind===expected.target.kind
          &&route.target.id===expected.target.id;
      }catch{return false;}
    },
    resolveCurrentOwnerRoute:async ownerContext=>
      trustedRoute({ownerContext,tool:'system_status',arguments:{}}),
    resolveCurrentWorkerId:async ownerContext=>{
      const c=await currentOwnerContext();
      if(c.bindingId!==ownerContext?.bindingId)
        fail('RC012_CANARY_WORKER_OWNER_CHANGED');
      const k=await keyAttestor.resolveVerifiedWorkerKey();
      return deriveWorkerId({
        hostId:c.hostId,profileId:c.profileId,ownerSidHash:c.ownerSidHash,
        deviceProvider:k.deviceProvider,deviceIdHash:k.deviceIdHash,keyId:k.keyId
      });
    },
    // The production runtime MUST supply the validated host-global lease;
    // a factory without it has no fallback.
    withLease:none
  });
  return Object.freeze({
    port,identity:Object.freeze({
      hostId:enrolled.hostId,profileId:selected,principalId,
      expectedTunnelIdHash:signedBroker.expectedTunnelIdHash,
      expectedOwnerSidHash:osOwner,
      resolveTransportIdentity:signedBroker.resolveTransportIdentity
    }),
    tls:Object.freeze({
      certificatePem:privateFile(path.join(pairDir,'server.crt'),uid),
      privateKeyPem:privateFile(path.join(pairDir,'server.key'),uid),
      clientCaPem:privateFile(path.join(pairDir,'ca.crt'),uid),
      expectedClientLeafDerSha256:clientSha
    }),
    security:Object.freeze({
      directory:securityDir,
      ownerSessionOptions:Object.freeze({ownerIdentityMode:'host-uid-v2'}),
      issuer:'commander.local',audience:'remote-commander',
      nativeHostLeaseDirectory:commonLease,
      resolveTrustedWorkflowRoot:none,
      resolveOwnerRoute:async handle=>{
        if(handle!==pairHandle)fail('RC012_CANARY_PAIR_ROUTE_MISMATCH');
        return ownerRoute;
      },
      bindWorkerToNativeOwner:scope=>{
        stackRef=scope.ownerStack;
        return securityFactory(scope);
      },
      ownerAdminSocketPath:socketPath,
      createOwnerGrantAdministration:({ownerStack,identity,worker})=>
        createV012OwnerGrantAdministration({
          ownerStack,identity,workerAuthority:worker.workerAuthority,
          resolveVerifiedWorkerKey:keyAttestor.resolveVerifiedWorkerKey,
          resolvePinnedCanaryRoute:trustedRoute,
          resolveSignedWorkerEnvelope:({workerContext,grantRevision,expiresAtMs})=>
            signer.sign(Object.freeze({
              hostId:workerContext.hostId,profileId:workerContext.profileId,
              principalId:workerContext.principalId,
              conversationId:workerContext.conversationId,
              bindingId:workerContext.bindingId,
              ownerSidHash:workerContext.ownerSidHash,
              deviceIdHash:workerContext.deviceIdHash,
              tunnelIdHash:workerContext.tunnelIdHash,
              capabilityPolicyDigest:workerContext.capabilityPolicyDigest,
              grantRevision,expiresAtMs
            }))
        })
    })
  });
}
