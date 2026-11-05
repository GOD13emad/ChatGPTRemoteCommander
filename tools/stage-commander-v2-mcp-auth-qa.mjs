#!/usr/bin/env node
// Exact-source, reversible QA-only MCP capability bearer guard.
// Does not patch any installed V1, tunnel, service or other profile.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Error('CMDV2_MCP_AUTH_QA_'+code)};
const BEFORE={
 linux:{server:'d62c98fd122b3492aac678593f5181ba765820f8383b68c365487338501e0219',manifest:'c6c64886301c427bae8b8934304eaf82ee6382fefc01aee8e013e0745c4f1306'},
 win32:{server:'dda3d17ebf62f16315f494a9160402cd8a040fba7f93400a3f9310565fc201ad',manifest:'aff379a6ffccbf6e0837d2dcf01415283b0a44205ce4aece6b19cfe914a4c923'}
};
const AUTH_LABEL='QA_EPHEMERAL_PROCESS_BEARER_NOT_OWNER_LOGIN';
function read(p){
 const st=fs.lstatSync(p);
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)fail('FILE_ALIAS_OR_MISSING');
 return fs.readFileSync(p);
}
function noAlias(p){
 const absolute=path.resolve(p);
 let base=path.parse(absolute).root;
 for(const part of absolute.slice(base.length).split(path.sep).filter(Boolean)){
  base=path.join(base,part);
  if(fs.existsSync(base)&&fs.lstatSync(base).isSymbolicLink())fail('SYMLINK_ANCESTOR');
 }
}
function replaceOnce(s,a,b){
 if(s.split(a).length!==2)fail('PATCH_ANCHOR_CHANGED');
 return s.replace(a,b);
}
function patch(serverRaw,manifestRaw){
 let server=serverRaw.toString('utf8');
 server=replaceOnce(server,"import { createHash } from 'node:crypto';","import { createHash, timingSafeEqual } from 'node:crypto';");
 server=replaceOnce(server,
  "const config = JSON.parse(configRaw);\nassertLocalTransport(config);",
  "const config = JSON.parse(configRaw);\n"+
  "// Isolated Commander V2 QA Core requires a process-private, one-start capability bearer.\n"+
  "// No owner login is inferred; this is not an OAuth resource server or a privilege grant.\n"+
  "const qaBearerHex = process.env.COMMANDER_V2_QA_MCP_SECRET;\n"+
  "if (typeof qaBearerHex !== 'string' || !/^[a-f0-9]{64}$/.test(qaBearerHex))\n"+
  "  throw new Error('COMMANDER_V2_QA_MCP_BEARER_REQUIRED');\n"+
  "const qaBearerBytes = Buffer.from(qaBearerHex, 'hex');\n"+
  "delete process.env.COMMANDER_V2_QA_MCP_SECRET;\n"+
  "assertLocalTransport(config);"
 );
 server=replaceOnce(server,
  "    if (req.method === 'GET' && url.pathname === '/health') {\n"+
  "      return sendJson(res, 200, { ok: true, name: 'chatgpt-remote-commander', version: VERSION, configSha256,\n"+
  "        instance: config.instance ?? { profile: 'default', isolated: false } });\n"+
  "    }",
  "    if (req.method === 'GET' && url.pathname === '/health') {\n"+
  "      // Minimal read-only health without profile labels, config hashes or credentials.\n"+
  "      return sendJson(res, 200, { ok: true, name: 'commander-v2-qa-core', version: VERSION });\n"+
  "    }"
 );
 server=replaceOnce(server,
  "    if (req.method !== 'POST' || url.pathname !== '/mcp') {\n"+
  "      return sendJson(res, 404, { error: 'not_found' });\n"+
  "    }\n"+
  "    const message = await readJsonBody(req);",
  "    if (req.method !== 'POST' || url.pathname !== '/mcp') {\n"+
  "      return sendJson(res, 404, { error: 'not_found' });\n"+
  "    }\n"+
  "    // Authenticate before any JSON-RPC parsing/dispatch or tool side effect.\n"+
  "    const authorization = req.headers.authorization;\n"+
  "    if (typeof authorization !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(authorization) ||\n"+
  "        !timingSafeEqual(Buffer.from(authorization.slice(7), 'hex'), qaBearerBytes)) {\n"+
  "      return sendJson(res, 401, { error: 'unauthorized' });\n"+
  "    }\n"+
  "    const message = await readJsonBody(req);"
 );
 const bytes=Buffer.from(server,'utf8');
 const meta=JSON.parse(manifestRaw.toString('utf8'));
 if(meta.schema!==1||meta.mode!=='QA_INTERNAL_NOT_ACTIVATED'||meta.files?.length!==75||
  meta.serverSha!==sha(serverRaw)||meta.qaTransportAuth!==undefined)
  fail('OLD_MANIFEST_CONTRACT');
 const entry=meta.files.find(f=>f.file==='src/server-v0.3.mjs');
 if(!entry||entry.bytes!==serverRaw.length||entry.sha256!==sha(serverRaw))fail('OLD_MANIFEST_SOURCE_SHA');
 entry.bytes=bytes.length;entry.sha256=sha(bytes);
 meta.serverSha=sha(bytes);
 meta.qaTransportAuth=AUTH_LABEL;
 const manifest=Buffer.from(JSON.stringify(meta,null,2)+'\n','utf8');
 return {server:bytes,manifest,meta};
}
function roots(root){
 if(typeof root!=='string'||!path.isAbsolute(root)||!BEFORE[process.platform])fail('ABSOLUTE_NATIVE_QA_REQUIRED');
 const base=path.resolve(root),name=process.platform==='win32'?'official-cos-tag2150-sparse-20261104':'cos2150-unified-rebuild-20261104';
 if(path.basename(base)!==name)fail('UNRELATED_ROOT');
 noAlias(base);
 if(read(path.join(base,'.commander-v2-isolated-qa')).toString()!=='V2_COS_DISPOSABLE_SOURCE_QA_ONLY\n')fail('QA_MARKER_INVALID');
 const component=path.join(base,'resources','commander-v1-core');
 noAlias(component);noAlias(path.join(component,'src'));
 const server=path.join(component,'src','server-v0.3.mjs'),manifest=path.join(component,'MANIFEST.json');
 const backup=path.join(base,'.commander-v2-mcp-auth-qa-backup');
 noAlias(backup);
 return {base,server,manifest,backup};
}
export function execute(action,root){
 const p=roots(root),pin=BEFORE[process.platform];
 const backupServer=path.join(p.backup,'server-v0.3.mjs');
 const backupManifest=path.join(p.backup,'MANIFEST.json');
 if(action==='verify'){
  if(!fs.existsSync(p.backup))fail('NO_AUTH_QA_STAGE');
  if(sha(read(backupServer))!==pin.server||sha(read(backupManifest))!==pin.manifest)fail('ORIGINAL_BASELINE_CHANGED');
  const x=patch(read(backupServer),read(backupManifest));
  if(sha(read(p.server))!==sha(x.server)||sha(read(p.manifest))!==sha(x.manifest))fail('AUTH_STAGE_DRIFT');
  return {gate:'CMDV2_QA_MCP_BEARER_SOURCE_PASS',platform:process.platform,manifestSha:sha(x.manifest),serverSha:sha(x.server),
    files:x.meta.files.length,auth:'QA_PROCESS_BEARER',ownerLoginVerified:false,
    oldV1ServiceTouched:false,productionInstalled:false};
 }
 if(action!=='stage'||fs.existsSync(p.backup))fail('REQUIRE_FRESH_STAGE');
 const oldServer=read(p.server),oldManifest=read(p.manifest);
 if(sha(oldServer)!==pin.server||sha(oldManifest)!==pin.manifest)fail('SOURCE_PIN_MISMATCH');
 const x=patch(oldServer,oldManifest);
 fs.mkdirSync(p.backup,{mode:0o700});
 let serverWritten=false,manifestWritten=false;
 try{
  fs.writeFileSync(backupServer,oldServer,{flag:'wx',mode:0o600});
  fs.writeFileSync(backupManifest,oldManifest,{flag:'wx',mode:0o600});
  if(sha(read(p.server))!==pin.server||sha(read(p.manifest))!==pin.manifest)fail('CONCURRENT_PATCH');
  const files=[[p.server,x.server],[p.manifest,x.manifest]];
  for(const [file,data] of files){
   const temp=file+'.authqa-'+process.pid;
   if(fs.existsSync(temp))fail('TEMP_COLLISION');
   try{fs.writeFileSync(temp,data,{flag:'wx',mode:0o600});fs.renameSync(temp,file)}
   finally{if(fs.existsSync(temp))fs.rmSync(temp)}
   if(file===p.server)serverWritten=true;else manifestWritten=true;
  }
  return {...execute('verify',root),status:'AUTH_GATED_QA_STAGED_RECOVERABLE'};
 }catch(e){
  if(manifestWritten&&sha(read(p.manifest))===sha(x.manifest))fs.writeFileSync(p.manifest,oldManifest);
  if(serverWritten&&sha(read(p.server))===sha(x.server))fs.writeFileSync(p.server,oldServer);
  throw e;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(execute(process.argv[2],process.argv[3])));}
 catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
