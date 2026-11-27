import os from 'node:os';
import path from 'node:path';
import { mkdir, lstat, chmod, writeFile, rename, unlink, opendir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ensureWindowsMonitorDirectories } from './browser-companion-windows-private.mjs';

const MAX_BYTES = 64 * 1024;

export function defaultBrowserCompanionRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    return local ? path.win32.join(local, 'ChatGPTRemoteCommander', 'browser-companion') : '';
  }
  const state = env.XDG_STATE_HOME;
  return state ? path.posix.join(state, 'chatgpt-remote-commander', 'browser-companion')
    : path.posix.join(home, '.local', 'state', 'chatgpt-remote-commander', 'browser-companion');
}

// Keep the existing base for the native CEF reader, but never publish a
// running Core's monitor to the shared legacy filename. Exact profile + port
// is stable across restarts, separates preview/default/other instances, and
// cannot be interpreted as a filesystem path (including on Windows).
export function browserCompanionInstanceRoot(base, instance, { platform = process.platform } = {}) {
  const flavor = platform === 'win32' ? path.win32 : path.posix;
  if (typeof base !== 'string' || !flavor.isAbsolute(base)) throw new Error('BROWSER_COMPANION_ROOT_INVALID');
  const profile = instance?.profile, port = instance?.port;
  if (typeof profile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(profile) ||
      !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('BROWSER_COMPANION_INSTANCE_INVALID');
  const id = createHash('sha256').update(JSON.stringify([profile, port])).digest('hex');
  return flavor.join(base, 'instances', id);
}

async function provePrivateRoot(root, { platform = process.platform } = {}) {
  const flavor = platform === 'win32' ? path.win32 : path.posix;
  if (!root || !flavor.isAbsolute(root)) throw new Error('BROWSER_COMPANION_ROOT_INVALID');
  if (platform === 'win32') {
    await ensureWindowsMonitorDirectories([root]);
    return root;
  }
  // Validate existing roots before changing permissions or writing. Do not
  // chmod an existing symlink, shared directory, or foreign-owned directory.
  let stat;
  try { stat = await lstat(root); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(root, { recursive: true, ...(platform === 'win32' ? {} : { mode: 0o700 }) });
    stat = await lstat(root);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('BROWSER_COMPANION_ROOT_UNSAFE');
  if (platform !== 'win32') {
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('BROWSER_COMPANION_ROOT_OWNER_MISMATCH');
    if ((stat.mode & 0o077) !== 0) throw new Error('BROWSER_COMPANION_ROOT_NOT_PRIVATE');
  }
  return root;
}

export function sanitizeMonitorSnapshot(input, now = Date.now()) {
  const text = (value, limit = 160) => {
    if (typeof value !== 'string') return '';
    let out = '';
    for (let i = 0; i < value.length && out.length < limit; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          if (out.length + 2 > limit) break;
          out += value[i] + value[++i];
        } else out += '\uFFFD';
      } else if (code >= 0xDC00 && code <= 0xDFFF) out += '\uFFFD';
      else out += value[i];
    }
    return out;
  };
  const optionalText = value => {
    const normalized = text(value);
    return normalized ? normalized : null;
  };
  const truth = value => value === true;
  const cap = input?.gui?.capabilities ?? {};
  const guiPolicy = input?.gui?.policy ?? {};
  const capability = (name, policyName) =>
    Object.prototype.hasOwnProperty.call(cap, name) ? truth(cap[name]) : truth(guiPolicy[policyName]);
  const extensions = Array.isArray(input?.extensions?.items) ? input.extensions.items.slice(0, 32).map(item => ({
    id: text(item?.id, 64),
    version: text(item?.version, 64)
  })).filter(item => item.id) : [];
  return {
    schema: 1,
    kind: 'COMMANDER_LIVE_MONITOR',
    observedAtEpochMs: now,
    expiresAtEpochMs: now + 10000,
    identity: {
      deviceName: text(input?.identity?.deviceName),
      profile: text(input?.identity?.profile),
      version: text(input?.identity?.version, 64),
      configSha256: /^[a-f0-9]{64}$/.test(input?.identity?.configSha256 ?? '') ? input.identity.configSha256 : '',
      port: Number.isSafeInteger(input?.identity?.port) ? input.identity.port : 0,
      platform: text(input?.identity?.platform)
    },
    gui: {
      enabled: truth(input?.gui?.enabled),
      available: truth(input?.gui?.available),
      uncertain: truth(input?.gui?.uncertain),
      backend: optionalText(input?.gui?.backend),
      sessionType: optionalText(input?.gui?.sessionType),
      reason: optionalText(input?.gui?.reason),
      capabilities: {
        screenshot: capability('screenshot', 'allowScreenshot'),
        mouse: capability('mouse', 'allowMouse'),
        keyboard: capability('keyboard', 'allowKeyboard'),
        focus: capability('focus', 'allowWindowFocus')
      }
    },
    browser: {
      enabled: truth(input?.browser?.enabled),
      available: truth(input?.browser?.available),
      uncertain: truth(input?.browser?.uncertain),
      backend: optionalText(input?.browser?.backend),
      reason: optionalText(input?.browser?.reason)
    },
    workflows: {
      enabled: truth(input?.workflows?.enabled),
      engineEnabled: truth(input?.workflows?.engineEnabled),
      runCount: Number.isInteger(input?.workflows?.runCount) ? Math.max(0, Math.min(input.workflows.runCount, 10000)) : 0
    },
    extensions: { count: extensions.length, items: extensions },
    operations: {
      active: Number.isSafeInteger(input?.operations?.active) ? Math.max(0, input.operations.active) : 0,
      lockedKeys: Number.isSafeInteger(input?.operations?.lockedKeys) ? Math.max(0, input.operations.lockedKeys) : 0
    }
  };
}

// Optional generic relay observation only. Never invoke or configure an adapter here.
function sanitizeRelayObservation(value) {
  const unknown = {state:'UNVERIFIED',extensionId:null,attempts:0,relayProcessExitedZero:0,dropped:0,inFlight:false,deliveryConfirmed:false};
  const count = n => Number.isSafeInteger(n) && n >= 0;
  if (!value || typeof value.enabled !== 'boolean' || typeof value.ready !== 'boolean' ||
      typeof value.inFlight !== 'boolean' || value.deliveryConfirmed !== false ||
      !count(value.attempts) || !count(value.relayProcessExitedZero) || !count(value.dropped) ||
      value.relayProcessExitedZero > value.attempts ||
      (value.extensionId !== null && (typeof value.extensionId !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(value.extensionId))) ||
      (value.ready && (!value.enabled || !value.extensionId)) ||
      (!value.enabled && (value.inFlight || value.attempts || value.relayProcessExitedZero || value.dropped))) return unknown;
  return {state:!value.enabled?'DISABLED':value.ready?'PIN_READY':'NOT_READY',
    extensionId:value.extensionId,attempts:value.attempts,relayProcessExitedZero:value.relayProcessExitedZero,
    dropped:value.dropped,inFlight:value.inFlight,deliveryConfirmed:false};
}

// Separate additive schema: older strict monitor readers still receive monitor schema 1 unchanged.
export function sanitizeWorkspaceSnapshot(input, monitor) {
  const {profile,port,configSha256} = monitor.identity;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(profile) ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      !/^[a-f0-9]{64}$/.test(configSha256)) return null;
  const page = input?.workspace;
  const rows = page?.workflows;
  const ids = new Set();
  const valid = Array.isArray(rows) && rows.length <= 8 && typeof page.hasMore === 'boolean' &&
    rows.every(item => {
      if (!item || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(item.id) ||
          ids.has(item.id) || !Number.isSafeInteger(item.revision) || item.revision < 0 ||
          typeof item.lifecycle !== 'string' || !/^[A-Z][A-Z0-9_]{0,39}$/.test(item.lifecycle) ||
          typeof item.schedulerEnabled !== 'boolean') return false;
      ids.add(item.id); return true;
    });
  return {schema:2, kind:'COMMANDER_WORKSPACE_MONITOR',
    observedAtEpochMs:monitor.observedAtEpochMs, expiresAtEpochMs:monitor.expiresAtEpochMs,
    identity:{profile,port,configSha256}, actionAllowed:false,
    relay:sanitizeRelayObservation(input?.relay),
    workflows:{state:valid?'OBSERVED':'UNVERIFIED',hasMore:valid&&page.hasMore,
      items:valid?rows.map(({id,revision,lifecycle,schedulerEnabled})=>({id,revision,lifecycle,schedulerEnabled})):[]}};
}

// Separate optional sidecar: do not extend either closed monitor schema.
// Counts describe durable records, never live worker state or action authority.
export function sanitizeProjectSummary(input,monitor) {
  const runs=input?.projectRuns;
  const {profile,port,configSha256}=monitor.identity;
  if (!sanitizeWorkspaceSnapshot({},monitor) || !Array.isArray(runs) ||
      runs.length>10000 || runs.length!==monitor.workflows.runCount) return null;
  const counts={runs:runs.length,reviewPassed:0,reviewFailed:0,reviewUnknown:0,
    workerReady:0,workerReserved:0,workerImportedRuns:0};
  for(const run of runs){
    if(!run || typeof run!=='object' || Array.isArray(run))return null;
    const checks=run.verification;
    if(Array.isArray(checks)&&checks.length>0&&checks.length<=1000&&
       checks.every(x=>typeof x?.passed==='boolean')){
      if(checks.every(x=>x.passed))counts.reviewPassed++;
      else counts.reviewFailed++;
    }else counts.reviewUnknown++;
    if(run.pendingWorker?.status==='READY')counts.workerReady++;
    else if(run.pendingWorker?.status==='RESERVED')counts.workerReserved++;
    if(Array.isArray(run.workerReceipts)&&run.workerReceipts.length>0)counts.workerImportedRuns++;
  }
  return {schema:1,kind:'COMMANDER_PROJECT_SUMMARY',observedAtEpochMs:monitor.observedAtEpochMs,
    expiresAtEpochMs:monitor.expiresAtEpochMs,identity:{profile,port,configSha256},
    actionAllowed:false,counts};
}

export async function writeBrowserCompanionMonitor(root, input, options = {}) {
  await provePrivateRoot(root, options);
  return publishMonitor(root, input, options);
}

async function publishPrivateSnapshot(root, name, snapshot, options) {
  const data = JSON.stringify(snapshot) + '\n';
  if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('BROWSER_COMPANION_SNAPSHOT_LIMIT');
  const flavor = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
  const target = flavor.join(root, name + '.json');
  const temporary = flavor.join(root, '.' + name + '-' + process.pid + '-' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if ((options.platform ?? process.platform) !== 'win32') await chmod(temporary, 0o600);
    await rename(temporary, target);
  } catch (error) {
    try { await unlink(temporary); } catch {}
    throw error;
  }
  return { target, bytes: Buffer.byteLength(data), observedAtEpochMs: snapshot.observedAtEpochMs };
}
async function publishMonitor(root, input, options) {
  const monitor = sanitizeMonitorSnapshot(input, options.now?.() ?? Date.now());
  const receipt = await publishPrivateSnapshot(root, 'commander-monitor', monitor, options);
  // Matching time/identity is mandatory in the reader. If publication fails,
  // the old sidecar cannot be mistaken for the new monitor generation.
  const workspace = sanitizeWorkspaceSnapshot(input, monitor);
  if (workspace) {
    try { await publishPrivateSnapshot(root, 'commander-workspace', workspace, options); }
    catch (error) { return {...receipt, workspacePublished:false}; }
  }
  const projectSummary=sanitizeProjectSummary(input,monitor);
  let projectSummaryPublished=false;
  if(projectSummary){
    try{await publishPrivateSnapshot(root,'commander-project-summary',projectSummary,options);projectSummaryPublished=true;}
    catch{}
  }
  return {...receipt, workspacePublished:!!workspace,projectSummaryPublished};
}

export async function writeBrowserCompanionInstanceMonitor(base, instance, input, options = {}) {
  const scopedRoot = browserCompanionInstanceRoot(base, instance, options);
  if (input?.identity?.profile !== instance.profile || input?.identity?.port !== instance.port)
    throw new Error('BROWSER_COMPANION_INSTANCE_MISMATCH');
  const flavor = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
  // Reject unsafe parent directories before entering the instance namespace.
  const instances = flavor.join(base, 'instances');
  if ((options.platform ?? process.platform) === 'win32') {
    await ensureWindowsMonitorDirectories([base, instances, scopedRoot]);
    return publishMonitor(scopedRoot, input, options);
  }
  await provePrivateRoot(base, options);
  await provePrivateRoot(instances, options);
  return writeBrowserCompanionMonitor(scopedRoot, input, options);
}

// Advisory discovery only. CEF still enforces its own native private-file
// checks; neither a fresh snapshot nor the selection confers any authority.
const SCOPE_ID=/^[a-f0-9]{64}$/;
const MAX_SCOPES=128;
async function inspectExistingPrivateDirectory(root) {
  const st=await lstat(root);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('BROWSER_COMPANION_ROOT_UNSAFE');
  if(process.platform!=='win32'&&((st.mode&0o077)!==0||
    (typeof process.getuid==='function'&&st.uid!==process.getuid())))
    throw Error('BROWSER_COMPANION_ROOT_NOT_PRIVATE');
}
// Only the selected, validated local instance may expose this read-only projection.
// Do not relay backend labels, reason strings, extension identities, or policy grants.
// Read only the same generation-bound sidecar used by native CEF. Never extend
// the closed schema-1 monitor with UI-specific keys.
function projectWorkspaceSnapshot(data,monitor){
  if(!data||data.schema!==2||data.kind!=='COMMANDER_WORKSPACE_MONITOR'||
     data.observedAtEpochMs!==monitor.observedAtEpochMs||
     data.expiresAtEpochMs!==monitor.expiresAtEpochMs||
     data.actionAllowed!==false)return null;
  const {profile,port,configSha256}=monitor.identity;
  if(!isDeepStrictEqual(data.identity,{profile,port,configSha256}))return null;
  const r=data.relay;
  const relay=r?.state==='UNVERIFIED'?null:{
    enabled:r?.state!=='DISABLED',ready:r?.state==='PIN_READY',
    extensionId:r?.extensionId,attempts:r?.attempts,
    relayProcessExitedZero:r?.relayProcessExitedZero,dropped:r?.dropped,
    inFlight:r?.inFlight,deliveryConfirmed:r?.deliveryConfirmed};
  const page=data.workflows?.state==='OBSERVED'?
    {hasMore:data.workflows.hasMore,workflows:data.workflows.items}:null;
  const expected=sanitizeWorkspaceSnapshot({relay,workspace:page},monitor);
  if(!isDeepStrictEqual(data,expected))return null;
  return {workflows:expected.workflows,relay:{
    enabled:r.state==='UNVERIFIED'?null:r.state!=='DISABLED',
    ready:r.state==='UNVERIFIED'?null:r.state==='PIN_READY',
    deliveryConfirmed:false}};
}
function dashboardSummary(data,workspace) {
  const flag=value=>typeof value==='boolean'?value:null;
  const count=(value,max=Number.MAX_SAFE_INTEGER)=>
    Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
  const readiness=value=>({enabled:flag(value?.enabled),available:flag(value?.available),
    uncertain:flag(value?.uncertain)});
  return {
    observedAtEpochMs:data.observedAtEpochMs,
    gui:readiness(data.gui),
    browser:readiness(data.browser),
    workflows:{enabled:flag(data.workflows?.enabled),engineEnabled:flag(data.workflows?.engineEnabled),
      runCount:count(data.workflows?.runCount,10000)},
    extensionCount:Array.isArray(data.extensions?.items)?count(data.extensions.items.length,32):null,
    eventRelay:workspace?.relay??{enabled:null,ready:null,deliveryConfirmed:false},
    workspace:workspace?.workflows??{state:'UNVERIFIED',hasMore:false,items:[]},
    operations:{active:count(data.operations?.active),lockedKeys:count(data.operations?.lockedKeys)}
  };
}
async function readPrivateSnapshot(file){
  const first=await lstat(file);
  const safe=st=>st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.size>0&&st.size<=MAX_BYTES&&
    (process.platform==='win32'||((st.mode&0o077)===0&&
      (typeof process.getuid!=='function'||st.uid===process.getuid())));
  if(!safe(first))throw Error('BROWSER_COMPANION_SNAPSHOT_UNSAFE');
  const fd=await open(file,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW??0)));
  let data;
  try {
    const before=await fd.stat();
    const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
    if(!safe(before)||!same(first,before))throw Error('BROWSER_COMPANION_SNAPSHOT_CHANGED');
    const buf=Buffer.alloc(MAX_BYTES+1);let total=0;
    while(total<buf.length){const r=await fd.read(buf,total,buf.length-total,null);if(!r.bytesRead)break;total+=r.bytesRead;}
    const after=await fd.stat(),current=await lstat(file);
    if(total!==before.size||!safe(current)||!same(before,after)||!same(before,current))
      throw Error('BROWSER_COMPANION_SNAPSHOT_CHANGED');
    data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(0,total)));
  }finally{await fd.close();}
  return data;
}
async function readInstanceSelection(base,id,now,includeSummary=false) {
  if(typeof id!=='string'||!SCOPE_ID.test(id))throw Error('BROWSER_COMPANION_SELECTION_INVALID');
  const instances=path.join(base,'instances'),root=path.join(instances,id);
  for(const dir of [base,instances,root])await inspectExistingPrivateDirectory(dir);
  const data=await readPrivateSnapshot(path.join(root,'commander-monitor.json'));
  const identity=data?.identity;
  if(data?.schema!==1||data.kind!=='COMMANDER_LIVE_MONITOR'||
    identity?.platform!==process.platform||
    !/^[a-f0-9]{64}$/.test(identity?.configSha256??'')||
    typeof identity?.version!=='string'||!/^[A-Za-z0-9._+-]{1,64}$/.test(identity.version)||
    !Number.isSafeInteger(data.observedAtEpochMs)||!Number.isSafeInteger(data.expiresAtEpochMs)||
    data.observedAtEpochMs>now||data.expiresAtEpochMs<=now||
    data.expiresAtEpochMs<data.observedAtEpochMs||data.expiresAtEpochMs-data.observedAtEpochMs>30000||
    browserCompanionInstanceRoot(base,identity)!==root)
    throw Error('BROWSER_COMPANION_SELECTION_STALE_OR_MISMATCH');
  let workspace=null;
  if(includeSummary){
    try{workspace=projectWorkspaceSnapshot(await readPrivateSnapshot(path.join(root,'commander-workspace.json')),data);}catch{}
  }
  return {scopeId:id,profile:identity.profile,port:identity.port,version:identity.version,
    expiresAtEpochMs:data.expiresAtEpochMs,root,...(includeSummary?{summary:dashboardSummary(data,workspace)}:{})};
}
export async function listBrowserCompanionInstances({base=defaultBrowserCompanionRoot(),now=Date.now()}={}) {
  if(typeof base!=='string'||!path.isAbsolute(base))throw Error('BROWSER_COMPANION_ROOT_INVALID');
  try{await inspectExistingPrivateDirectory(base);await inspectExistingPrivateDirectory(path.join(base,'instances'));}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
  const found=[];let count=0;
  const dir=await opendir(path.join(base,'instances'));
  for await(const entry of dir){
    if(++count>MAX_SCOPES)throw Error('BROWSER_COMPANION_SCOPE_LIMIT');
    if(!entry.isDirectory()||entry.isSymbolicLink()||!SCOPE_ID.test(entry.name))continue;
    try{const {root,...metadata}=await readInstanceSelection(base,entry.name,now);found.push(metadata);}catch{}
  }
  return found.sort((a,b)=>a.profile.localeCompare(b.profile)||a.port-b.port);
}
export async function selectBrowserCompanionInstance(scopeId,{base=defaultBrowserCompanionRoot(),now=Date.now()}={}) {
  if(typeof base!=='string'||!path.isAbsolute(base))throw Error('BROWSER_COMPANION_ROOT_INVALID');
  const selected=await readInstanceSelection(base,scopeId,now,true);
  if(process.platform==='win32')await ensureWindowsMonitorDirectories([base,path.join(base,'instances'),selected.root],{create:false});
  return {...selected,environmentVariable:'CGWA_COMPANION_ROOT',nativeValidationRequired:true,
    readOnly:true,actionAuthorization:false,ownerLaunchRequired:true};
}

export function startBrowserCompanionMonitor({ snapshot, root = defaultBrowserCompanionRoot(), instance, intervalMs = 2000, onError = () => {} } = {}) {
  if (typeof snapshot !== 'function') throw new Error('BROWSER_COMPANION_SNAPSHOT_PROVIDER_REQUIRED');
  const scoped = Object.freeze({ profile: instance?.profile, port: instance?.port });
  let scopedRoot;
  try { scopedRoot = browserCompanionInstanceRoot(root, scoped); }
  catch (error) {
    // A read-only optional monitor must not prevent the Core from listening.
    // Do not silently fall back to a shared path on invalid identity.
    const lastError = String(error?.code ?? error?.message ?? error).slice(0,160);
    onError(lastError);
    return { status: () => ({ enabled:false, lastWriteAtEpochMs:0, lastError,
      scope:'INSTANCE', scopeId:null }), stop: () => {} };
  }
  const state = { enabled: true, lastWriteAtEpochMs: 0, lastError: '',
    scope: 'INSTANCE', scopeId: path.basename(scopedRoot) };
  let stopped = false, running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const value = await snapshot();
      const receipt = await writeBrowserCompanionInstanceMonitor(root, scoped, value);
      state.lastWriteAtEpochMs = receipt.observedAtEpochMs;
      state.lastError = '';
    } catch (error) {
      state.lastError = String(error?.code ?? error?.message ?? error).slice(0, 160);
      onError(state.lastError);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return {
    status: () => ({ ...state }),
    stop: () => { stopped = true; clearInterval(timer); state.enabled = false; }
  };
}
