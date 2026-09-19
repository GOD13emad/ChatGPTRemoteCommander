// One-use, exact-baseline integration. Run only in the isolated candidate checkout.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const file = path.resolve('src/server-v0.3.mjs');
const raw = fs.readFileSync(file);
const normalized = raw.toString('utf8').replaceAll('\r\n','\n');
const expected = 'f3001f20bd9d4277b2b904162b0297d615d8c1242bd3a50dad312783b80aa55b';
const digest = b => createHash('sha256').update(b).digest('hex');
if (digest(raw) !== expected && digest(normalized) !== expected) throw Error('SERVER_BASELINE_HASH_MISMATCH');
let source = normalized;
function once(a,b) { if(source.split(a).length!==2) throw Error('PATCH_ANCHOR_NOT_UNIQUE'); source=source.replace(a,b); }
once("const VERSION = '0.6.4';", "let workflowTools = null;\nconst VERSION = '0.6.4';");
once('function serverMeta() {', `// Opt-in only. Existing 0.6.4 catalog is unchanged when disabled.
if (config.durableWorkflows?.enabled === true) {
  const { createWorkflowTools } = await import('./workflow-tools.mjs');
  workflowTools = createWorkflowTools({
    config, roots, device: config.deviceName || os.hostname(), configSha256,
    lookup: toolDefinition, validateSchema: validateJsonSchema,
    dispatch: async (name, args, workflow) => {
      // Further restrict file operations to the project, even in full Power Mode.
      // Executed programs remain OS processes, NOT sandboxed by these path checks.
      const scoped = { ...ctx, roots: [workflow.root], config: {
        ...config, allowedRoots: [workflow.root],
        powerMode: { ...config.powerMode, fullFilesystem: false }
      } };
      switch (name) {
        case 'system_status': return executeTool(name, args);
        case 'list_directory': return listDirectory(scoped, args);
        case 'read_text': return readText(scoped, args);
        case 'write_text': return writeText(scoped, args);
        case 'run_project_command': return runProjectCommand(scoped, args);
        default: return name.startsWith('gui_')
          ? executeGuiTool(scoped, name, args) : executePowerTool(scoped, name, args);
      }
    }
  });
  TOOLS.push(...workflowTools.definitions);
}
function serverMeta() {`);
once("  if (!toolDefinition(name)) throw protocolFailure(200, -32602, 'Unknown tool');", "  if (!toolDefinition(name)) throw protocolFailure(200, -32602, 'Unknown tool');\n  if (name.startsWith('workflow_')) return workflowTools.execute(name, args);");
once('        configSha256,\n        powerMode:', "        configSha256,\n        durableWorkflows: { enabled: !!workflowTools, revision: workflowTools ? 'durable-workflows-r1' : null, automaticReplay: false },\n        powerMode:");
fs.writeFileSync(file,source,'utf8');
const packagePath=path.resolve('package.json');
const packageRaw=fs.readFileSync(packagePath,'utf8');
const packageHash='584b50ad809bbeabd1b504b378b4dbd9c6a24d0fb3d818d2fad4f646de50cb15';
if(digest(packageRaw)!==packageHash && digest(packageRaw.replaceAll('\r\n','\n'))!==packageHash) throw Error('PACKAGE_BASELINE_HASH_MISMATCH');
const pkg=JSON.parse(packageRaw);
if(pkg.scripts['test:workflows']) throw Error('ALREADY_APPLIED');
pkg.scripts['test:workflows']='node --test test/workflow-store.test.mjs test/workflow-tools.test.mjs test/workflow-http.test.mjs';
pkg.scripts['workflow']='node tools/workflow-cli.mjs';
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n','utf8');
console.log(JSON.stringify({applied:true,revision:'durable-workflows-r1',serverSha256:digest(source),publicVersionUnchanged:'0.6.4',productionPromotion:false}));
