import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, lstat, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const CAPABILITY_GAP_ISSUE = 'https://github.com/GOD13emad/ChatGPTRemoteCommander/issues/443';
const KEY_RE = /^[a-z0-9][a-z0-9._:-]{2,95}$/;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const IDENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CODE_RE = /^[A-Z][A-Z0-9._-]{2,95}$/;
const CATEGORIES = Object.freeze([
  'TOOL_MISSING', 'TOOL_UNAVAILABLE', 'IMPLEMENTATION_MISSING',
  'PLATFORM_UNSUPPORTED', 'NATIVE_OWNER_APPROVAL_REQUIRED',
  'CONNECTOR_AUTH_REQUIRED', 'PROVIDER_CONFIG_MISSING',
  'SECURITY_POLICY_DENIED', 'RUNTIME_NOT_DEPLOYED',
  'PROFILE_NOT_ENROLLED', 'HOST_OFFLINE', 'TRANSIENT_FAILURE',
  'TEST_OR_COMPATIBILITY_FAILURE'
]);
const STATES = Object.freeze([
  'OPEN', 'TRIAGED', 'IMPLEMENTING', 'QA_PASS', 'DEPLOYED',
  'VERIFIED', 'CLOSED', 'BLOCKED_OWNER', 'BLOCKED_PROVIDER',
  'BLOCKED_SECURITY'
]);
const NEXT = Object.freeze({
  OPEN: ['TRIAGED', 'BLOCKED_OWNER', 'BLOCKED_PROVIDER', 'BLOCKED_SECURITY'],
  TRIAGED: ['IMPLEMENTING', 'BLOCKED_OWNER', 'BLOCKED_PROVIDER', 'BLOCKED_SECURITY'],
  IMPLEMENTING: ['QA_PASS', 'BLOCKED_OWNER', 'BLOCKED_PROVIDER', 'BLOCKED_SECURITY'],
  QA_PASS: ['DEPLOYED', 'IMPLEMENTING', 'BLOCKED_OWNER', 'BLOCKED_PROVIDER', 'BLOCKED_SECURITY'],
  DEPLOYED: ['VERIFIED', 'IMPLEMENTING', 'BLOCKED_OWNER', 'BLOCKED_PROVIDER', 'BLOCKED_SECURITY'],
  VERIFIED: ['CLOSED', 'IMPLEMENTING'],
  CLOSED: ['OPEN'],
  BLOCKED_OWNER: ['TRIAGED', 'IMPLEMENTING'],
  BLOCKED_PROVIDER: ['TRIAGED', 'IMPLEMENTING'],
  BLOCKED_SECURITY: ['TRIAGED']
});
const SAFE_CODE_MAP = Object.freeze({
  GUI_BUSY: 'TRANSIENT_FAILURE',
  WORKSPACE_OWNER_PROXY_DISABLED: 'TOOL_UNAVAILABLE',
  BROKER_NOT_VERIFIED: 'NATIVE_OWNER_APPROVAL_REQUIRED',
  NATIVE_GRANT_SERVICE_CREDENTIALS_REQUIRED: 'NATIVE_OWNER_APPROVAL_REQUIRED',
  NATIVE_GRANT_CREDENTIAL_NOT_DELIVERED: 'PROFILE_NOT_ENROLLED',
  BLOCKED_PROVIDER_CONFIG_MISSING: 'PROVIDER_CONFIG_MISSING',
  PRIVILEGED_NATIVE_PROFILE_CREDENTIAL_REQUIRED: 'PROFILE_NOT_ENROLLED',
  NATIVE_ISSUER_INSTALL_BLOCKED: 'IMPLEMENTATION_MISSING',
  WINDOW_ADMIN_TOKEN_NOT_ELEVATED: 'NATIVE_OWNER_APPROVAL_REQUIRED',
  WINDOWS_ADMIN_TOKEN_NOT_ELEVATED: 'NATIVE_OWNER_APPROVAL_REQUIRED',
  OWNER_GUI_CONSENT_REQUIRED: 'NATIVE_OWNER_APPROVAL_REQUIRED',
  CUA_NOT_AVAILABLE: 'TOOL_UNAVAILABLE'
});
const secretLike = /(?:\b(?:bearer|token|password|passwd|api[_-]?key|secret|access[_-]?token|authorization|cookie)\s*[:=]\s*\S+|(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_-]{12,})|-----BEGIN [^-]*PRIVATE KEY-----|https?:\/\/\S+|\bbearer\s+\S+)/i;
function idFor(key, category) {
  return 'gap-' + createHash('sha256').update(category + '\n' + key).digest('hex').slice(0,20);
}
function requiredPattern(value, re, code) {
  if (typeof value !== 'string' || !re.test(value)) throw new Error(code);
  return value;
}
function optionalPattern(value, re, code) {
  return value == null ? null : requiredPattern(value, re, code);
}
function safeText(value, code, max = 220) {
  if (typeof value !== 'string' || value.trim().length < 8 || value.length > max ||
      /[\x00-\x1f\x7f]/.test(value) || secretLike.test(value)) throw new Error(code);
  return value.trim();
}
function optionalText(value, code, max = 220) {
  return value == null ? null : safeText(value, code, max);
}
function boundedUnique(values, value, limit = 24) {
  if (value == null) return [...values];
  return [...new Set([...values, value])].slice(-limit);
}
const defaultDirectory = () => path.join(os.homedir(), '.local', 'state',
  'chatgpt-remote-commander', 'capability-gaps', 'v1');
function isWin() { return process.platform === 'win32'; }
async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const st = await lstat(directory);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      (!isWin() && (st.uid !== process.getuid() || (st.mode & 0o077) !== 0))) {
    throw new Error('CAPABILITY_REGISTRY_DIRECTORY_UNTRUSTED');
  }
}
async function trustedRead(file) {
  let st;
  try { st = await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 24576 ||
      (!isWin() && (st.uid !== process.getuid() || (st.mode & 0o077) !== 0))) {
    throw new Error('CAPABILITY_REGISTRY_FILE_UNTRUSTED');
  }
  const raw = await readFile(file, 'utf8');
  const data = JSON.parse(raw);
  if (!data || data.schema !== 1 || !/^gap-[a-f0-9]{20}$/.test(data.id) ||
      typeof data.revision !== 'number' || data.revision < 1) {
    throw new Error('CAPABILITY_REGISTRY_RECORD_INVALID');
  }
  return data;
}
async function atomicWrite(file, record) {
  const dir = path.dirname(file);
  const stage = path.join(dir, '.writing-' + randomUUID());
  const handle = await open(stage, 'wx', 0o600);
  try {
    const bytes = JSON.stringify(record, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > 24576) throw new Error('CAPABILITY_REGISTRY_RECORD_TOO_LARGE');
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try { await rename(stage, file); }
  finally { await rm(stage, { force:true }); }
}
function validateReport(args) {
  const capabilityKey = requiredPattern(args?.capabilityKey, KEY_RE, 'CAPABILITY_KEY_INVALID');
  const category = args?.category;
  if (!CATEGORIES.includes(category)) throw new Error('CAPABILITY_CATEGORY_INVALID');
  const eventId = requiredPattern(args?.eventId, TOKEN_RE, 'CAPABILITY_EVENT_ID_REQUIRED');
  const summary = safeText(args?.summary, 'CAPABILITY_SUMMARY_UNSAFE');
  const severity = args?.severity ?? 'P2';
  if (!['P0','P1','P2','P3'].includes(severity)) throw new Error('CAPABILITY_SEVERITY_INVALID');
  return {
    capabilityKey, category, eventId, summary, severity,
    errorCode: optionalPattern(args?.errorCode, CODE_RE, 'CAPABILITY_ERROR_CODE_INVALID'),
    host: optionalPattern(args?.host, IDENT_RE, 'CAPABILITY_HOST_INVALID'),
    profile: optionalPattern(args?.profile, IDENT_RE, 'CAPABILITY_PROFILE_INVALID'),
    projectKey: optionalPattern(args?.projectKey, IDENT_RE, 'CAPABILITY_PROJECT_INVALID'),
    platform: optionalPattern(args?.platform, IDENT_RE, 'CAPABILITY_PLATFORM_INVALID'),
    blocker: optionalPattern(args?.blocker, CODE_RE, 'CAPABILITY_BLOCKER_INVALID')
  };
}
function resultRecord(record) {
  const { events, ...publicRecord } = record;
  return publicRecord;
}
export class CapabilityGapRegistry {
  constructor({ directory = defaultDirectory(), clock = () => new Date() } = {}) {
    this.directory = path.resolve(directory);
    this.clock = clock;
  }
  status() {
    return { supported:true, localRegistry:'owner-host-scoped',
      crossHostAutomaticSync:false, centralTrackingIssue:CAPABILITY_GAP_ISSUE,
      releaseStatus:'source-only-until-shipped', nativeElevationGranted:false };
  }
  async withWriteLock(task) {
    await secureDirectory(this.directory);
    const lock = path.join(this.directory, '.writer.lock');
    let handle;
    for (let attempt=0;attempt<80;attempt++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch(error) {
        if (error.code !== 'EEXIST') throw error;
        if (attempt === 79) throw new Error('CAPABILITY_REGISTRY_BUSY');
        await delay(20);
      }
    }
    try { return await task(); }
    finally { await handle.close(); await rm(lock, { force:true }); }
  }
  _file(id) {
    if (!/^gap-[a-f0-9]{20}$/.test(id)) throw new Error('CAPABILITY_ID_INVALID');
    return path.join(this.directory, id + '.json');
  }
  async report(args) {
    const a = validateReport(args);
    const id = idFor(a.capabilityKey, a.category);
    const eventHash = createHash('sha256').update(a.eventId).digest('hex').slice(0,24);
    return this.withWriteLock(async () => {
      const file = this._file(id);
      const before = await trustedRead(file);
      if (before && before.events.includes(eventHash)) {
        return { ...resultRecord(before), deduplicated:true, eventAlreadySeen:true,
          externalSync:'PENDING_AUTHENTICATED_CONNECTOR', centralTrackingIssue:CAPABILITY_GAP_ISSUE };
      }
      const now = this.clock().toISOString();
      const after = before ? { ...before,
        // A genuinely new occurrence after a verified close is a regression.
        state: before.state === 'CLOSED' ? 'OPEN' : before.state,
        evidence: before.state === 'CLOSED' ? [] : before.evidence,
        solution: before.state === 'CLOSED' ? null : before.solution,
        deploymentRef: before.state === 'CLOSED' ? null : before.deploymentRef,
        verificationRef: before.state === 'CLOSED' ? null : before.verificationRef,
        revision: before.revision + 1, count: before.count + 1,
        updatedAt: now, summary:a.summary,
        severity: ['P0','P1','P2','P3'].indexOf(a.severity) < ['P0','P1','P2','P3'].indexOf(before.severity) ? a.severity : before.severity,
        events: [...before.events, eventHash].slice(-64),
        errorCodes: boundedUnique(before.errorCodes, a.errorCode),
        hosts: boundedUnique(before.hosts, a.host),
        profiles: boundedUnique(before.profiles, a.profile),
        projects: boundedUnique(before.projects, a.projectKey),
        platforms: boundedUnique(before.platforms, a.platform),
        blockers: boundedUnique(before.blockers, a.blocker)
      } : {
        schema:1, id, capabilityKey:a.capabilityKey, category:a.category, summary:a.summary,
        severity:a.severity, state:'OPEN', count:1, revision:1, createdAt:now, updatedAt:now,
        events:[eventHash], errorCodes:boundedUnique([],a.errorCode),
        hosts:boundedUnique([],a.host), profiles:boundedUnique([],a.profile),
        projects:boundedUnique([],a.projectKey), platforms:boundedUnique([],a.platform),
        blockers:boundedUnique([],a.blocker), evidence:[],
        solution:null, deploymentRef:null, verificationRef:null
      };
      await atomicWrite(file,after);
      return { ...resultRecord(after), deduplicated:!!before, eventAlreadySeen:false,
        externalSync:'PENDING_AUTHENTICATED_CONNECTOR', centralTrackingIssue:CAPABILITY_GAP_ISSUE };
    });
  }
  async get({id} = {}) {
    await secureDirectory(this.directory);
    const data = await trustedRead(this._file(id));
    if (!data) throw new Error('CAPABILITY_GAP_NOT_FOUND');
    return resultRecord(data);
  }
  async list({ state, category, limit = 25 } = {}) {
    if (state != null && !STATES.includes(state)) throw new Error('CAPABILITY_STATE_INVALID');
    if (category != null && !CATEGORIES.includes(category)) throw new Error('CAPABILITY_CATEGORY_INVALID');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('CAPABILITY_LIST_LIMIT_INVALID');
    await secureDirectory(this.directory);
    const entries = (await readdir(this.directory)).filter(n => /^gap-[a-f0-9]{20}\.json$/.test(n));
    if (entries.length > 2000) throw new Error('CAPABILITY_REGISTRY_LIMIT');
    const items = [];
    for(const entry of entries) {
      const data = await trustedRead(path.join(this.directory,entry));
      if (data && (state == null || data.state === state) && (category == null || data.category === category)) items.push(resultRecord(data));
    }
    items.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return { total:items.length, items:items.slice(0,limit), centralTrackingIssue:CAPABILITY_GAP_ISSUE,
      externalSync:'PENDING_AUTHENTICATED_CONNECTOR' };
  }
  async update(args) {
    const id = args?.id;
    const state = args?.state;
    const expectedRevision = args?.expectedRevision;
    if (!STATES.includes(state)) throw new Error('CAPABILITY_STATE_INVALID');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('CAPABILITY_REVISION_REQUIRED');
    const evidenceRef = optionalPattern(args?.evidenceRef, /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,179}$/, 'CAPABILITY_EVIDENCE_REF_INVALID');
    const solution = optionalText(args?.solution, 'CAPABILITY_SOLUTION_UNSAFE', 360);
    return this.withWriteLock(async () => {
      const file = this._file(id);
      const before = await trustedRead(file);
      if (!before) throw new Error('CAPABILITY_GAP_NOT_FOUND');
      if (before.revision !== expectedRevision) throw new Error('CAPABILITY_REVISION_CONFLICT');
      if (state !== before.state && !NEXT[before.state].includes(state)) throw new Error('CAPABILITY_STATE_TRANSITION_INVALID');
      if (['QA_PASS','DEPLOYED','VERIFIED','CLOSED'].includes(state) && !evidenceRef && before.evidence.length===0) {
        throw new Error('CAPABILITY_GATE_EVIDENCE_REQUIRED');
      }
      if (state === 'DEPLOYED' && !args?.deploymentRef) throw new Error('CAPABILITY_DEPLOYMENT_REF_REQUIRED');
      if (state === 'VERIFIED' && !args?.verificationRef) throw new Error('CAPABILITY_VERIFICATION_REF_REQUIRED');
      if (state === 'CLOSED' && before.state !== 'VERIFIED') throw new Error('CAPABILITY_VERIFICATION_REQUIRED');
      const deploymentRef = args?.deploymentRef == null ? before.deploymentRef :
        requiredPattern(args.deploymentRef, /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,179}$/, 'CAPABILITY_DEPLOYMENT_REF_INVALID');
      const verificationRef = args?.verificationRef == null ? before.verificationRef :
        requiredPattern(args.verificationRef, /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,179}$/, 'CAPABILITY_VERIFICATION_REF_INVALID');
      const after = {...before, revision:before.revision+1, updatedAt:this.clock().toISOString(),
        state, solution:solution ?? before.solution, deploymentRef,verificationRef,
        evidence: boundedUnique(before.evidence,evidenceRef,40)};
      await atomicWrite(file,after);
      return resultRecord(after);
    });
  }
  async captureKnownFailure(name, error, {profile = 'default', platform = process.platform} = {}) {
    // Only exact, predefined, non-secret codes. Never ingest raw tool args,
    // arbitrary exceptions, stack traces, credentials, or user documents.
    const code = typeof error?.message === 'string' ? error.message.trim() : '';
    const category = SAFE_CODE_MAP[code];
    if (!category || !/^[a-z][a-z0-9_]{2,63}$/.test(name)) return null;
    const date = this.clock().toISOString().slice(0,10);
    return this.report({
      capabilityKey:'mcp.'+name+'.'+code.toLowerCase().replaceAll('_','-'),
      category, summary:'Commander tool '+name+' returned known capability code '+code,
      eventId:'auto-'+createHash('sha256').update(date+name+code+profile).digest('hex').slice(0,30),
      errorCode:code, profile, platform, blocker:code
    });
  }
  async execute(name,args) {
    switch(name) {
      case 'capability_gap_report': return this.report(args);
      case 'capability_gap_list': return this.list(args);
      case 'capability_gap_get': return this.get(args);
      case 'capability_gap_update': return this.update(args);
      default: throw new Error('CAPABILITY_GAP_UNKNOWN_TOOL');
    }
  }
}
const identSchema = { type:'string', minLength:1, maxLength:64, pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' };
export const capabilityGapToolDefinitions = Object.freeze([
  {
    name:'capability_gap_report',
    description:'Report a missing/blocked Commander capability from any chat/project. Local owner-host durable deduplication, safe typed fields only; does not elevate OS permissions or automatically synchronize across hosts. Returns central GitHub tracking issue and pending sync state.',
    inputSchema:{ type:'object', properties:{
      capabilityKey:{type:'string',pattern:'^[a-z0-9][a-z0-9._:-]{2,95}$',maxLength:96},
      category:{type:'string',enum:CATEGORIES},
      eventId:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$',maxLength:128},
      summary:{type:'string',minLength:8,maxLength:220},
      severity:{type:'string',enum:['P0','P1','P2','P3']},
      errorCode:{type:'string',pattern:'^[A-Z][A-Z0-9._-]{2,95}$'},
      host:identSchema,profile:identSchema,projectKey:identSchema,platform:identSchema,
      blocker:{type:'string',pattern:'^[A-Z][A-Z0-9._-]{2,95}$'}
    },required:['capabilityKey','category','eventId','summary'],additionalProperties:false },
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  },
  {
    name:'capability_gap_list',
    description:'Read safely summarized per-owner-host capability gaps and their real gate states. Central cross-host GitHub synchronization is not automatic.',
    inputSchema:{type:'object',properties:{
      state:{type:'string',enum:STATES},category:{type:'string',enum:CATEGORIES},
      limit:{type:'integer',minimum:1,maximum:50}
    },additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:'capability_gap_get',
    description:'Read a single persistent capability gap and its evidence, no escalation.',
    inputSchema:{type:'object',properties:{id:{type:'string',pattern:'^gap-[a-f0-9]{20}$'}},
      required:['id'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:'capability_gap_update',
    description:'Update a capability gap after investigation; guarded revision and evidence requirements, no automatic implementation, release, or permission grant.',
    inputSchema:{type:'object',properties:{
      id:{type:'string',pattern:'^gap-[a-f0-9]{20}$'},
      state:{type:'string',enum:STATES},
      expectedRevision:{type:'integer',minimum:1},
      evidenceRef:{type:'string',minLength:3,maxLength:180},
      solution:{type:'string',minLength:8,maxLength:360},
      deploymentRef:{type:'string',minLength:3,maxLength:180},
      verificationRef:{type:'string',minLength:3,maxLength:180}
    },required:['id','state','expectedRevision'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}
  }
]);
