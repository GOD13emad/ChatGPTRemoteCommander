// Non-exhaustive defense-in-depth for a known hazardous Windows inventory query.
// Win32_Product uses MSI consistency checking on enumeration, not a passive read.
// Does not grant permission for any genuine MSI repair or Windows elevation.
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

export const UNSAFE_MSI_AUDIT = 'UNSAFE_WIN32_PRODUCT_INVENTORY';

function violation() {
  const e = new Error(UNSAFE_MSI_AUDIT);
  e.code = UNSAFE_MSI_AUDIT;
  return e;
}

function normalized(text) {
  return String(text ?? '')
    .replace(/\u0060\s*\r?\n/g, ' ')
    .replace(/\^\s*\r?\n/g, ' ')
    .replace(/\s+/g, ' ');
}
export function isUnsafeMsiInventoryCommand(command) {
  const c = normalized(command);
  if (!c) return false;
  // Lexically narrow: an ordinary Select-String or rg query mentioning the
  // class name alone does not call WMI and must remain available to auditors.
  return [
    /\b(?:get-ciminstance|gcim|get-wmiobject|gwmi)\b.{0,900}\bwin32_product\b/i,
    /\bwmic(?:\.exe)?\b.{0,140}(?:\bproduct\b|\bpath\s+win32_product\b)/i,
    /\b(?:invoke-cimmethod|invoke-wmimethod)\b.{0,900}\bwin32_product\b/i,
    /\b(?:select|select-object)\b.{0,400}\bfrom\s+win32_product\b/i
  ].some(re => re.test(c));
}

export function assertSafeSoftwareInventoryCommand(command, { platform = process.platform } = {}) {
  if (platform === 'win32' && isUnsafeMsiInventoryCommand(command)) throw violation();
}

function interpreter(program) {
  const base = path.win32.basename(String(program || '').replaceAll('/', '\\')).toLowerCase();
  return ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'wmic', 'wmic.exe', 'cmd', 'cmd.exe'].includes(base)
    ? base : null;
}

// Enforce on direct run_project_command as well as run_shell and terminal input.
// Only recognized concrete PowerShell scripts are statically scanned. Dynamic
// dispatch, late script generation and imported modules require independent
// source-level controls; do not claim this is a universal script sandbox.
export async function assertSafeSoftwareInventoryInvocation(
  program, args, cwd, { platform = process.platform } = {}
) {
  if (platform !== 'win32') return;
  const base = interpreter(program);
  if (!base) return;
  const values = Array.isArray(args) ? args.map(x => String(x)) : [];
  assertSafeSoftwareInventoryCommand([program, ...values].join(' '), { platform });
  if (!['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe'].includes(base)) return;
  const at = values.findIndex(x => /^-(?:file|f)$/i.test(x));
  if (at < 0 || !values[at + 1]) return;
  const specified = values[at + 1].replace(/^["']|["']$/g, '');
  const p = path.win32.isAbsolute(specified) ? specified : path.win32.resolve(cwd, specified);
  let info;
  try { info = await stat(p); } catch (error) {
    if (error?.code === 'ENOENT') return; // Existing executor reports missing files.
    throw error;
  }
  if (!info.isFile()) return;
  if (info.size > 2 * 1024 * 1024) throw violation(); // Cannot safely preflight unknown large script.
  const content = await readFile(p, 'utf8');
  assertSafeSoftwareInventoryCommand(content, { platform });
}
