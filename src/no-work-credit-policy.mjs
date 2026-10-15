import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Commander may use pre-qualified local inference; Work/Codex/Claude/cloud
// spending is never inferred from FULL_POWER. This is a Core planner gate,
// not an OS firewall or a proof of account-level billing.
export const WORK_CREDIT_POLICY = 'DENY_WORK_CREDITS';
// Publisher-reviewed, immutable source bytes. A hash supplied by a caller is
// not evidence of a credit-free executable and must never self-authorize.
// The launcher forcibly selects localhost llama.cpp even though the standalone
// adapter also supports other providers outside Commander.
const TRUSTED_LOCAL_SCRIPT_SHA256 = 'ae0fc4374a2ccbddff047decee9ed3b04f98ff2a2df8fbf6d2c283df892c38a3';
const TRUSTED_LOCAL_ADAPTER_SHA256 = '0c3a6f84423ae2ba94ddd448cad9bb194cc7a738972110a638536cbd83ce4d7f';
// Pinned, default-off Windows Ollama proposal-only adapter. No process
// launch or provider discovery is implied merely by allowing this source.
const TRUSTED_WINDOWS_QWEN_SHA256 = 'ce7d22362e47a7b71d9cc508e43e0d52503f46d351c47f96f969e9f28e506fa6';

function pinnedOwnedFile(file, digest, { platform = process.platform } = {}) {
  const flavor=platform === 'win32' ? path.win32 : path.posix;
  if (!['linux','win32'].includes(platform) || typeof file !== 'string' ||
      !flavor.isAbsolute(file) ||
      (platform === 'win32' && !/^[A-Za-z]:\\/.test(file)) ||
      typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) return false;
  try {
    const lstat = fs.lstatSync(file);
    if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.nlink !== 1 ||
        (platform === 'linux' && ((lstat.mode & 0o022) !== 0 ||
          lstat.uid !== process.getuid())) ||
        (platform === 'win32'
          ? fs.realpathSync.native(file).toLowerCase() !== file.toLowerCase()
          : fs.realpathSync.native(file) !== file)) return false;
    if (lstat.size > 64 * 1024) return false;
    const data = fs.readFileSync(file);
    return createHash('sha256').update(data).digest('hex') === digest.toLowerCase();
  } catch {
    return false;
  }
}

export function localCreditFreeProvider(provider, options = {}) {
  if (!provider || provider.kind !== 'command' ||
      provider.localOnly !== true ||
      provider.creditPolicy !== WORK_CREDIT_POLICY ||
      !Array.isArray(provider.args) || provider.args.length !== 1) return false;
  const platform=options.platform ?? process.platform;
  const script=provider.args[0];
  if (platform === 'win32') {
    return provider.endpoint === 'http://127.0.0.1:18882/api/chat' &&
      provider.model === 'qwen3:4b-instruct' &&
      provider.executable === process.execPath &&
      provider.adapterFile === undefined &&
      typeof script === 'string' &&
      path.win32.basename(script) === 'windows-local-qwen3.mjs' &&
      provider.scriptSha256 === TRUSTED_WINDOWS_QWEN_SHA256 &&
      pinnedOwnedFile(script, TRUSTED_WINDOWS_QWEN_SHA256, { platform });
  }
  if (platform !== 'linux' ||
      provider.endpoint !== 'http://127.0.0.1:18080/v1/chat/completions' ||
      provider.executable !== '/bin/sh') return false;
  const adapter=provider.adapterFile;
  if (typeof script !== 'string' || typeof adapter !== 'string' ||
      path.basename(script) !== 'linux-local-qwen3.sh' ||
      path.basename(adapter) !== 'adapter.mjs' ||
      path.dirname(script) !== path.dirname(adapter)) return false;
  return provider.scriptSha256 === TRUSTED_LOCAL_SCRIPT_SHA256 &&
    provider.adapterSha256 === TRUSTED_LOCAL_ADAPTER_SHA256 &&
    pinnedOwnedFile(script, TRUSTED_LOCAL_SCRIPT_SHA256, { platform }) &&
    pinnedOwnedFile(adapter, TRUSTED_LOCAL_ADAPTER_SHA256, { platform });
}

export function workCreditRunnerGate(runner, options = {}) {
  if (runner?.enabled !== true) return { allowed: true, status: 'RUNNER_OFF', policy: WORK_CREDIT_POLICY };
  if (localCreditFreeProvider(runner?.provider, options)) {
    // No adaptive expansion, worker or unapproved tool can be given authority
    // by inherited FULL_POWER state, including manual ticks.
    const allowed = new Set(['read_text', 'file_info', 'list_directory']);
    const names = runner.allowedTools;
    if (!Array.isArray(names) || names.length < 1 ||
        names.some(name => !allowed.has(name)) || runner.team !== undefined ||
        runner.adaptive?.enabled === true || runner.worker?.enabled === true ||
        (runner.maxActions !== undefined && (!Number.isInteger(runner.maxActions) || runner.maxActions < 1 || runner.maxActions > 3)) ||
        (runner.maxPlannerCalls !== undefined && (!Number.isInteger(runner.maxPlannerCalls) || runner.maxPlannerCalls < 1 || runner.maxPlannerCalls > 6)) ||
        (runner.maxDurationMs !== undefined && (!Number.isInteger(runner.maxDurationMs) || runner.maxDurationMs < 1000 || runner.maxDurationMs > 120000))) {
      return { allowed: false, status: 'UNATTENDED_LOCAL_SCOPE_UNVERIFIED', policy: WORK_CREDIT_POLICY };
    }
    if (runner.autoTick === true && (
        !Number.isInteger(runner.maxActions) ||
        !Number.isInteger(runner.maxPlannerCalls) ||
        !Number.isInteger(runner.maxDurationMs))) {
      return { allowed: false, status: 'UNATTENDED_LOCAL_SCOPE_UNVERIFIED', policy: WORK_CREDIT_POLICY };
    }
    return { allowed: true, status: 'PINNED_LOCAL_PROPOSAL_ONLY', policy: WORK_CREDIT_POLICY };
  }
  return { allowed: false, status: 'WORK_CREDITS_PROVIDER_BLOCKED', policy: WORK_CREDIT_POLICY };
}
