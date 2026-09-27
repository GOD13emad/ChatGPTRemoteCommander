import fs from 'node:fs';
import path from 'node:path';

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const CAP_RE = /^[a-z][a-z0-9._:-]{0,95}$/;
const VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_EXTENSIONS = 100;
const MAX_CAPABILITIES = 64;
const MAX_DEPS = 128;
const MAX_ARTIFACTS = 64;

function issue(code, detail = {}) { return { code, ...detail }; }
function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function safeString(v, max = 4096) { return typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0'); }
function uniqueStrings(v, max, re = null) {
  return Array.isArray(v) && v.length > 0 && v.length <= max
    && v.every(x => safeString(x, 256) && (!re || re.test(x)))
    && new Set(v).size === v.length;
}
function relativeFile(root, rel) {
  if (!safeString(rel, 512) || path.isAbsolute(rel)) throw new Error('AGENT_EXTENSION_PATH_INVALID');
  const normalized = path.normalize(rel);
  if (normalized === '.' || normalized.startsWith('..' + path.sep) || normalized === '..') throw new Error('AGENT_EXTENSION_PATH_INVALID');
  const target = path.resolve(root, normalized);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!target.startsWith(prefix)) throw new Error('AGENT_EXTENSION_PATH_INVALID');
  const realRoot = fs.realpathSync.native(root);
  const realTarget = fs.realpathSync.native(target);
  const realPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!fold(realTarget).startsWith(fold(realPrefix))) throw new Error('AGENT_EXTENSION_PATH_INVALID');
  return realTarget;
}
function regularFile(file, maxBytes = MAX_MANIFEST_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > maxBytes) {
    throw new Error('AGENT_EXTENSION_FILE_INVALID');
  }
  return stat;
}
function realDirectory(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('AGENT_EXTENSION_DIRECTORY_INVALID');
  return fs.realpathSync.native(dir);
}
function validateDependency(dep) {
  if (!plain(dep) || !safeString(dep.id, 128) || !CAP_RE.test(dep.id)
      || !['runtime','model','tool','service'].includes(dep.kind)
      || typeof dep.required !== 'boolean') return false;
  if (dep.path !== undefined && !safeString(dep.path, 2048)) return false;
  if (dep.version !== undefined && !safeString(dep.version, 128)) return false;
  if (dep.source !== undefined && !safeString(dep.source, 2048)) return false;
  return Object.keys(dep).every(k => ['id','kind','required','path','version','source'].includes(k));
}
function validateRouter(router) {
  if (router === undefined) return true;
  return plain(router)
    && safeString(router.program, 128)
    && Array.isArray(router.args) && router.args.length <= 50 && router.args.every(x => typeof x === 'string' && x.length <= 1024)
    && Object.keys(router).every(k => ['program','args'].includes(k));
}

export function validateAgentExtensionManifest(value, root) {
  const errors = [];
  if (!plain(value)) return { valid:false, errors:[issue('AGENT_EXTENSION_MANIFEST_NOT_OBJECT')] };
  const allowed = new Set([
    'schemaVersion','id','version','displayName','description','capabilities','triggers','skill',
    'projectRoot','router','runtimeDependencies','hardware','safetyGates','artifacts','metadata'
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(issue('AGENT_EXTENSION_UNKNOWN_FIELD',{field:key}));
  if (value.schemaVersion !== 1) errors.push(issue('AGENT_EXTENSION_SCHEMA_UNSUPPORTED'));
  if (!safeString(value.id,64) || !ID_RE.test(value.id)) errors.push(issue('AGENT_EXTENSION_ID_INVALID'));
  if (!safeString(value.version,128) || !VERSION_RE.test(value.version)) errors.push(issue('AGENT_EXTENSION_VERSION_INVALID'));
  if (!safeString(value.displayName,160)) errors.push(issue('AGENT_EXTENSION_DISPLAY_NAME_INVALID'));
  if (!safeString(value.description,2048)) errors.push(issue('AGENT_EXTENSION_DESCRIPTION_INVALID'));
  if (!uniqueStrings(value.capabilities,MAX_CAPABILITIES,CAP_RE)) errors.push(issue('AGENT_EXTENSION_CAPABILITIES_INVALID'));
  if (value.triggers !== undefined && !uniqueStrings(value.triggers,64)) errors.push(issue('AGENT_EXTENSION_TRIGGERS_INVALID'));
  if (value.skill !== undefined) {
    try {
      const skill = relativeFile(root,value.skill);
      regularFile(skill,256*1024);
    } catch {
      errors.push(issue('AGENT_EXTENSION_SKILL_INVALID'));
    }
  }
  if (value.projectRoot !== undefined && (!safeString(value.projectRoot,2048) || !path.isAbsolute(value.projectRoot))) {
    errors.push(issue('AGENT_EXTENSION_PROJECT_ROOT_INVALID'));
  }
  if (!validateRouter(value.router)) errors.push(issue('AGENT_EXTENSION_ROUTER_INVALID'));
  if (value.runtimeDependencies !== undefined && (
    !Array.isArray(value.runtimeDependencies) || value.runtimeDependencies.length > MAX_DEPS
    || !value.runtimeDependencies.every(validateDependency)
    || new Set(value.runtimeDependencies.map(x=>x.id)).size !== value.runtimeDependencies.length
  )) errors.push(issue('AGENT_EXTENSION_DEPENDENCIES_INVALID'));
  if (value.hardware !== undefined && (!plain(value.hardware)
      || Object.keys(value.hardware).some(k=>!['gpu','minVramMiB','minRamMiB','platforms'].includes(k))
      || (value.hardware.gpu !== undefined && !safeString(value.hardware.gpu,256))
      || (value.hardware.minVramMiB !== undefined && (!Number.isSafeInteger(value.hardware.minVramMiB)||value.hardware.minVramMiB<0))
      || (value.hardware.minRamMiB !== undefined && (!Number.isSafeInteger(value.hardware.minRamMiB)||value.hardware.minRamMiB<0))
      || (value.hardware.platforms !== undefined && (!Array.isArray(value.hardware.platforms)||value.hardware.platforms.length<1||value.hardware.platforms.some(x=>!['win32','linux','darwin'].includes(x))))
  )) errors.push(issue('AGENT_EXTENSION_HARDWARE_INVALID'));
  if (value.safetyGates !== undefined && !uniqueStrings(value.safetyGates,64,CAP_RE)) errors.push(issue('AGENT_EXTENSION_SAFETY_GATES_INVALID'));
  if (value.artifacts !== undefined && !uniqueStrings(value.artifacts,MAX_ARTIFACTS)) errors.push(issue('AGENT_EXTENSION_ARTIFACTS_INVALID'));
  if (value.metadata !== undefined && !plain(value.metadata)) errors.push(issue('AGENT_EXTENSION_METADATA_INVALID'));
  return { valid:errors.length===0, errors };
}

function loadManifest(extensionDir) {
  const root = realDirectory(extensionDir);
  const manifestPath = path.join(root,'agent.json');
  regularFile(manifestPath);
  let raw;
  try { raw=fs.readFileSync(manifestPath,'utf8'); } catch { throw new Error('AGENT_EXTENSION_MANIFEST_READ_FAILED'); }
  let manifest;
  try { manifest=JSON.parse(raw); } catch { throw new Error('AGENT_EXTENSION_MANIFEST_JSON_INVALID'); }
  const validation=validateAgentExtensionManifest(manifest,root);
  if(!validation.valid) {
    const e=new Error('AGENT_EXTENSION_MANIFEST_INVALID');
    e.validation=validation.errors;
    throw e;
  }
  return Object.freeze({
    ...manifest,
    root,
    manifestPath,
    skillPath: manifest.skill ? relativeFile(root,manifest.skill) : null
  });
}

function normalizeDirectories(directories) {
  if (!Array.isArray(directories) || directories.length > 20) throw new Error('AGENT_EXTENSION_DIRECTORIES_INVALID');
  return [...new Set(directories.filter(Boolean).map(dir=>{
    if(!safeString(dir,2048)||!path.isAbsolute(dir)) throw new Error('AGENT_EXTENSION_DIRECTORY_INVALID');
    return path.resolve(dir);
  }))];
}

export const agentExtensionToolDefinitions = Object.freeze([
  {
    name:'agent_extension_list',
    description:'List valid declarative Remote Commander-Agent extensions and any discovery diagnostics. Extensions do not grant execution authority.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:'agent_extension_get',
    description:'Read one validated Remote Commander-Agent extension manifest by id. This is metadata only; execution still uses Commander policy and workflow tools.',
    inputSchema:{type:'object',properties:{id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'}},required:['id'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:'agent_extension_match',
    description:'Find validated Agent extensions that declare every requested capability. Matching is declarative and does not execute the extension.',
    inputSchema:{type:'object',properties:{capabilities:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',pattern:'^[a-z][a-z0-9._:-]{0,95}$'}}},required:['capabilities'],additionalProperties:false},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  }
]);

export function createAgentExtensionRegistry({directories=[]}={}) {
  const roots=normalizeDirectories(directories);
  function scan() {
    const extensions=[];
    const diagnostics=[];
    const seen=new Map();
    const conflicted=new Set();
    for(const base of roots) {
      if(!fs.existsSync(base)) continue;
      let actual;
      try { actual=realDirectory(base); }
      catch { diagnostics.push(issue('AGENT_EXTENSION_ROOT_INVALID',{directory:base})); continue; }
      let entries;
      try { entries=fs.readdirSync(actual,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).sort((a,b)=>a.name.localeCompare(b.name)); }
      catch { diagnostics.push(issue('AGENT_EXTENSION_ROOT_READ_FAILED',{directory:base})); continue; }
      for(const entry of entries) {
        if(extensions.length+diagnostics.length>=MAX_EXTENSIONS) {
          diagnostics.push(issue('AGENT_EXTENSION_LIMIT_REACHED',{limit:MAX_EXTENSIONS}));
          return {extensions,diagnostics};
        }
        const dir=path.join(actual,entry.name);
        if(!fs.existsSync(path.join(dir,'agent.json'))) continue;
        try {
          const ext=loadManifest(dir);
          if(conflicted.has(ext.id)) {
            diagnostics.push(issue('AGENT_EXTENSION_ID_CONFLICT',{id:ext.id,roots:[ext.root]}));
            continue;
          }
          if(seen.has(ext.id)) {
            const prior=seen.get(ext.id);
            extensions.splice(extensions.findIndex(x=>x.id===ext.id),1);
            seen.delete(ext.id);
            conflicted.add(ext.id);
            diagnostics.push(issue('AGENT_EXTENSION_ID_CONFLICT',{id:ext.id,roots:[prior.root,ext.root]}));
            continue;
          }
          seen.set(ext.id,ext);
          extensions.push(ext);
        } catch(error) {
          diagnostics.push(issue(error.message||'AGENT_EXTENSION_INVALID',{
            directory:dir,
            ...(Array.isArray(error.validation)?{validation:error.validation}: {})
          }));
        }
      }
    }
    extensions.sort((a,b)=>a.id.localeCompare(b.id));
    diagnostics.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return {extensions,diagnostics};
  }
  function publicExtension(ext) {
    return {
      schemaVersion:ext.schemaVersion,id:ext.id,version:ext.version,displayName:ext.displayName,
      description:ext.description,capabilities:ext.capabilities,triggers:ext.triggers??[],
      root:ext.root,manifestPath:ext.manifestPath,skillPath:ext.skillPath,
      projectRoot:ext.projectRoot??null,router:ext.router??null,
      runtimeDependencies:ext.runtimeDependencies??[],hardware:ext.hardware??null,
      safetyGates:ext.safetyGates??[],artifacts:ext.artifacts??[],metadata:ext.metadata??{}
    };
  }
  function status() {
    const {extensions,diagnostics}=scan();
    return {schema:1,directories:[...roots],count:extensions.length,invalidCount:diagnostics.length,diagnostics};
  }
  function execute(name,args={}) {
    const {extensions,diagnostics}=scan();
    if(name==='agent_extension_list') return {
      schema:1,directories:[...roots],items:extensions.map(publicExtension),diagnostics
    };
    if(name==='agent_extension_get') {
      const ext=extensions.find(x=>x.id===args.id);
      if(!ext) throw new Error('AGENT_EXTENSION_NOT_FOUND');
      return publicExtension(ext);
    }
    if(name==='agent_extension_match') {
      const requested=args.capabilities;
      const items=extensions.filter(ext=>requested.every(c=>ext.capabilities.includes(c))).map(publicExtension);
      return {schema:1,requestedCapabilities:[...requested],items,diagnostics};
    }
    throw new Error('AGENT_EXTENSION_TOOL_UNKNOWN');
  }
  return {definitions:agentExtensionToolDefinitions,execute,status};
}
