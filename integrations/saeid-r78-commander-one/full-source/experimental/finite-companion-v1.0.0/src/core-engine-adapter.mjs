// A fresh, explicitly enrolled sidecar using the exact installed workflow core.
// A model chooses only continue/stop. This module, not the model, owns every
// path, argument, acceptance predicate, action budget and host identity.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {types} from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const CORE_VERSION = '0.10.6';
const CHOICES = new Set(['CONTINUE_STEP', 'STOP']);
const ENTRY_POINTS = ['package.json', 'src/workflow-tools.mjs', 'src/schema-validator.mjs'];
function deny(code) { throw Object.assign(new Error(code), {code,workflowCode:code}); }
function snapshot(value, depth = 0) {
  if (depth > 20 || types.isProxy(value)) deny('ADAPTER_DATA_DENIED');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') deny('ADAPTER_DATA_DENIED');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) deny('ADAPTER_DATA_DENIED');
    return Array.from({length:value.length}, (_, n) => {
      if (!Object.hasOwn(descriptors, n) || !Object.hasOwn(descriptors[n], 'value')) deny('ADAPTER_DATA_DENIED');
      return snapshot(descriptors[n].value, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny('ADAPTER_DATA_DENIED');
  const copy = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const item = descriptors[key];
    if (typeof key !== 'string' || ['__proto__','prototype','constructor'].includes(key)
        || !item.enumerable || !Object.hasOwn(item, 'value')) deny('ADAPTER_DATA_DENIED');
    copy[key] = snapshot(item.value, depth + 1);
  }
  return copy;
}
function freeze(value) { if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value; }
function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) deny(code);
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function inspectDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || /^(?:\\\\|\/\/)/.test(directory)) deny('ADAPTER_LOCAL_DIRECTORY_REQUIRED');
  const resolved = path.resolve(directory);
  let cursor = path.parse(resolved).root;
  for (const item of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor,item);
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) deny('ADAPTER_DIRECTORY_ALIAS');
  }
  if (fs.realpathSync.native(resolved).toLowerCase() !== resolved.toLowerCase()) deny('ADAPTER_DIRECTORY_ALIAS');
  return resolved;
}
function readSource(coreRoot, relative) {
  if (typeof relative !== 'string' || !/^(?:package\.json|src\/[A-Za-z0-9_.-]+\.mjs)$/.test(relative)) deny('ADAPTER_CORE_PATH_DENIED');
  const target = path.join(coreRoot,...relative.split('/'));
  inspectDirectory(path.dirname(target));
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 16 * 1024 * 1024) deny('ADAPTER_CORE_ALIAS_OR_LIMIT');
  const fd = fs.openSync(target,'r');
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size) deny('ADAPTER_CORE_CHANGED');
    const bytes = Buffer.alloc(opened.size); let offset = 0;
    while (offset < bytes.length) {const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset); if (!n) break; offset+=n;}
    const after=fs.fstatSync(fd);
    if (offset !== bytes.length || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || after.nlink !== 1) deny('ADAPTER_CORE_CHANGED');
    return {bytes, pin:{relative,sha256:sha(bytes),bytes:bytes.length,nlink:1}};
  } finally {fs.closeSync(fd);}
}

/** Read-only source registry. Pin the transitive static imports before admission. */
export function collectCoreSourcePins(coreRoot) {
  coreRoot = inspectDirectory(coreRoot);
  const files = new Map(), pending = [...ENTRY_POINTS];
  while (pending.length) {
    const relative = pending.pop(); if (files.has(relative)) continue;
    const read = readSource(coreRoot,relative); files.set(relative,read.pin);
    if (relative.endsWith('.mjs')) {
      const text = read.bytes.toString('utf8');
      // The admitted installed core has static relative dependencies only.
      if (/\bimport\s*\(/.test(text)) deny('ADAPTER_DYNAMIC_CORE_IMPORT');
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)(['"])([^'"\r\n]+)\1/g)) {
        const name = match[2];
        if (name.startsWith('node:')) continue;
        if (!name.startsWith('./')) deny('ADAPTER_EXTERNAL_CORE_IMPORT');
        pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative),name)));
      }
    }
  }
  const pkg = JSON.parse(readSource(coreRoot,'package.json').bytes);
  if (pkg.name !== 'chatgpt-remote-commander' || pkg.version !== CORE_VERSION) deny('ADAPTER_CORE_VERSION');
  return freeze([...files.values()].sort((a,b)=>a.relative.localeCompare(b.relative)));
}

export function hostProofContent(configSha256) {
  if (typeof configSha256 !== 'string' || !HEX.test(configSha256)) deny('ADAPTER_CONFIG_HASH');
  return JSON.stringify({schema:1,source:'system_status',deviceName:'saeid',platform:'win32',version:CORE_VERSION,
    profile:'default',isolated:false,configSha256}) + '\n';
}

/** Neither construction nor a persisted CREATED workflow starts an action.
 * Only enroll() admits this fresh owner-bound workflow. No old DB is reopened,
 * imported, migrated or reset. No canonical Commander configuration is edited.
 */
export async function createCoreEngineAdapter({coreRoot,corePins,root,enrollment,planner,dispatch}) {
  coreRoot = inspectDirectory(coreRoot); root = inspectDirectory(root);
  const supplied = snapshot(corePins), grant = freeze(snapshot(enrollment));
  exactKeys(grant,['id','runId','owner','authorizationSha256','configSha256','planDefinitions'],'ADAPTER_ENROLLMENT_FIELDS');
  if (grant.owner !== 'saeed' || !ID.test(grant.id) || !ID.test(grant.runId)
      || !HEX.test(grant.authorizationSha256) || !HEX.test(grant.configSha256)) deny('ADAPTER_OWNER_AUTHORITY');
  if (typeof planner?.plan !== 'function' || typeof dispatch !== 'function') deny('ADAPTER_PORT_REQUIRED');
  const proofText = hostProofContent(grant.configSha256);
  const exactPlan = [
    {id:'observe_status',tool:'system_status',arguments:{}},
    {id:'write_proof',tool:'write_text',arguments:{path:'HOST_PROOF.json',content:proofText}}
  ];
  if (canonical(grant.planDefinitions) !== canonical(exactPlan)) deny('ADAPTER_PLAN_DENIED');
  if (fs.readdirSync(root).length !== 0) deny('ADAPTER_FRESH_EMPTY_ROOT_REQUIRED');
  const checkPins = () => {
    const actual = collectCoreSourcePins(coreRoot);
    if (canonical(actual) !== canonical(supplied)) deny('ADAPTER_CORE_PIN_DRIFT');
  };
  checkPins();
  const [{createWorkflowTools},{validateJsonSchema}] = await Promise.all([
    import(pathToFileURL(path.join(coreRoot,'src/workflow-tools.mjs')).href),
    import(pathToFileURL(path.join(coreRoot,'src/schema-validator.mjs')).href)
  ]);
  checkPins();
  const binding = sha(canonical({corePins:supplied,root,grant}));
  let api, enrolled=false, closed=false, observed=false, pendingTuple=null;
  const definitions = {
    system_status:{name:'system_status',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    write_text:{name:'write_text',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},
    read_text:{name:'read_text',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}
  };
  function alive() {if (closed) deny('ADAPTER_CLOSED'); checkPins();}
  const config = {
    allowedRoots:[root],maxReadBytes:65536,maxWriteBytes:65536,
    powerMode:{enabled:false,fullFilesystem:false},
    durableWorkflows:{enabled:true,directory:path.join(root,'.engine'),executionTools:['system_status','write_text','read_text'],
      scheduler:{enabled:false,oneWriterPerRoot:true,retryBudget:0},
      runner:{enabled:true,autoTick:false,allowedTools:['system_status','write_text'],maxActions:2,maxPlannerCalls:2,
        maxDurationMs:120000,adaptive:{enabled:false},worker:{enabled:false}}}
  };
  const mappedPlanner = {
    describe:()=>({kind:'owner-finite-catalog',model:'gpt-6.1-sol',callsPerPlan:1,available:true,
      mode:'proposal-only',bindingSha256:binding}),
    async plan(context,{signal}={}) {
      alive();
      if (!enrolled || context.workflowId !== grant.id || context.currentStep?.id !== exactPlan[0].id && context.currentStep?.id !== exactPlan[1].id) deny('ADAPTER_CONTEXT_DENIED');
      const tuple = exactPlan.find(item=>item.id===context.currentStep.id);
      if (tuple.id === 'write_proof' && !observed) deny('ADAPTER_HOST_NOT_OBSERVED');
      const choice = snapshot(await planner.plan(freeze({schema:1,bindingSha256:binding,workflowId:grant.id,runId:grant.runId,
        owner:grant.owner,authorizationSha256:grant.authorizationSha256,currentStep:tuple.id,
        choices:['CONTINUE_STEP','STOP'],budget:snapshot(context.budget)}),{signal}));
      exactKeys(choice,['choice'],'ADAPTER_CHOICE_FIELDS');
      if (!CHOICES.has(choice.choice)) deny('ADAPTER_CHOICE_DENIED');
      checkPins();
      if (choice.choice === 'STOP') return {action:'block',tool:'',argumentsJson:'{}',summary:'Owner-bound planner stopped without an effect.'};
      pendingTuple = tuple;
      return {action:'call',tool:tuple.tool,argumentsJson:JSON.stringify(tuple.arguments),summary:'Execute exactly one owner-enrolled finite catalog step.'};
    }
  };
  api = createWorkflowTools({config,roots:[root],device:'saeid',configSha256:grant.configSha256,
    lookup:name=>definitions[name],validateSchema:validateJsonSchema,planner:mappedPlanner,
    async dispatch(name,args,workflow) {
      alive();
      if (!enrolled || workflow.id !== grant.id || path.resolve(workflow.root) !== root) deny('ADAPTER_DISPATCH_SCOPE');
      if (!pendingTuple || name !== pendingTuple.tool || canonical(args) !== canonical(pendingTuple.arguments)) deny('ADAPTER_DISPATCH_NOT_CATALOG');
      const tuple = pendingTuple; pendingTuple = null;
      const result = await dispatch(name,freeze(snapshot(args)),freeze(snapshot(workflow)));
      checkPins();
      if (tuple.id === 'observe_status') {
        const host = result?.status ?? result;
        if (host?.name !== 'chatgpt-remote-commander' || host?.deviceName !== 'saeid' || host?.platform !== 'win32'
            || host?.version !== CORE_VERSION || host?.configSha256 !== grant.configSha256
            || host?.instance?.profile !== 'default' || host?.instance?.isolated !== false) deny('ADAPTER_HOST_IDENTITY_DRIFT');
        observed = true;
      }
      return result;
    }
  });
  return Object.freeze({
    describe:()=>({schema:1,bindingSha256:binding,coreVersion:CORE_VERSION,scope:'OWNER_ENROLLED_SAEED_STATUS_AND_EXACT_PROOF_ONLY',
      corePins:supplied,allowedTools:['system_status','write_text'],maxActions:2,maxPlannerCalls:2,maxDurationMs:120000,
      scheduler:false,automaticActivation:false,canonicalCoreMutated:false}),
    async enroll() {
      alive(); if (enrolled) deny('ADAPTER_ALREADY_ENROLLED');
      const created = await api.execute('workflow_create',{id:grant.id,root,
        goal:'Read the identified Saeed Commander and persist the exact predeclared identity proof in this new owned workspace.',
        acceptance:['The owner-specified proof bytes match the separately validated real system_status identity.'],
        steps:[{id:'observe_status',title:'Read the exact identified Saeed Commander system_status'},
          {id:'write_proof',title:'Write the exact owner-predetermined local host proof',dependsOn:['observe_status']}],
        autoContinue:false,retryBudget:0});
      const state = created.state ?? (await api.execute('workflow_get',{id:grant.id})).state;
      const run = await api.execute('workflow_run_start',{id:grant.id,runId:grant.runId,expectedRevision:state.revision,
        maxActions:2,maxPlannerCalls:2,durationMs:120000,
        checks:[{criterion:0,type:'file_sha256',path:'HOST_PROOF.json',sha256:sha(proofText)}]});
      enrolled = true; return run;
    },
    async tick() {alive(); if(!enrolled)deny('ADAPTER_EXPLICIT_ENROLLMENT_REQUIRED'); return api.execute('workflow_run_tick',{runId:grant.runId});},
    async status() {alive();return api.execute('workflow_run_status',enrolled?{runId:grant.runId}:{});},
    async state() {alive();if(!enrolled)deny('ADAPTER_EXPLICIT_ENROLLMENT_REQUIRED');return api.execute('workflow_get',{id:grant.id});},
    async operations() {alive();if(!enrolled)deny('ADAPTER_EXPLICIT_ENROLLMENT_REQUIRED');return api.execute('workflow_operations',{id:grant.id});},
    async health() {alive();return api.execute('workflow_health',{});},
    async close() {if(closed)return;closed=true;pendingTuple=null;await api.close();}
  });
}
