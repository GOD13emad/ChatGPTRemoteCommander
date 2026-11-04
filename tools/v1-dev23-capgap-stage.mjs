#!/usr/bin/env node
// Scoped, reproducible QA bridge from an immutable V1 dev23 release to Commander V2 gap intake.
// It NEVER edits an installed V1 source, runtime, route, running process, or user profile.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const PINNED_V1_DEV23_SERVER_SHAS=Object.freeze(process.platform==='win32'
 ? ['fafd2151117456b7146fe3dafbe57f5f0507e2ebf8778964ab43562c569387e6']
 : ['c1c13efa74c75d00ca3b6e778a7af6b63f4053ac346caec12308d76117565933',
    'fafd2151117456b7146fe3dafbe57f5f0507e2ebf8778964ab43562c569387e6']);
const GAP_SHA='23f0f7a18133b506fe7273920d91841b8fcbae7317e4b19e0684240b48a33683';
const PKG_SHA='d40ea4c3d960146933907ed805e2ad2b135df9a20ba872499ebb9ccfa95b129b';
const DELIVERY_SHA='a4b1dff7e8293136215b12ade45062dc0f3a034f677f92e4a656679b513c5c47';
const MUTATION_SHA='1e47fb07934d7b34091cee4000ec1a1a63528e3a24d87a2a96cf3c883b3a69c9';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=x=>{throw Error('V1_DEV23_GAP_BRIDGE_'+x)};
function once(s,needle,replacement){
 if(s.split(needle).length!==2)fail('SOURCE_ANCHOR_DRIFT');
 return s.replace(needle,replacement);
}
function ancestryNoLinks(p){
 let cur=path.parse(p).root;
 for(const part of path.resolve(p).slice(cur.length).split(path.sep).filter(Boolean)){
  cur=path.join(cur,part);
  if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())fail('SYMLINK_PATH_DENIED');
 }
}
function noLinksBelow(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isSymbolicLink()||(!e.isDirectory()&&!e.isFile()))fail('NONREGULAR_SOURCE_DENIED');
  if(e.isDirectory())noLinksBelow(p);
 }
}
export function stageV1Dev23GapBridge(source,dest){
 if(typeof source!=='string'||typeof dest!=='string'||!path.isAbsolute(source)||!path.isAbsolute(dest))fail('ABSOLUTE_PATH_REQUIRED');
 const src=path.resolve(source),target=path.resolve(dest);
 const approvedBase=process.platform==='win32'
  ? path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'ChatGPTRemoteCommander','qa')
  : path.join(os.homedir(),'.local','state','CommanderV2','QA');
 if(path.dirname(target)!==approvedBase||path.basename(target)!=='v1-dev23-capgap-bridge')fail('QA_DESTINATION_REQUIRED');
 ancestryNoLinks(src);ancestryNoLinks(approvedBase);ancestryNoLinks(target);
 if(fs.existsSync(target))fail('QA_ALREADY_EXISTS');
 if(!fs.statSync(src).isDirectory())fail('SOURCE_NOT_DIRECTORY');
 const sourceServerSha=sha(fs.readFileSync(path.join(src,'src/server-v0.3.mjs')));
 if(!PINNED_V1_DEV23_SERVER_SHAS.includes(sourceServerSha))fail('UNPINNED_V1_SERVER_SHA');
 for(const [p,expected] of [
  ['src/server-v0.3.mjs',sourceServerSha],['package.json',PKG_SHA],
  ['src/delivery-store.mjs',DELIVERY_SHA],['src/mutation-idempotency.mjs',MUTATION_SHA]]){
  const f=path.join(src,p),st=fs.lstatSync(f);
  if(!st.isFile()||st.isSymbolicLink()||sha(fs.readFileSync(f))!==expected)fail('PINNED_SOURCE_CHANGED');
 }
 const pkg=JSON.parse(fs.readFileSync(path.join(src,'package.json'),'utf8'));
 if(pkg.name!=='chatgpt-remote-commander'||pkg.version!=='0.11.0-dev.23')fail('PACKAGE_VERSION_CHANGED');
 const scriptDir=path.dirname(fileURLToPath(import.meta.url));
 const bundled=path.join(scriptDir,'capability-gap-registry.mjs');
 const overlay=fs.existsSync(bundled)?bundled:path.join(scriptDir,'..','src','capability-gap-registry.mjs');
 const gap=fs.readFileSync(overlay);
 if(sha(gap)!==GAP_SHA||!gap.includes(Buffer.from('capability_gap_report')))fail('GAP_MODULE_PIN_MISMATCH');
 noLinksBelow(path.join(src,'src'));
 let server=fs.readFileSync(path.join(src,'src/server-v0.3.mjs'),'utf8');
 server=once(server,"import { MutationIdempotencyStore } from './mutation-idempotency.mjs';",
  "import { MutationIdempotencyStore } from './mutation-idempotency.mjs';\nimport { createCapabilityGapTools } from './capability-gap-registry.mjs';");
 server=once(server,"const VERSION = '0.11.0-dev.23';","const VERSION = '0.11.0-dev.23-capgap-qa';");
 server=once(server,'const conversationContinuationInstruction = () =>',
  "const capabilityGapInstruction = () => ' When a Commander tool or native permission is absent, report the sanitized observed requirement with capability_gap_report and consult capability_gap_list to avoid duplicates; recording never creates a permission grant, releases any binary or confirms a repaired effect.';\nconst conversationContinuationInstruction = () =>");
 const instr=' + chatStreamSafetyInstruction() + conversationContinuationInstruction();';
 if(server.split(instr).length!==3)fail('INSTRUCTION_ANCHOR_DRIFT');
 server=server.split(instr).join(' + chatStreamSafetyInstruction() + conversationContinuationInstruction() + capabilityGapInstruction();');
 server=once(server,
  'const mutationIdempotency = new MutationIdempotencyStore({ directory: deliveryStore.directory, scope: deliveryStore.scope });',
  'const mutationIdempotency = new MutationIdempotencyStore({ directory: deliveryStore.directory, scope: deliveryStore.scope });\nconst capabilityGapTools = createCapabilityGapTools({directory:deliveryStore.directory,scope:deliveryStore.scope,device:config.deviceName||os.hostname()});');
 server=once(server,'  ...agentExtensions.definitions,\n  ...transferMesh.definitions,',
  '  ...agentExtensions.definitions,\n  ...capabilityGapTools.definitions,\n  ...transferMesh.definitions,');
 server=once(server,"  if (name.startsWith('agent_extension_')) return agentExtensions.execute(name, args);",
  "  if (name.startsWith('agent_extension_')) return agentExtensions.execute(name, args);\n  if (name.startsWith('capability_gap_')) return capabilityGapTools.execute(name, args);");
 server=once(server,'          agentExtensions: 1,\n          browserCompanionMonitor: 1',
  '          agentExtensions: 1,\n          capabilityGapRegistry: 1,\n          browserCompanionMonitor: 1');
 server=once(server,'        agentExtensions: agentExtensions.status(),',
  '        agentExtensions: agentExtensions.status(),\n        capabilityGaps: capabilityGapTools.status(),');
 server=once(server,
  '        // Best-effort display-only telemetry after accepted tool completion.\n        coucouBridge.emitTool(name, { failed: result?.ok === false || result?.isError === true });',
  "        if(result?.ok===false||result?.isError===true){try{capabilityGapTools.captureFailure({tool:name,errorCode:String(result?.code??result?.reason??result?.error?.code??'')});}catch{}}\n        // Best-effort display-only telemetry after accepted tool completion.\n        coucouBridge.emitTool(name, { failed: result?.ok === false || result?.isError === true });");
 server=once(server,
  "      } catch (error) {\n        coucouBridge.emitTool(name, { failed: true });\n        await audit(ctx, { action: 'tool_error', tool: name, ok: false, error: error.message });",
  "      } catch (error) {\n        coucouBridge.emitTool(name, { failed: true });\n        try{capabilityGapTools.captureFailure({tool:name,errorCode:String(error?.code??error?.message??'')});}catch{}\n        await audit(ctx, { action: 'tool_error', tool: name, ok: false, error: error.message });");
 fs.mkdirSync(approvedBase,{recursive:true,mode:0o700});
 fs.mkdirSync(target,{mode:0o700});
 try{
  fs.cpSync(path.join(src,'src'),path.join(target,'src'),{recursive:true,force:false,errorOnExist:true});
  fs.copyFileSync(path.join(src,'package.json'),path.join(target,'package.json'),fs.constants.COPYFILE_EXCL);
  for(const [p,expected] of [['src/server-v0.3.mjs',sourceServerSha],['package.json',PKG_SHA],['src/delivery-store.mjs',DELIVERY_SHA],['src/mutation-idempotency.mjs',MUTATION_SHA]]){
   if(sha(fs.readFileSync(path.join(target,p)))!==expected)fail('COPIED_BASELINE_CHANGED');
  }
  fs.writeFileSync(path.join(target,'src','server-v0.3.mjs'),server,{mode:0o600});
  fs.writeFileSync(path.join(target,'src','capability-gap-registry.mjs'),gap,{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(target,'.v1-dev23-capgap-disposable-qa'),'DISPOSABLE_SOURCE_QA_ONLY\n',{flag:'wx',mode:0o600});
  const got=sha(fs.readFileSync(path.join(target,'src','server-v0.3.mjs')));
  if(got!==sha(Buffer.from(server)))fail('STAGE_READBACK_CHANGED');
  return {status:'V1_DEV23_CAPABILITY_GAP_BRIDGE_STAGED_QA_ONLY',baseline:sourceServerSha,
    patchedServer:got,gapModule:sha(gap),version:'0.11.0-dev.23-capgap-qa',
    installedRuntimeModified:false,qaPath:target};
 }catch(e){
  // This directory is created only after an explicit absence check above.
  fs.rmSync(target,{recursive:true,force:true});throw e;
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(stageV1Dev23GapBridge(process.argv[2],process.argv[3])));}
 catch(e){console.error(String(e?.message||e));process.exitCode=2;}
}
