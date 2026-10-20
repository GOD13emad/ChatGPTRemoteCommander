// PRIVATE QA ONLY: fail-closed session/lease control contract.
// Not connected to Core, WinSta0, MCP transport, real ChatGPT identity or GUI.
// The caller must inject a REAL trusted transport attestor, protected journal,
// and isolated native worker before production use. Caller-supplied identity
// strings and ordinary Windows same-SID process IDs are NOT attestations.
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KINDS=new Set(['click','move','drag','type','key','scroll']);
const fail=code=>Object.assign(new Error(code),{code});

export function createWindowsSessionBrokerQA({
  attest, journal, observeNative, dispatchNative, now=Date.now,
  maxLeaseMs=30_000, observationMaxAgeMs=15_000
}={}){
  if(typeof attest!=='function'||typeof journal?.execute!=='function'||
     typeof observeNative!=='function'||typeof dispatchNative!=='function'||
     typeof now!=='function'||!Number.isSafeInteger(maxLeaseMs)||maxLeaseMs<=0||
     !Number.isSafeInteger(observationMaxAgeMs)||observationMaxAgeMs<=0)
    throw fail('BROKER_DEPENDENCY_UNTRUSTED');
  const workspaces=new Map();
  const observations=new WeakMap();
  const leases=new WeakMap();
  let closed=false;

  function requireOpen(){
    if(closed)throw fail('BROKER_CLOSED');
  }
  function authenticate(context,workspaceRef){
    requireOpen();
    if(!HEX.test(workspaceRef??''))throw fail('BROKER_WORKSPACE_INVALID');
    // Attestation MUST be a trusted adapter output, never a body/clientInfo
    // claim. This QA implementation cannot establish that trust itself.
    const identity=attest(context);
    if(!identity||typeof identity.principalId!=='string'||
       !ID.test(identity.principalId)||!ID.test(identity.sessionId??'')||
       !['agent','supervisor'].includes(identity.role)||
       !Array.isArray(identity.allowedWorkspaces)||
       !identity.allowedWorkspaces.includes(workspaceRef))
      throw fail('BROKER_UNAUTHENTICATED');
    return identity;
  }
  function state(workspaceRef){
    let s=workspaces.get(workspaceRef);
    if(!s){
      s={revision:0,control:null,busy:false};
      workspaces.set(workspaceRef,s);
    }
    return s;
  }
  function requireLease(lease,context){
    if(typeof lease!=='object'||lease===null)throw fail('BROKER_LEASE_INVALID');
    const l=leases.get(lease);
    if(!l)throw fail('BROKER_LEASE_INVALID');
    const identity=authenticate(context,l.workspaceRef);
    if(identity.principalId!==l.principalId||identity.sessionId!==l.sessionId||
       identity.role!==l.role)throw fail('BROKER_LEASE_OWNER_MISMATCH');
    const s=state(l.workspaceRef);
    if(s.control!==lease||s.revision!==l.revision||l.used||
       !Number.isFinite(now())||now()>=l.expiresAt)
      throw fail('BROKER_LEASE_STALE');
    return {l,s};
  }
  return Object.freeze({
    async observe({context,workspaceRef}={}){
      const identity=authenticate(context,workspaceRef);
      const s=state(workspaceRef);
      if(s.busy)throw fail('BROKER_WORKSPACE_BUSY');
      const at=s.revision;
      // Frame digests originate ONLY from the trusted isolated worker.
      const frame=await observeNative({workspaceRef});
      const rechecked=authenticate(context,workspaceRef);
      if(rechecked.principalId!==identity.principalId||
         rechecked.sessionId!==identity.sessionId||rechecked.role!==identity.role)
        throw fail('BROKER_OBSERVATION_OWNER_MISMATCH');
      if(closed||s.busy||s.revision!==at)
        throw fail('BROKER_OBSERVATION_STALE');
      if(!frame||!HEX.test(frame.sha256??''))
        throw fail('BROKER_FRAME_INVALID');
      // A transient private Desktop observation is not a live input target.
      // The QA broker authorizes effects ONLY for explicitly labelled
      // simulated workers. There is no native-input mode in this QA.
      const effectMode=frame.effectMode==='qa-simulated'
        ?'qa-simulated':'observation-only';
      const proof=Object.freeze({workspaceRef,frameSha256:frame.sha256,
        effectMode});
      observations.set(proof,{workspaceRef,principalId:identity.principalId,
        sessionId:identity.sessionId,role:identity.role,effectMode,revision:at,observedAt:now(),used:false});
      return proof;
    },
    acquire({context,observation,ttlMs=maxLeaseMs}={}){
      requireOpen();
      if(typeof observation!=='object'||observation===null)
        throw fail('BROKER_OBSERVATION_INVALID');
      const o=observations.get(observation);
      if(!o)throw fail('BROKER_OBSERVATION_INVALID');
      const identity=authenticate(context,o.workspaceRef);
      const s=state(o.workspaceRef);
      if(o.principalId!==identity.principalId||o.sessionId!==identity.sessionId||
         o.role!==identity.role)
        throw fail('BROKER_OBSERVATION_OWNER_MISMATCH');
      if(o.effectMode!=='qa-simulated')
        throw fail('BROKER_OBSERVATION_NON_ACTIONABLE');
      if(o.used||o.revision!==s.revision||s.busy||!Number.isFinite(now())||
         now()-o.observedAt>observationMaxAgeMs||now()<o.observedAt)
        throw fail('BROKER_OBSERVATION_STALE');
      if(!Number.isSafeInteger(ttlMs)||ttlMs<=0||ttlMs>maxLeaseMs)
        throw fail('BROKER_TTL_INVALID');
      if(s.control) {
        const prior=leases.get(s.control);
        if(prior&&!prior.used&&now()<prior.expiresAt)
          throw fail('BROKER_CONTROL_BUSY');
        s.control=null;
      }
      o.used=true;
      const lease=Object.freeze({workspaceRef:o.workspaceRef});
      leases.set(lease,{workspaceRef:o.workspaceRef,principalId:o.principalId,
        sessionId:o.sessionId,role:o.role,revision:s.revision,expiresAt:now()+ttlMs,used:false});
      s.control=lease;
      return lease;
    },
    async execute({context,lease,operationId,kind,expectedWorkspaceRef}={}){
      requireOpen();
      const {l,s}=requireLease(lease,context);
      if(expectedWorkspaceRef!==undefined&&expectedWorkspaceRef!==l.workspaceRef)
        throw fail('BROKER_WORKSPACE_MISMATCH');
      if(!ID.test(operationId??'')||!KINDS.has(kind))
        throw fail('BROKER_ACTION_INVALID');
      if(s.busy)throw fail('BROKER_WORKSPACE_BUSY');
      l.used=true; // One observation and one lease authorize at most one action.
      s.busy=true;
      let effectRequested=false;
      try{
        return await journal.execute({
          workspaceRef:l.workspaceRef,operationId,kind
        },()=>{
          // The protected Journal may await I/O before invoking its effect.
          // Recheck authorization and expiry at the actual dispatch boundary.
          // One prepared intent may dispatch the native effect only once.
          if(effectRequested)throw fail('BROKER_EFFECT_ALREADY_REQUESTED');
          effectRequested=true;
          const current=now();
          if(closed||s.control!==lease||s.revision!==l.revision||
             !s.busy||!Number.isFinite(current)||current>=l.expiresAt)
            throw fail('BROKER_LEASE_STALE');
          const identity=authenticate(context,l.workspaceRef);
          if(identity.principalId!==l.principalId||
             identity.sessionId!==l.sessionId||identity.role!==l.role)
            throw fail('BROKER_LEASE_OWNER_MISMATCH');
          return dispatchNative({workspaceRef:l.workspaceRef,operationId,kind});
        });
      }finally{
        s.busy=false;
        s.control=null;
        s.revision++; // Requires fresh observation after every attempt/unknown.
      }
    },
    takeover({context,workspaceRef}={}){
      const identity=authenticate(context,workspaceRef);
      if(identity.role!=='supervisor')throw fail('BROKER_SUPERVISOR_REQUIRED');
      const s=state(workspaceRef);
      if(s.busy)throw fail('BROKER_WORKSPACE_BUSY');
      s.control=null;
      s.revision++;
      return Object.freeze({workspaceRef,requiresNewObservation:true});
    },
    release({context,lease}={}){
      requireOpen();
      const {s}=requireLease(lease,context);
      if(s.busy)throw fail('BROKER_WORKSPACE_BUSY');
      s.control=null;
      s.revision++;
      return true;
    },
    close(){
      if([...workspaces.values()].some(s=>s.busy))
        throw fail('BROKER_WORKSPACE_BUSY');
      closed=true;
      for(const s of workspaces.values()){
        s.control=null;
        s.revision++;
      }
    }
  });
}
