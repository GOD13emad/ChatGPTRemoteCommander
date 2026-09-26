import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, text) => fs.writeFileSync(path, text);
function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(from, to);
}

{
  const path = 'src/power-tools-v0.3.mjs';
  let s = read(path);
  s = replaceOnce(s,
    "maxResults: { type: 'integer', minimum: 1, maximum: 200 }, maxContentBytes: { type: 'integer', minimum: 1024, maximum: 1048576 }",
    "maxResults: { type: 'integer', minimum: 1, maximum: 1000 }, maxContentBytes: { type: 'integer', minimum: 1024 }",
    'search outward compatibility');
  s = replaceOnce(s,
    "timeoutMs: { type: 'integer', minimum: 1000, maximum: 15000 } }, required: ['command']",
    "timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 } }, required: ['command']",
    'run_shell outward compatibility');
  write(path, s);
}

{
  const path = 'src/server-v0.3.mjs';
  let s = read(path);
  s = replaceOnce(s,
    "import { compactToolSuccessPayload, serializeBoundedJsonResponse } from './retry-guard.mjs';",
    "import { compactToolSuccessPayload, serializeBoundedJsonResponse, synchronousCommandInput } from './retry-guard.mjs';",
    'retry guard import');
  s = replaceOnce(s,
    "timeoutMs: { type: 'integer', minimum: 1000, maximum: 15000 }\n      },",
    "timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 }\n      },",
    'run_project outward compatibility');
  s = replaceOnce(s,
    "    // Preserve existing no-effect semantic/authority checks before durable mutation intent where a reusable preflight exists.\n    if (name === 'run_project_command') await prepareProjectCommand(ctx, effectArgs);\n    return mutationIdempotency.execute({ requestId, tool: name, input: effectArgs }, () => executeToolEffect(name, effectArgs));",
    "    // Preserve no-effect transport/semantic/authority checks before durable mutation intent.\n    // The outward schema stays backward-compatible, while synchronous command\n    // execution remains hard-bounded to 15 seconds at runtime.\n    if (name === 'run_project_command') await prepareProjectCommand(ctx, synchronousCommandInput(effectArgs));\n    if (name === 'run_shell') await prepareShellCommand(ctx, synchronousCommandInput(effectArgs));\n    return mutationIdempotency.execute({ requestId, tool: name, input: effectArgs }, () => executeToolEffect(name, effectArgs));",
    'preflight ordering');
  s = replaceOnce(s,
    "function acceptedTrace(req, message, args, tool) {",
    "function transportMutationRequestId(req) {\n  const transportRequestId = traceId(header(req, 'x-request-id'));\n  if (!transportRequestId) return null;\n  return `transport-${createHash('sha256').update(transportRequestId).digest('hex')}`;\n}\nfunction acceptedTrace(req, message, args, tool) {",
    'transport requestId helper');
  s = replaceOnce(s,
    "      await audit(ctx, acceptedTrace(req, message, args, name));\n      try {\n        const result = await executeTool(name, args);",
    "      let executionArgs = args;\n      let requestIdSource = null;\n      if (isDirectMutationTool(name) && args.requestId === undefined) {\n        const derivedRequestId = transportMutationRequestId(req);\n        if (derivedRequestId) {\n          executionArgs = { ...args, requestId: derivedRequestId };\n          requestIdSource = 'transport';\n        }\n      }\n      await audit(ctx, { ...acceptedTrace(req, message, executionArgs, name), ...(requestIdSource ? { requestIdSource } : {}) });\n      try {\n        const result = await executeTool(name, executionArgs);",
    'legacy transport fallback');
  write(path, s);
}

{
  const path = 'test/mutation-idempotency-http.test.mjs';
  let s = read(path);
  s = replaceOnce(s,
    "async function post(port, id, name, args) {\n  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {\n    method: 'POST',\n    headers: { 'content-type': 'application/json' },",
    "async function post(port, id, name, args, extraHeaders = {}) {\n  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {\n    method: 'POST',\n    headers: { 'content-type': 'application/json', ...extraHeaders },",
    'post helper headers');
  const marker = "\n\ntest('full-power direct mutation catalog requires requestId across file/process/terminal/browser/GUI'";
  const regression = [
    '', '',
    "test('legacy cached client derives durable mutation idempotency from x-request-id', async () => {",
    "  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-mut-legacy-xreq-'));",
    "  const serverRoot=path.join(root,'server');",
    "  const dataRoot=path.join(root,'data');",
    "  const deliveryRoot=path.join(root,'private-delivery');",
    '  let running;',
    '  try {',
    "    await fs.mkdir(serverRoot,{recursive:true}); await fs.mkdir(dataRoot,{recursive:true});",
    "    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot,'src'), {recursive:true});",
    '    const canonicalDataRoot=await fs.realpath(dataRoot);',
    "    const target=path.join(canonicalDataRoot,'append.txt');",
    "    await fs.writeFile(target,'');",
    '    const port=await freePort();',
    '    const config={',
    "      host:'127.0.0.1', port, allowedRoots:[canonicalDataRoot], allowedPrograms:['node'],",
    '      maxReadBytes:1024*1024, maxWriteBytes:1024*1024, maxCommandMs:300000,',
    "      auditLog:'var/audit.jsonl', durableDelivery:{directory:deliveryRoot},",
    '      asyncOperations:{enabled:false},',
    '      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,',
    '        guiControl:{enabled:false},browserControl:{enabled:false}}',
    '    };',
    "    const configPath=path.join(serverRoot,'config.json');",
    '    await fs.writeFile(configPath,JSON.stringify(config,null,2));',
    '    running=await startServer(serverRoot,configPath);',
    '',
    "    const legacyHeaders={'x-request-id':'legacy-client-call-1'};",
    "    const first=await post(port,10,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);",
    '    assert.equal(first.result.isError,false);',
    "    assert.equal(await fs.readFile(target,'utf8'),'x');",
    '',
    "    const replay=await post(port,11,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);",
    '    assert.equal(replay.result.isError,false);',
    '    assert.deepEqual(replay.result.structuredContent,first.result.structuredContent);',
    "    assert.equal(await fs.readFile(target,'utf8'),'x');",
    '',
    "    const conflict=await post(port,12,'write_text',{path:target,content:'y',mode:'append'},legacyHeaders);",
    '    assert.equal(conflict.result.isError,true);',
    '    assert.match(conflict.result.content[0].text,/MUTATION_REQUEST_ID_CONFLICT/);',
    "    assert.equal(await fs.readFile(target,'utf8'),'x');",
    '',
    '    // Explicit requestId must override the transport-derived fallback.',
    "    const explicit=await post(port,13,'write_text',{requestId:'explicit-client-key-1',path:target,content:'z',mode:'append'},legacyHeaders);",
    '    assert.equal(explicit.result.isError,false);',
    "    assert.equal(await fs.readFile(target,'utf8'),'xz');",
    '',
    "    const missingBoth=await post(port,14,'write_text',{path:target,content:'q',mode:'append'});",
    '    assert.equal(missingBoth.result.isError,true);',
    '    assert.match(missingBoth.result.content[0].text,/MUTATION_REQUEST_ID_REQUIRED/);',
    "    assert.equal(await fs.readFile(target,'utf8'),'xz');",
    '',
    '    await stopServer(running.child); running=null;',
    '    running=await startServer(serverRoot,configPath);',
    "    const afterRestart=await post(port,15,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);",
    '    assert.equal(afterRestart.result.isError,false);',
    '    assert.deepEqual(afterRestart.result.structuredContent,first.result.structuredContent);',
    "    assert.equal(await fs.readFile(target,'utf8'),'xz');",
    '  } finally {',
    '    if (running) await stopServer(running.child);',
    '    await fs.rm(root,{recursive:true,force:true});',
    '  }',
    '});'
  ].join('\n');
  if (!s.includes(marker)) throw new Error('legacy HTTP regression insertion marker missing');
  s = s.replace(marker, regression + marker);
  write(path, s);
}

{
  const testPath = 'test/linux-host-schema-compat.test.mjs';
  if (fs.existsSync(testPath)) throw new Error(`${testPath} already exists`);
  const testSource = [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import os from 'node:os';",
    "import { powerToolDefinitions, searchFiles } from '../src/power-tools-v0.3.mjs';",
    "import { synchronousCommandInput } from '../src/retry-guard.mjs';",
    '',
    'const def = name => powerToolDefinitions.find(x => x.name === name);',
    '',
    "test('host compatibility schema stays broad while v0.9.4 runtime stays hard bounded', async () => {",
    "  assert.equal(def('run_shell').inputSchema.properties.timeoutMs.maximum, 30000);",
    "  assert.equal(def('search_files').inputSchema.properties.maxResults.maximum, 1000);",
    "  assert.equal(def('search_files').inputSchema.properties.maxContentBytes.maximum, undefined);",
    '  assert.throws(() => synchronousCommandInput({ timeoutMs: 30000 }), /SYNCHRONOUS_COMMAND_DEADLINE_RISK/);',
    '  assert.equal(synchronousCommandInput({ timeoutMs: 15000 }).timeoutMs, 15000);',
    '',
    "  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-host-compat-'));",
    '  try {',
    '    for (let i = 0; i < 260; i++) fs.writeFileSync(path.join(root, `f-${i}.txt`), \'x\');',
    '    const ctx = { roots: [root], config: { powerMode: { enabled: true, fullFilesystem: true, maxCommandMs: 600000, maxOutputBytes: 2097152 } } };',
    "    const result = await searchFiles(ctx, { path: root, pattern: 'f-', maxResults: 1000, maxContentBytes: 8 * 1024 * 1024, maxDurationMs: 10000 });",
    '    assert.ok(result.count <= 200, `runtime result count escaped 200 clamp: ${result.count}`);',
    '    assert.equal(result.truncated, true);',
    '  } finally {',
    '    fs.rmSync(root, { recursive: true, force: true });',
    '  }',
    '});',
    ''
  ].join('\n');
  write(testPath, testSource);

  const pkgPath='package.json';
  const pkg=JSON.parse(read(pkgPath));
  const needle='test/deferred-coverage.test.mjs test/retry-guard.test.mjs';
  if (!pkg.scripts.test.includes(needle)) throw new Error('package test insertion marker missing');
  pkg.scripts.test=pkg.scripts.test.replace(needle,'test/deferred-coverage.test.mjs test/linux-host-schema-compat.test.mjs test/retry-guard.test.mjs');
  write(pkgPath, JSON.stringify(pkg,null,2)+'\n');
}

console.log('V094_LEGACY_IDEMPOTENCY_HOTFIX_APPLIED');
