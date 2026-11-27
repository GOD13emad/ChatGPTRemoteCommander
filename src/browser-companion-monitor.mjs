import os from 'node:os';
import path from 'node:path';
import { mkdir, lstat, chmod, writeFile, rename, unlink, opendir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
  const text = value => typeof value === 'string' ? value.slice(0, 160) : '';
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
    id: text(item?.id).slice(0, 64),
    version: text(item?.version).slice(0, 64)
  })).filter(item => item.id) : [];
  return {
    schema: 1,
    kind: 'COMMANDER_LIVE_MONITOR',
    observedAtEpochMs: now,
    expiresAtEpochMs: now + 10000,
    identity: {
      deviceName: text(input?.identity?.deviceName),
      profile: text(input?.identity?.profile),
      version: text(input?.identity?.version),
      configSha256: /^[a-f0-9]{64}$/.test(input?.identity?.configSha256 ?? '') ? input.identity.configSha256 : '',
      port: Number.isInteger(input?.identity?.port) ? input.identity.port : 0,
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
      active: Number.isInteger(input?.operations?.active) ? Math.max(0, input.operations.active) : 0,
      lockedKeys: Number.isInteger(input?.operations?.lockedKeys) ? Math.max(0, input.operations.lockedKeys) : 0
    }
  };
}

export async function writeBrowserCompanionMonitor(root, input, options = {}) {
  await provePrivateRoot(root, options);
  return publishMonitor(root, input, options);
}

async function publishMonitor(root, input, options) {
  const snapshot = sanitizeMonitorSnapshot(input, options.now?.() ?? Date.now());
  const data = JSON.stringify(snapshot) + '\n';
  if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('BROWSER_COMPANION_SNAPSHOT_LIMIT');
  const flavor = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
  const target = flavor.join(root, 'commander-monitor.json');
  const temporary = flavor.join(root, '.commander-monitor-' + process.pid + '-' + randomUUID() + '.tmp');
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
function dashboardSummary(data) {
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
    operations:{active:count(data.operations?.active),lockedKeys:count(data.operations?.lockedKeys)}
  };
}
async function readInstanceSelection(base,id,now,includeSummary=false) {
  if(typeof id!=='string'||!SCOPE_ID.test(id))throw Error('BROWSER_COMPANION_SELECTION_INVALID');
  const instances=path.join(base,'instances'),root=path.join(instances,id);
  for(const dir of [base,instances,root])await inspectExistingPrivateDirectory(dir);
  const file=path.join(root,'commander-monitor.json');
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
  return {scopeId:id,profile:identity.profile,port:identity.port,version:identity.version,
    expiresAtEpochMs:data.expiresAtEpochMs,root,...(includeSummary?{summary:dashboardSummary(data)}:{})};
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
