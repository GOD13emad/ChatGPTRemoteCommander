// INTERNAL QA CONTRACT — not imported by the installed Commander Core.
// Native OS workspace launcher and authenticated supervisor are intentionally
// absent by default. Never treat an opaque lease or caller label as identity.
// This is in-process coordination, NOT a cross-account/OS security boundary.
import {createHash, randomBytes} from 'node:crypto';

const hex64=/^[a-f0-9]{64}$/;
const subjectPattern=/^[A-Za-z0-9._:@-]{1,128}$/;
const kinds=new Set(['click','move','drag','type','key','scroll']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const issue=()=>randomBytes(32).toString('hex');
const fail=code=>Object.assign(new Error(code),{code});
const seconds=(n,lo,hi)=>{
  if(!Number.isInteger(n)||n<lo||n>hi)throw fail('NATIVE_WORKSPACE_TTL_INVALID');
  return n*1000;
};
const frameOf=value=>{
  if(!value||typeof value!=='object')throw fail('NATIVE_WORKSPACE_FRAME_MISSING');
  if(!['image/png','image/jpeg'].includes(value.mimeType)||
      typeof value.data!=='string'||value.data.length===0||
      value.data.length>1398104||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data))
    throw fail('NATIVE_WORKSPACE_FRAME_INVALID');
  const bytes=Buffer.from(value.data,'base64');
  const png=Buffer.from('89504e470d0a1a0a','hex');
  if(bytes.length>1048576||bytes.toString('base64')!==value.data||
      (value.mimeType==='image/png'&&!bytes.subarray(0,8).equals(png))||
      (value.mimeType==='image/jpeg'&&
       (bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)))
    throw fail('NATIVE_WORKSPACE_FRAME_INVALID');
  return {mimeType:value.mimeType,data:value.data};
};
const actionOf=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
      !(Object.getPrototypeOf(value)===Object.prototype||
        Object.getPrototypeOf(value)===null)||!kinds.has(value.kind))
    throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  const shape={
    click:['kind','x','y','button','count'],
    move:['kind','x','y'],
    drag:['kind','from','to','button','durationMs'],
    type:['kind','text'],key:['kind','key'],scroll:['kind','delta']
  }[value.kind];
  if(Object.keys(value).some(key=>!shape.includes(key)))
    throw fail('NATIVE_WORKSPACE_TARGET_OVERRIDE_DENIED');
  const safePoint=p=>p&&typeof p==='object'&&!Array.isArray(p)&&
    Object.keys(p).length===2&&
    Object.hasOwn(p,'x')&&Object.hasOwn(p,'y')&&
    Number.isInteger(p.x)&&Number.isInteger(p.y)&&
    p.x>=0&&p.x<=65535&&p.y>=0&&p.y<=65535;
  const safeButton=b=>b===undefined||(Number.isInteger(b)&&b>=1&&b<=3);
  if((value.kind==='click'||value.kind==='move')&&
      !safePoint({x:value.x,y:value.y}))
    throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  if(value.kind==='click'&&(!safeButton(value.button)||
      (value.count!==undefined&&value.count!==1&&value.count!==2)))
    throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  if(value.kind==='drag'&&
     (!safePoint(value.from)||!safePoint(value.to)||!safeButton(value.button)||
      (value.durationMs!==undefined&&
       (!Number.isInteger(value.durationMs)||value.durationMs<80||
        value.durationMs>2000))))
    throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  if(value.kind==='type'&&
      (typeof value.text!=='string'||value.text.length<1||
       value.text.length>4096||value.text.includes('\u0000')))
    throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  if(value.kind==='key'&&
      !['Return','Escape','Tab','BackSpace','Up','Down','Left','Right',
         'space','Delete','Home','End','Page_Up','Page_Down',
         'ctrl+a','ctrl+c','ctrl+v','ctrl+s','ctrl+z','shift+Tab']
        .includes(value.key))throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  if(value.kind==='scroll'&&
      (!Number.isInteger(value.delta)||value.delta===0||
       Math.abs(value.delta)>20))throw fail('NATIVE_WORKSPACE_ACTION_INVALID');
  return {...value};
};

// The identityResolver must be supplied by a separately authenticated Core
// adapter. Passing user-supplied profile labels or MCP args is NOT compliant.
// The backend must independently verify its own OS display/process ownership.
// No MCP tools, port, auto-runner, desktop focus or GUI input are registered.
export function createNativeWorkspaceCoordinator({
  identityResolver=()=>null,
  launchWorkspace=async()=>{throw fail('NATIVE_WORKSPACE_BACKEND_UNCONFIGURED');},
  authorizeObserver=()=>false,
  authorizeHandoff=()=>false,
  durableJournalFactory=async()=>null,
  clock=()=>performance.now(),
  token=issue,
  capacity=3
}={}){
  if(!Number.isInteger(capacity)||capacity<1||capacity>8)
    throw fail('NATIVE_WORKSPACE_CAPACITY_INVALID');
  const workers=new Map();
  const observers=new Map();
  const reservedLeases=new Set();
  const starting=new Set();
  const cleanupFailures=[];
  let reservations=0,closed=false;

  const now=()=>clock();
  const subject=ctx=>{
    let id;
    try{id=identityResolver(ctx);}catch{throw fail('NATIVE_WORKSPACE_IDENTITY_UNVERIFIED');}
    if(!id||id.authenticated!==true||id.conversationBound!==true||
        typeof id.subject!=='string'||!subjectPattern.test(id.subject)||
        typeof id.conversationId!=='string'||!subjectPattern.test(id.conversationId))
      throw fail('NATIVE_WORKSPACE_IDENTITY_UNVERIFIED');
    // Profile alone cannot bind different chats sharing one OS user.
    return id.subject+'|'+id.conversationId;
  };
  const checkOpen=()=>{
    if(closed)throw fail('NATIVE_WORKSPACE_POOL_CLOSED');
  };
  const clearGrants=entry=>{
    for(const [key,grant] of observers){
      if(grant.lease===entry.lease)observers.delete(key);
    }
    entry.handoff=null;
    entry.frame=null;
  };
  async function dispose(entry){
    if(entry.disposal)return entry.disposal;
    if(entry.busy)throw fail('NATIVE_WORKSPACE_BUSY');
    entry.disposing=true;
    clearGrants(entry);
    // Keep capacity reserved until native worker has *actually* exited.
    // A failed close stays quarantined; never blindly free/reuse its slot.
    entry.disposal=Promise.resolve().then(()=>entry.worker.close()).then(()=>{
      if(workers.get(entry.lease)===entry)workers.delete(entry.lease);
    }).catch(()=>{
      cleanupFailures.push(digest(entry.lease));
      throw fail('NATIVE_WORKSPACE_CLEANUP_FAILED');
    });
    return entry.disposal;
  }
  function expireGrant(entry){
    if(entry.handoff&&entry.handoff.expiresAt<=now()){
      entry.handoff=null;
      entry.needsOwnerObservation=true;
      entry.operatorObserved=-1;
    }
  }
  function sweep(){
    for(const entry of workers.values()){
      expireGrant(entry);
      if(entry.expiresAt<=now()&&!entry.disposing){
        if(entry.busy)entry.expireAfterIdle=true;
        else void dispose(entry).catch(()=>{});
      }
    }
    for(const [key,grant] of observers){
      if(grant.expiresAt<=now())observers.delete(key);
    }
    // A cached GUI image must not outlive its last authorized observer.
    for(const entry of workers.values()){
      if(entry.frame&&![...observers.values()].some(
        g=>g.lease===entry.lease&&g.expiresAt>now()))
        entry.frame=null;
    }
  }
  function getOwned(ctx,lease){
    checkOpen();
    const who=subject(ctx);
    sweep();
    if(typeof lease!=='string'||!hex64.test(lease))throw fail('NATIVE_WORKSPACE_LEASE_DENIED');
    const entry=workers.get(lease);
    if(!entry||entry.owner!==who||entry.disposing||entry.expiresAt<=now())
      throw fail('NATIVE_WORKSPACE_LEASE_DENIED');
    expireGrant(entry);
    return entry;
  }
  const withBusy=async(entry,task)=>{
    if(entry.disposing||closed)throw fail('NATIVE_WORKSPACE_POOL_CLOSED');
    if(entry.busy)throw fail('NATIVE_WORKSPACE_BUSY');
    const pending=Promise.resolve().then(task);
    entry.busy=pending;
    try{return await pending;}
    finally{
      if(entry.busy===pending)entry.busy=null;
      if(entry.expireAfterIdle||entry.expiresAt<=now()||closed)
        void dispose(entry).catch(()=>{});
    }
  };
  async function open(ctx,{ttlSeconds=120}={}){
    checkOpen();
    const owner=subject(ctx);
    const ttl=seconds(ttlSeconds,30,600);
    sweep();
    if(workers.size+reservations>=capacity)throw fail('NATIVE_WORKSPACE_CAPACITY');
    reservations++;
    let lease;
    try{lease=token();}catch{
      reservations--;
      throw fail('NATIVE_WORKSPACE_TOKEN_UNAVAILABLE');
    }
    if(typeof lease!=='string'||!hex64.test(lease)||
       workers.has(lease)||reservedLeases.has(lease)){
      reservations--;
      throw fail('NATIVE_WORKSPACE_LEASE_COLLISION');
    }
    reservedLeases.add(lease);
    const workspaceRef=digest(lease);
    const pending=(async()=>{
      let worker=null;
      try{
        worker=await launchWorkspace({workspaceRef});
        if(!worker||worker.kind!=='native-private-x11'||
           worker.physicalDesktopInput!==false||
           !/^:[0-9]{1,5}$/.test(worker.displayId||'')||
           worker.displayId===process.env.DISPLAY||
           !Number.isSafeInteger(worker.serverPid)||worker.serverPid<2||
           typeof worker.observe!=='function'||
           typeof worker.input!=='function'||
           typeof worker.close!=='function')
          throw fail('NATIVE_WORKSPACE_BACKEND_UNTRUSTED');
        const conflict=[...workers.values()].find(e=>
          e.worker===worker||e.worker.displayId===worker.displayId||
          e.worker.serverPid===worker.serverPid);
        if(conflict){
          // A distinct JS wrapper may still reference the *same* OS server.
          // Do not invoke its close: that could kill the existing owner's GUI.
          // Quarantine and report unresolved native cleanup for manual review.
          worker=null;
          cleanupFailures.push(workspaceRef);
          throw fail('NATIVE_WORKSPACE_TARGET_COLLISION');
        }
        if(closed)throw fail('NATIVE_WORKSPACE_POOL_CLOSED');
        // Native mutation remains disabled without an explicit journal.
        // The journal factory must come from the trusted local Core adapter,
        // not an MCP caller or chat message.
        const journal=await durableJournalFactory({workspaceRef,
          ownerRef:digest(owner),backendRef:digest(worker.displayId)});
        if(journal!==null&&(!journal||
           typeof journal.prepare!=='function'||
           typeof journal.acknowledge!=='function'||
           typeof journal.inspect!=='function'))
          throw fail('NATIVE_WORKSPACE_JOURNAL_UNTRUSTED');
        if(closed)throw fail('NATIVE_WORKSPACE_POOL_CLOSED');
        const entry={lease,owner,workspaceRef,worker,journal,expiresAt:now()+ttl,
          revision:0,ownerObserved:-1,operatorObserved:-1,
          needsOwnerObservation:true,uncertain:false,frame:null,handoff:null,
          busy:null,disposal:null,disposing:false,expireAfterIdle:false};
        workers.set(lease,entry);
        return {lease,workspaceRef,expiresInSeconds:ttlSeconds,
          backend:'native-private-x11',privateDisplay:true,
          physicalDesktopInput:false,observerAuthorization:'DENY_BY_DEFAULT'};
      }catch(error){
        if(worker&&typeof worker.close==='function'){
          try{await worker.close();}catch{cleanupFailures.push(workspaceRef);}
        }
        throw error;
      }finally{reservations--;reservedLeases.delete(lease);}
    })();
    starting.add(pending);
    pending.then(()=>starting.delete(pending),()=>starting.delete(pending));
    return pending;
  }
  async function observeOwner(ctx,lease){
    const entry=getOwned(ctx,lease);
    return withBusy(entry,async()=>{
      const snapshot=await entry.worker.observe();
      const frame=frameOf(snapshot?.frame);
      entry.ownerObserved=entry.revision;
      // Observation during operator handoff never authorizes resumed owner input.
      if(!entry.handoff)entry.needsOwnerObservation=false;
      cacheFrame(entry,frame);
      return {revision:entry.revision,frame,
        mayInput:!entry.needsOwnerObservation&&!entry.handoff&&!entry.uncertain};
    });
  }
  function cacheFrame(entry,frame){
    const hasObserver=[...observers.values()].some(g=>g.lease===entry.lease&&
      g.expiresAt>now());
    if(hasObserver)entry.frame={...frame,revision:entry.revision,at:now()};
    else entry.frame=null;
  }
  async function input(entry,action,operationId){
    const validated=actionOf(action);
    // Require a stable logical action key; a transport retry must not choose
    // a new key and accidentally dispatch the same native input twice.
    if(typeof operationId!=='string'||
       !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationId))
      throw fail('NATIVE_WORKSPACE_OPERATION_ID_REQUIRED');
    return withBusy(entry,async()=>{
      if(!entry.journal)throw fail('NATIVE_WORKSPACE_DURABLE_JOURNAL_REQUIRED');
      let handle;
      try{
        handle=await entry.journal.prepare({
          workspaceRef:entry.workspaceRef,operationId,
          kind:validated.kind,revision:entry.revision
        });
      }catch(error){
        if(error?.code==='NATIVE_JOURNAL_DUPLICATE_OPERATION')
          throw fail('NATIVE_WORKSPACE_DUPLICATE_OPERATION_NO_DISPATCH');
        // A failed journal write can leave a partial pending record.
        // Even though the native helper has not been invoked, fail closed.
        entry.uncertain=true;
        entry.needsOwnerObservation=true;
        entry.operatorObserved=-1;
        throw fail('NATIVE_WORKSPACE_JOURNAL_UNAVAILABLE_NO_INPUT');
      }
      try{
        const result=await entry.worker.input(validated);
        if(result?.submitted!==true)
          throw fail('NATIVE_WORKSPACE_NATIVE_OUTCOME_UNKNOWN');
        await entry.journal.acknowledge(handle);
      }catch{
        // The call may have reached a private native GUI. No retry or
        // same-user marker can release this pending operation.
        entry.uncertain=true;
        entry.revision++;
        entry.needsOwnerObservation=true;
        entry.operatorObserved=-1;
        throw fail('NATIVE_WORKSPACE_NATIVE_OUTCOME_UNKNOWN');
      }
      entry.revision++;
      entry.needsOwnerObservation=true;
      entry.operatorObserved=-1;
      return {submitted:true,nativeEffectConfirmed:false,
        revision:entry.revision,reobserveRequired:true};
    });
  }
  async function inputOwner(ctx,lease,action,{expectedRevision,operationId}={}){
    const entry=getOwned(ctx,lease);
    if(entry.uncertain)throw fail('NATIVE_WORKSPACE_UNCERTAIN_NO_REPLAY');
    if(entry.handoff)throw fail('NATIVE_WORKSPACE_CONTROL_HELD');
    if(entry.needsOwnerObservation||entry.ownerObserved!==entry.revision||
       expectedRevision!==entry.revision)
      throw fail('NATIVE_WORKSPACE_REOBSERVATION_REQUIRED');
    return input(entry,action,operationId);
  }
  async function grantObserver(ownerCtx,lease,viewerCtx,{ttlSeconds=60,approval}={}){
    const entry=getOwned(ownerCtx,lease),viewer=subject(viewerCtx);
    const ttl=seconds(ttlSeconds,10,180);
    if(observers.size>=16||[...observers.values()].filter(g=>g.lease===lease).length>=4)
      throw fail('NATIVE_WORKSPACE_OBSERVER_CAPACITY');
    let authorized=false;
    try{authorized=await authorizeObserver({
      ownerRef:digest(entry.owner),viewerRef:digest(viewer),
      workspaceRef:entry.workspaceRef,
      backendRef:digest(entry.worker.displayId+'\0'+entry.worker.serverPid),
      ttlSeconds,approval})===true;
    }catch{/* fail closed */}
    sweep();
    if(!authorized||closed||entry.disposing||
       workers.get(lease)!==entry||entry.expiresAt<=now())
      throw fail('NATIVE_WORKSPACE_OBSERVER_DENIED');
    if(observers.size>=16||[...observers.values()].filter(g=>g.lease===lease).length>=4)
      throw fail('NATIVE_WORKSPACE_OBSERVER_CAPACITY');
    const viewerToken=token();
    if(!hex64.test(viewerToken)||observers.has(digest(viewerToken)))
      throw fail('NATIVE_WORKSPACE_TOKEN_COLLISION');
    observers.set(digest(viewerToken),{lease,viewer,expiresAt:Math.min(entry.expiresAt,now()+ttl)});
    return {viewerToken,workspaceRef:entry.workspaceRef,
      canInput:false,canAcquireFocus:false};
  }
  function readObserver(viewerCtx,viewerToken){
    checkOpen();
    const viewer=subject(viewerCtx);
    sweep();
    if(typeof viewerToken!=='string'||!hex64.test(viewerToken))
      throw fail('NATIVE_WORKSPACE_OBSERVER_DENIED');
    const grant=observers.get(digest(viewerToken));
    const entry=grant?workers.get(grant.lease):null;
    if(!grant||grant.viewer!==viewer||grant.expiresAt<=now()||
       !entry||entry.disposing||entry.expiresAt<=now())
      throw fail('NATIVE_WORKSPACE_OBSERVER_DENIED');
    if(!entry.frame)throw fail('NATIVE_WORKSPACE_FRAME_UNAVAILABLE');
    return {mimeType:entry.frame.mimeType,data:entry.frame.data,
      workspaceRef:entry.workspaceRef,frameRevision:entry.frame.revision,
      currentRevision:entry.revision,
      stale:!!entry.busy||!!entry.handoff||
        entry.frame.revision!==entry.revision||now()-entry.frame.at>30000,
      canInput:false};
  }
  function revokeObserver(ownerCtx,lease,viewerToken){
    const entry=getOwned(ownerCtx,lease);
    if(typeof viewerToken!=='string'||!hex64.test(viewerToken))
      throw fail('NATIVE_WORKSPACE_OBSERVER_DENIED');
    const key=digest(viewerToken);
    const grant=observers.get(key);
    if(!grant||grant.lease!==entry.lease)throw fail('NATIVE_WORKSPACE_OBSERVER_DENIED');
    observers.delete(key);
    if(![...observers.values()].some(g=>g.lease===lease))entry.frame=null;
    return {revoked:true,canInput:false};
  }
  async function beginHandoff(ownerCtx,lease,operatorCtx,{ttlSeconds=45,approval}={}){
    const entry=getOwned(ownerCtx,lease),operator=subject(operatorCtx);
    const ttl=seconds(ttlSeconds,10,120);
    if(entry.busy)throw fail('NATIVE_WORKSPACE_BUSY');
    if(entry.handoff)throw fail('NATIVE_WORKSPACE_CONTROL_HELD');
    if(entry.uncertain)throw fail('NATIVE_WORKSPACE_UNCERTAIN_NO_REPLAY');
    let authorized=false;
    try{authorized=await authorizeHandoff({
      ownerRef:digest(entry.owner),operatorRef:digest(operator),
      workspaceRef:entry.workspaceRef,
      backendRef:digest(entry.worker.displayId+'\0'+entry.worker.serverPid),
      ttlSeconds,approval})===true;
    }catch{/* fail closed */}
    sweep();
    if(!authorized||closed||entry.disposing||entry.busy||
       workers.get(lease)!==entry||entry.handoff||entry.expiresAt<=now())
      throw fail('NATIVE_WORKSPACE_HANDOFF_DENIED');
    const controlToken=token();
    if(!hex64.test(controlToken))throw fail('NATIVE_WORKSPACE_TOKEN_COLLISION');
    entry.handoff={key:digest(controlToken),operator,expiresAt:Math.min(entry.expiresAt,now()+ttl)};
    entry.operatorObserved=-1;
    entry.needsOwnerObservation=true;
    return {controlToken,workspaceRef:entry.workspaceRef,
      physicalDesktopInput:false,ownerInputPaused:true};
  }
  function controlEntry(operatorCtx,controlToken){
    checkOpen();
    const operator=subject(operatorCtx);
    sweep();
    if(typeof controlToken!=='string'||!hex64.test(controlToken))
      throw fail('NATIVE_WORKSPACE_CONTROL_DENIED');
    const key=digest(controlToken);
    const entry=[...workers.values()].find(e=>e.handoff?.key===key);
    if(!entry||entry.disposing||entry.handoff.operator!==operator||
       entry.handoff.expiresAt<=now()||entry.expiresAt<=now())
      throw fail('NATIVE_WORKSPACE_CONTROL_DENIED');
    return entry;
  }
  async function observeOperator(ctx,controlToken){
    const entry=controlEntry(ctx,controlToken);
    return withBusy(entry,async()=>{
      const frame=frameOf((await entry.worker.observe())?.frame);
      entry.operatorObserved=entry.revision;
      cacheFrame(entry,frame);
      return {revision:entry.revision,frame,ownerInputPaused:true};
    });
  }
  async function inputOperator(ctx,controlToken,action,{expectedRevision,operationId}={}){
    const entry=controlEntry(ctx,controlToken);
    if(entry.uncertain)throw fail('NATIVE_WORKSPACE_UNCERTAIN_NO_REPLAY');
    if(entry.operatorObserved!==entry.revision||expectedRevision!==entry.revision)
      throw fail('NATIVE_WORKSPACE_REOBSERVATION_REQUIRED');
    return input(entry,action,operationId);
  }
  function endHandoff(ctx,controlToken){
    const entry=controlEntry(ctx,controlToken);
    if(entry.busy)throw fail('NATIVE_WORKSPACE_BUSY');
    entry.handoff=null;
    entry.needsOwnerObservation=true;
    entry.operatorObserved=-1;
    return {released:true,ownerReobserveRequired:true};
  }
  function revokeHandoff(ownerCtx,lease){
    const entry=getOwned(ownerCtx,lease);
    if(entry.busy)throw fail('NATIVE_WORKSPACE_BUSY');
    const revoked=!!entry.handoff;
    entry.handoff=null;
    entry.needsOwnerObservation=true;
    entry.operatorObserved=-1;
    return {revoked,ownerReobserveRequired:true};
  }
  async function end(ownerCtx,lease){
    const entry=getOwned(ownerCtx,lease);
    if(entry.busy)throw fail('NATIVE_WORKSPACE_BUSY');
    if(entry.handoff)throw fail('NATIVE_WORKSPACE_CONTROL_HELD');
    await dispose(entry);
    return {closed:true};
  }
  function status(ctx){
    checkOpen();
    const owner=subject(ctx);
    sweep();
    return {ownedWorkspaces:[...workers.values()].filter(e=>e.owner===owner&&!e.disposing).length,
      capacity,availableSlots:Math.max(0,capacity-workers.size-reservations),
      cleanupFailures:cleanupFailures.length,productionIntegrated:false};
  }
  async function close(){
    if(closed)return;
    closed=true;
    await Promise.allSettled([...starting]);
    await Promise.allSettled([...workers.values()].map(e=>e.busy).filter(Boolean));
    const result=await Promise.allSettled([...workers.values()].map(dispose));
    if(result.some(x=>x.status==='rejected')||cleanupFailures.length)
      throw fail('NATIVE_WORKSPACE_POOL_CLEANUP_FAILED');
  }
  return {open,observeOwner,inputOwner,grantObserver,readObserver,revokeObserver,
    beginHandoff,observeOperator,inputOperator,endHandoff,revokeHandoff,
    end,status,close};
}
