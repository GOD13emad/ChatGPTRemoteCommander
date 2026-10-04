import os from 'node:os';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const POLICY_CODE = 'CODEX_DELEGATION_FORBIDDEN';
const STATUS_CODE = 'CODEX_DELEGATION_DEFAULT_DENY';
const AUTH_POLICY = 'owner-authorized-local-launch';
const INTERPRETERS = new Set([
  'python','python.exe','pythonw','pythonw.exe','node','node.exe',
  'pwsh','pwsh.exe','powershell','powershell.exe','bash','bash.exe','sh','sh.exe',
  'wscript','wscript.exe','cscript','cscript.exe','cmd','cmd.exe'
]);

function violation() {
  const error = new Error(POLICY_CODE);
  error.code = POLICY_CODE;
  return error;
}
function unquote(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '');
}

export function codexLaunchAuthorized(ctxOrConfig) {
  const config = ctxOrConfig?.config ?? ctxOrConfig;
  return config?.powerMode?.enabled === true
    && config?.capabilityProfile?.tier === 'FULL_POWER'
    && config?.capabilityProfile?.explicitlyAuthorized === true
    && config?.powerMode?.codexControl?.allowLaunch === true;
}

export function codexMaintenanceAuthorized(ctxOrConfig, input = {}) {
  const config = ctxOrConfig?.config ?? ctxOrConfig;
  return input?.confirmCurrentRequest === true
    && config?.powerMode?.enabled === true
    && config?.powerMode?.allowShell === true
    && config?.powerMode?.allowProcessControl === true
    && config?.capabilityProfile?.tier === 'FULL_POWER'
    && config?.capabilityProfile?.explicitlyAuthorized === true;
}

export function isCodexExecutable(value) {
  const text = unquote(value).replaceAll('\\','/');
  const base = path.basename(text).toLowerCase();
  return base === 'codex' || base === 'codex.exe'
    || /\/tools\/codex-cli\//i.test(text)
    || /\/@openai\/codex-(?:win32|linux|darwin)/i.test(text)
    || /\/node_modules\/.bin\/codex(?:\.cmd|\.exe)?$/i.test(text);
}

export function delegationRequirement(reason = 'Work/Codex may be useful for this task.', config = null) {
  const local = codexLaunchAuthorized(config);
  return {
    approvalRequired: true,
    policy: local ? AUTH_POLICY : 'external-handoff-only',
    default: 'continue_chat',
    reason: String(reason).slice(0, 2000),
    options: [
      { id: 'work_codex', label: 'Move to Work/Codex' },
      { id: 'continue_chat', label: 'Continue in this chat with Remote Commander' }
    ],
    commanderMayLaunchCodex: local,
    nextStep: local
      ? 'Current Full-Power owner policy permits local Codex launch only when the current user request explicitly calls for Codex. Otherwise continue in this chat.'
      : 'Ask the user in the current chat to choose. If Work/Codex is selected, hand off outside Remote Commander. Commander itself must not launch Codex.'
  };
}

export function delegationStatus(config = null) {
  const local = codexLaunchAuthorized(config);
  return {
    active: false,
    policy: local ? AUTH_POLICY : 'external-handoff-only',
    default: 'continue_chat',
    commanderMayLaunchCodex: local
  };
}

export function assertNoCodexExecutable(value, { allowCodex = false } = {}) {
  if (!allowCodex && isCodexExecutable(value)) throw violation();
}

function commandReferencesCodex(command) {
  const text = String(command ?? '');
  if (!text) return false;
  const patterns = [
    /(?:^|[;&|]\s*|&&\s*|\|\|\s*)codex(?:\.exe)?(?:\s|$)/im,
    /\bcodex(?:\.exe)?\s+(?:exec|review|app-server|remote-control|agents|cloud|resume|queue|fork|login|plugin)\b/i,
    /&\s*["'][^"'\r\n]*codex(?:\.exe)?["']/i,
    /\bStart-Process\b[^\r\n]{0,240}\bcodex(?:\.exe)?\b/i,
    /\bShellExecute\b[^\r\n]{0,240}\bcodex(?:\.exe)?\b/i,
    /(?:tools[\\/]codex-cli|@openai[\\/]codex-(?:win32|linux|darwin)|node_modules[\\/].bin[\\/]codex)/i,
    /\b(?:npx|npm\s+exec|pnpm\s+(?:dlx|exec)|yarn\s+dlx|bunx)\b[^\r\n]{0,240}(?:@openai[\\/]codex|\bcodex\b)/i
  ];
  return patterns.some(pattern => pattern.test(text));
}

export function assertNoCodexCommand(command, { allowCodex = false } = {}) {
  if (!allowCodex && commandReferencesCodex(command)) throw violation();
}

function interpreterScript(program, args, cwd) {
  const base = path.basename(unquote(program)).toLowerCase();
  if (!INTERPRETERS.has(base)) return null;
  const list = Array.isArray(args) ? args.map(String) : [];
  if (base === 'cmd' || base === 'cmd.exe') {
    const idx = list.findIndex(x => /^\/(?:c|k)$/i.test(x));
    if (idx >= 0) assertNoCodexCommand(list.slice(idx + 1).join(' '));
    return null;
  }
  if (base === 'pwsh' || base === 'pwsh.exe' || base === 'powershell' || base === 'powershell.exe') {
    const commandIndex = list.findIndex(x => /^-(?:command|c)$/i.test(x));
    if (commandIndex >= 0) assertNoCodexCommand(list.slice(commandIndex + 1).join(' '));
    const fileIndex = list.findIndex(x => /^-(?:file|f)$/i.test(x));
    if (fileIndex >= 0 && list[fileIndex + 1]) {
      const candidate = unquote(list[fileIndex + 1]);
      return path.resolve(path.isAbsolute(candidate) ? candidate : path.join(cwd, candidate));
    }
    return null;
  }
  const candidate = list.find(x => x && !x.startsWith('-'));
  if (!candidate) return null;
  const resolved = unquote(candidate);
  return path.resolve(path.isAbsolute(resolved) ? resolved : path.join(cwd, resolved));
}

function packageManagerCodex(program, args) {
  const base = path.basename(unquote(program)).toLowerCase();
  if (!['npx','npx.cmd','npm','npm.cmd','pnpm','pnpm.cmd','yarn','yarn.cmd','bun','bun.exe','bunx','bunx.exe'].includes(base)) return false;
  return /(?:@openai[\\/]codex|\bcodex(?:\.exe)?\b)/i.test((Array.isArray(args) ? args : []).map(String).join(' '));
}

function scriptLaunchesCodex(text) {
  const directLaunch = [
    /subprocess\.(?:Popen|run|call|check_call|check_output)\s*\([^\r\n]{0,700}(?:["']codex(?:\.exe)?["']|\bcodex\b|codex-cli|@openai[\\/]codex)/i,
    /(?:spawn|spawnSync|exec|execFile|execSync|execFileSync)\s*\([^\r\n]{0,700}(?:["']codex(?:\.exe)?["']|\bcodex\b|codex-cli|@openai[\\/]codex)/i,
    /\bStart-Process\b[^\r\n]{0,700}(?:codex(?:\.exe)?|codex-cli|@openai[\\/]codex)/i,
    /\bShellExecute\b[^\r\n]{0,700}(?:codex(?:\.exe)?|codex-cli|@openai[\\/]codex)/i,
    /\b(?:npx|npm\s+exec|pnpm\s+(?:dlx|exec)|yarn\s+dlx|bunx)\b[^\r\n]{0,700}(?:@openai[\\/]codex|\bcodex\b)/i
  ];
  if (directLaunch.some(pattern => pattern.test(text))) return true;

  const variableNames = new Set();
  for (const match of text.matchAll(/(?:^|[;\r\n])\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:r|u|f|fr|rf)?["'][^"'\r\n]*(?:codex(?:\.exe)?|codex-cli|@openai[\\/]codex)[^"'\r\n]*["']/ig)) {
    variableNames.add(match[1]);
  }
  for (const name of variableNames) {
    const pattern = new RegExp(
      '(?:subprocess\\.(?:Popen|run|call|check_call|check_output)|spawn|spawnSync|exec|execFile|execSync|execFileSync)\\s*\\([^\\r\\n]{0,700}\\b' + name + '\\b',
      'i'
    );
    if (pattern.test(text)) return true;
  }
  return false;
}

export async function assertNoCodexDelegatingScript(program, args, cwd, { allowCodex = false } = {}) {
  if (allowCodex) return;
  assertNoCodexExecutable(program);
  if (packageManagerCodex(program, args)) throw violation();
  const argText=(Array.isArray(args)?args:[]).map(String).join(' ');
  if (/(?:tools[\\/]codex-cli|@openai[\\/]codex-(?:win32|linux|darwin)|node_modules[\\/].bin[\\/]codex)/i.test(argText)) throw violation();

  const script = interpreterScript(program, args, cwd);
  if (!script) return;
  let info;
  try { info = await stat(script); } catch { return; }
  if (!info.isFile() || info.size > 2 * 1024 * 1024) return;
  let text;
  try { text = await readFile(script, 'utf8'); } catch { return; }
  if (scriptLaunchesCodex(text)) throw violation();
}

export async function assertNoCodexShellDelegation(command, cwd, { allowCodex = false } = {}) {
  if (allowCodex) return;
  assertNoCodexCommand(command);
  const text=String(command ?? '').trim();
  if(!text) return;
  const match=text.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+(.*)$/s);
  if(!match) return;
  const program=match[1]??match[2]??match[3];
  const rest=match[4]??'';
  const base=path.basename(program).toLowerCase();
  if(!INTERPRETERS.has(base) && !['npx','npx.cmd','npm','npm.cmd','pnpm','pnpm.cmd','yarn','yarn.cmd','bun','bun.exe','bunx','bunx.exe'].includes(base)) return;
  const tokens=rest.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(unquote)??[];
  await assertNoCodexDelegatingScript(program,tokens,cwd);
}

function isCommanderNoCodexHome(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return false;
  try {
    let root = path.resolve(path.join(os.tmpdir(), 'chatgpt-remote-commander-no-codex'));
    let target = path.resolve(raw);
    if (process.platform === 'win32') {
      root = root.toLowerCase();
      target = target.toLowerCase();
    }
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export function commanderChildEnv(cwdOrSource, maybeSource, { allowCodex = false } = {}) {
  const source = cwdOrSource && typeof cwdOrSource === 'object' && !Array.isArray(cwdOrSource) && maybeSource === undefined
    ? cwdOrSource
    : (maybeSource ?? process.env);
  const env = { ...source };
  if (!allowCodex) {
    for (const key of [
      'OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_ORG_ID','OPENAI_ORGANIZATION',
      'CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_REFRESH_TOKEN'
    ]) delete env[key];
    env.REMOTE_COMMANDER_NO_CODEX = '1';
    env.CODEX_HOME = path.join(os.tmpdir(), 'chatgpt-remote-commander-no-codex', String(process.pid));
  } else {
    delete env.REMOTE_COMMANDER_NO_CODEX;
    if (isCommanderNoCodexHome(env.CODEX_HOME)) delete env.CODEX_HOME;
  }
  return env;
}

export function commanderCodexMaintenanceEnv(source = process.env) {
  const env = { ...source };
  for (const key of [
    'OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_ORG_ID','OPENAI_ORGANIZATION',
    'CODEX_API_KEY','CODEX_ACCESS_TOKEN','CODEX_REFRESH_TOKEN'
  ]) delete env[key];
  delete env.REMOTE_COMMANDER_NO_CODEX;
  if (isCommanderNoCodexHome(env.CODEX_HOME)) delete env.CODEX_HOME;
  env.REMOTE_COMMANDER_CODEX_MAINTENANCE = '1';
  return env;
}

export const NO_CODEX_POLICY = Object.freeze({
  code: STATUS_CODE,
  mode: 'DEFAULT_DENY',
  default: 'CONTINUE_CHAT',
  externalHandoffRequiresCurrentChatChoice: true,
  commanderMayLaunchCodex: false,
  scopedMaintenance: {
    tool: 'codex_plugin_refresh',
    requiresExplicitCurrentRequest: true,
    arbitraryCodexLaunchAllowed: false
  },
  reason: 'Remote Commander defaults to the current ChatGPT chat as the reasoning layer. Local Codex launch is denied unless an explicitly authorized Full-Power profile opts in.'
});
