import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, text) { fs.writeFileSync(path, text); }
function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(from, to);
}

// 1) Keep outward schemas backward-compatible with cached ChatGPT hosts while
// preserving the v0.9.4 hard runtime safety bounds.
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

// 2) Preserve direct-mutation idempotency for legacy/cached clients that cannot
// send requestId yet. A trusted transport x-request-id is hashed into a bounded
// durable key. Explicit requestId always wins; missing both remains fail-closed.
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

// 3) Extend the HTTP idempotency regression to prove legacy transport fallback,
// replay, conflict handling, explicit-key precedence, and fail-closed behavior.
{
  const path = 'test/mutation-idempotency-http.test.mjs';
  let s = read(path);
  s = replaceOnce(s,
    "async function post(port, id, name, args) {\n  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {\n    method: 'POST',\n    headers: { 'content-type': 'application/json' },",
    "async function post(port, id, name, args, extraHeaders = {}) {\n  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {\n    method: 'POST',\n    headers: { 'content-type': 'application/json', ...extraHeaders },",
    'post helper headers');
  const marker = "\n\ntest('full-power direct mutation catalog requires requestId across file/process/terminal/browser/GUI'";
  const regression = `\n\ntest('legacy cached client derives durable mutation idempotency from x-request-id', async () => {\n  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-mut-legacy-xreq-'));\n  const serverRoot=path.join(root,'server');\n  const dataRoot=path.join(root,'data');\n  const deliveryRoot=path.join(root,'private-delivery');\n  let running;\n  try {\n    await fs.mkdir(serverRoot,{recursive:true}); await fs.mkdir(dataRoot,{recursive:true});\n    await fs.cp(new URL('../src/', import.meta.url), path.join(serverRoot,'src'), {recursive:true});\n    const canonicalDataRoot=await fs.realpath(dataRoot);\n    const target=path.join(canonicalDataRoot,'append.txt');\n    await fs.writeFile(target,'');\n    const port=await freePort();\n    const config={\n      host:'127.0.0.1', port, allowedRoots:[canonicalDataRoot], allowedPrograms:['node'],\n      maxReadBytes:1024*1024, maxWriteBytes:1024*1024, maxCommandMs:300000,\n      auditLog:'var/audit.jsonl', durableDelivery:{directory:deliveryRoot},\n      asyncOperations:{enabled:false},\n      powerMode:{enabled:false,fullFilesystem:false,allowShell:false,allowProcessControl:false,allowPermanentDelete:false,\n        guiControl:{enabled:false},browserControl:{enabled:false}}\n    };\n    const configPath=path.join(serverRoot,'config.json');\n    await fs.writeFile(configPath,JSON.stringify(config,null,2));\n    running=await startServer(serverRoot,configPath);\n\n    const legacyHeaders={'x-request-id':'legacy-client-call-1'};\n    const first=await post(port,10,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);\n    assert.equal(first.result.isError,false);\n    assert.equal(await fs.readFile(target,'utf8'),'x');\n\n    const replay=await post(port,11,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);\n    assert.equal(replay.result.isError,false);\n    assert.deepEqual(replay.result.structuredContent,first.result.structuredContent);\n    assert.equal(await fs.readFile(target,'utf8'),'x');\n\n    const conflict=await post(port,12,'write_text',{path:target,content:'y',mode:'append'},legacyHeaders);\n    assert.equal(conflict.result.isError,true);\n    assert.match(conflict.result.content[0].text,/MUTATION_REQUEST_ID_CONFLICT/);\n    assert.equal(await fs.readFile(target,'utf8'),'x');\n\n    // An explicit requestId must override the transport-derived fallback.\n    const explicit=await post(port,13,'write_text',{requestId:'explicit-client-key-1',path:target,content:'z',mode:'append'},legacyHeaders);\n    assert.equal(explicit.result.isError,false);\n    assert.equal(await fs.readFile(target,'utf8'),'xz');\n\n    const missingBoth=await post(port,14,'write_text',{path:target,content:'q',mode:'append'});\n    assert.equal(missingBoth.result.isError,true);\n    assert.match(missingBoth.result.content[0].text,/MUTATION_REQUEST_ID_REQUIRED/);\n    assert.equal(await fs.readFile(target,'utf8'),'xz');\n\n    await stopServer(running.child); running=null;\n    running=await startServer(serverRoot,configPath);\n    const afterRestart=await post(port,15,'write_text',{path:target,content:'x',mode:'append'},legacyHeaders);\n    assert.equal(afterRestart.result.isError,false);\n    assert.deepEqual(afterRestart.result.structuredContent,first.result.structuredContent);\n    assert.equal(await fs.readFile(target,'utf8'),'xz');\n  } finally {\n    if (running) await stopServer(running.child);\n    await fs.rm(root,{recursive:true,force:true});\n  }\n});`;
  if (!s.includes(marker)) throw new Error('legacy HTTP regression insertion marker missing');
  s = s.replace(marker, regression + marker);
  write(path, s);
}

// 4) Add a focused schema/runtime separation regression and include it in npm test.
{
  const testPath = 'test/linux-host-schema-compat.test.mjs';
  if (fs.existsSync(testPath)) throw new Error(`${testPath} already exists`);
  write(testPath, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport os from 'node:os';\nimport { powerToolDefinitions, searchFiles } from '../src/power-tools-v0.3.mjs';\nimport { synchronousCommandInput } from '../src/retry-guard.mjs';\n\nconst def = name => powerToolDefinitions.find(x => x.name === name);\n\ntest('host compatibility schema stays broad while v0.9.4 runtime stays hard bounded', async () => {\n  assert.equal(def('run_shell').inputSchema.properties.timeoutMs.maximum, 30000);\n  assert.equal(def('search_files').inputSchema.properties.maxResults.maximum, 1000);\n  assert.equal(def('search_files').inputSchema.properties.maxContentBytes.maximum, undefined);\n  assert.throws(() => synchronousCommandInput({ timeoutMs: 30000 }), /SYNCHRONOUS_COMMAND_DEADLINE_RISK/);\n  assert.equal(synchronousCommandInput({ timeoutMs: 15000 }).timeoutMs, 15000);\n\n  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-host-compat-'));\n  try {\n    for (let i = 0; i < 260; i++) fs.writeFileSync(path.join(root, \\`f-\\${i}.txt\\`), 'x');\n    const ctx = { roots: [root], config: { powerMode: { enabled: true, fullFilesystem: true, maxCommandMs: 600000, maxOutputBytes: 2097152 } } };\n    const result = await searchFiles(ctx, { path: root, pattern: 'f-', maxResults: 1000, maxContentBytes: 8 * 1024 * 1024, maxDurationMs: 10000 });\n    assert.ok(result.count <= 200, \\`runtime result count escaped 200 clamp: \\${result.count}\\`);\n    assert.equal(result.truncated, true);\n  } finally {\n    fs.rmSync(root, { recursive: true, force: true });\n  }\n});\n`);

  const pkgPath='package.json';
  const pkg=JSON.parse(read(pkgPath));
  const needle='test/deferred-coverage.test.mjs test/retry-guard.test.mjs';
  if (!pkg.scripts.test.includes(needle)) throw new Error('package test insertion marker missing');
  pkg.scripts.test=pkg.scripts.test.replace(needle,'test/deferred-coverage.test.mjs test/linux-host-schema-compat.test.mjs test/retry-guard.test.mjs');
  write(pkgPath, JSON.stringify(pkg,null,2)+'\n');
}

console.log('V094_LEGACY_IDEMPOTENCY_HOTFIX_APPLIED');
