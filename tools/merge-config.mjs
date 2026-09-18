import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value == null) throw new Error('invalid arguments');
    out[key.slice(2)] = value;
  }
  return out;
}

const a = parseArgs(process.argv.slice(2));
for (const key of ['config','public','mode','workspace','platform']) if (!a[key]) throw new Error(`missing --${key}`);
if (!['preserve','standard','power'].includes(a.mode)) throw new Error('invalid --mode');
const guiMode = a.gui ?? 'preserve';
if (!['preserve','enable','disable'].includes(guiMode)) throw new Error('invalid --gui');
if (!['windows','linux'].includes(a.platform)) throw new Error('invalid --platform');

const configPath = path.resolve(a.config);
const publicPath = path.resolve(a.public);
const exists = fs.existsSync(configPath);

if (a.mode === 'preserve' && guiMode === 'preserve' && exists) {
  const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  process.stdout.write(JSON.stringify({
    changed: false,
    powerMode: current.powerMode?.enabled === true,
    guiControl: current.powerMode?.guiControl?.enabled === true
  }));
  process.exit(0);
}

const source = exists ? configPath : publicPath;
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
data.powerMode ??= {};
const p = data.powerMode;
p.guiControl ??= {};
const gui = p.guiControl;

if (!exists) {
  data.deviceName ??= os.hostname();
  data.allowedRoots = [path.resolve(a.workspace)];
  const programs = a.platform === 'windows'
    ? ['git','node','npm','npx','python','py','dotnet','cmake','ninja']
    : ['git','node','npm','npx','python3','python','dotnet','cmake','ninja'];
  data.allowedPrograms = programs;
}

if (a.mode === 'power') {
  p.enabled = true;
  p.fullFilesystem = true;
  p.allowShell = true;
  p.allowProcessControl = true;
  p.allowPermanentDelete ??= false;
  p.backupRoot ??= path.join(os.homedir(), '.chatgpt-remote-commander', 'backups');
  p.maxFileBytes ??= 33554432;
  p.maxCommandMs ??= 600000;
  p.maxOutputBytes ??= 4194304;
  p.maxTerminalBufferBytes ??= 8388608;
  p.blockedShellPatterns ??= a.platform === 'windows'
    ? ['(^|\\s)shutdown(?:\\.exe)?(?:\\s|$)','Restart-Computer','Stop-Computer','(^|\\s)logoff(?:\\.exe)?(?:\\s|$)','ExitWindowsEx']
    : ['shutdown','reboot','poweroff','halt','systemctl.*reboot','systemctl.*poweroff','init 0','init 6'];
} else if (a.mode === 'standard') {
  p.enabled = false;
}

if (a.platform === 'linux') {
  if (guiMode === 'enable') throw new Error('native GUI control is Windows-only in v0.5.0');
  gui.enabled = false;
} else {
  if (guiMode === 'enable') {
    if (p.enabled !== true) throw new Error('GUI control requires Power Mode');
    gui.enabled = true;
    gui.allowScreenshot = true;
    gui.allowMouse = true;
    gui.allowKeyboard = true;
    gui.allowWindowFocus = true;
    gui.maxScreenshotWidth ??= 1600;
    gui.maxScreenshotBytes ??= 8388608;
  } else if (guiMode === 'disable' || p.enabled !== true) {
    gui.enabled = false;
    gui.allowScreenshot = false;
    gui.allowMouse = false;
    gui.allowKeyboard = false;
    gui.allowWindowFocus = false;
  }
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
const temp = `${configPath}.tmp-${process.pid}`;
fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { encoding:'utf8', mode:0o600 });
JSON.parse(fs.readFileSync(temp, 'utf8'));
fs.renameSync(temp, configPath);
process.stdout.write(JSON.stringify({
  changed: true,
  powerMode: p.enabled === true,
  guiControl: gui.enabled === true
}));
