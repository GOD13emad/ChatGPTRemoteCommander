import fs from 'node:fs';
import path from 'node:path';
import { enableProjectRunner, disableProjectRunner } from '../src/runner-config.mjs';

function parse(argv) {
  const out = { kind: 'codex', autoTick: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--disable') { out.disable = true; continue; }
    if (a === '--auto-tick') {
      const v = argv[++i];
      if (!['on','off'].includes(v)) throw new Error('PROJECT_RUNNER_AUTO_TICK');
      out.autoTick = v === 'on';
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error('PROJECT_RUNNER_ARGUMENT');
    if (a === '--config') out.configPath = v;
    else if (a === '--provider-executable') out.executable = v;
    else if (a === '--kind') out.kind = v;
    else if (a === '--timeout-ms') out.timeoutMs = Number(v);
    else if (a === '--max-output-bytes') out.maxOutputBytes = Number(v);
    else throw new Error('PROJECT_RUNNER_ARGUMENT');
  }
  if (!out.configPath) throw new Error('PROJECT_RUNNER_CONFIG_REQUIRED');
  if (!out.disable && !out.executable) throw new Error('PROJECT_RUNNER_EXECUTABLE_REQUIRED');
  return out;
}
function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

const args = parse(process.argv.slice(2));
const configPath = path.resolve(args.configPath);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
let runner;
if (args.disable) {
  runner = disableProjectRunner(config);
} else {
  const executable = fs.realpathSync(path.resolve(args.executable));
  if (!fs.statSync(executable).isFile()) throw new Error('PROJECT_RUNNER_EXECUTABLE_NOT_FILE');
  runner = enableProjectRunner(config, {
    executable,
    kind: args.kind,
    autoTick: args.autoTick,
    ...(Number.isSafeInteger(args.timeoutMs) ? { timeoutMs: args.timeoutMs } : {}),
    ...(Number.isSafeInteger(args.maxOutputBytes) ? { maxOutputBytes: args.maxOutputBytes } : {})
  });
}
atomic(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({
  status: 'PROJECT_RUNNER_CONFIG_PASS',
  config: configPath,
  enabled: runner.enabled === true,
  autoTick: runner.autoTick === true,
  provider: runner.provider ? {
    kind: runner.provider.kind,
    executable: runner.provider.executable,
    timeoutMs: runner.provider.timeoutMs,
    maxOutputBytes: runner.provider.maxOutputBytes
  } : null
}));
