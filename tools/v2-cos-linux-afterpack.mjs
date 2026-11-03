// Electron-builder Linux afterPack hook for approved CoS desktop staging.
// Source-only integration hook: it does not install packages or change V1.
// When integrating upstream, CHAIN the existing macOS afterPack hook.
import fs from 'node:fs';
import path from 'node:path';

const fail = code => { throw new Error('V2_COS_AFTERPACK_'+code); };
const kind = name => name === 'linux-unpacked' || /^linux-(?:arm64|armv7l|x64)-unpacked$/.test(name);
const modeOf = stat => stat.mode & 0o7777;
const special = mode => (mode & 0o7000) !== 0;

export function repairLinuxAfterPack(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context))
    fail('CONTEXT_INVALID');
  if (context.electronPlatformName !== 'linux')
    return Object.freeze({status:'OTHER_PLATFORM_NOOP',files:0,directories:0});
  const dir = context.appOutDir;
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !kind(path.basename(dir)))
    fail('STAGING_ROOT_INVALID');
  if (!fs.existsSync(dir)) fail('STAGING_OWNER_INVALID');
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() ||
      (process.getuid && st.uid !== process.getuid()))
    fail('STAGING_OWNER_INVALID');
  // Require the actual unpacked Electron staging layout before allowing writes.
  const contents = fs.readdirSync(dir);
  const binary = ['chat-on-steroids','commander-v2-workspace-preview'].filter(x=>contents.includes(x));
  if (binary.length !== 1 || !fs.lstatSync(path.join(dir,binary[0])).isFile())
    fail('ELECTRON_BINARY_MISSING');
  const asar = path.join(dir,'resources','app.asar');
  if (!fs.existsSync(asar) || !fs.lstatSync(asar).isFile() || fs.lstatSync(asar).isSymbolicLink())
    fail('ASAR_MISSING');

  // Preflight every entry before touching even one permission bit.
  const files=[], directories=[], stack=[dir];
  while (stack.length) {
    const folder=stack.pop();
    const folderStat=fs.lstatSync(folder);
    if (!folderStat.isDirectory() || folderStat.isSymbolicLink() ||
        (process.getuid && folderStat.uid !== process.getuid()) ||
        special(modeOf(folderStat)))
      fail('ENTRY_INVALID');
    directories.push(folder);
    for (const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      const item=path.join(folder,entry.name);
      const info=fs.lstatSync(item);
      if (entry.isSymbolicLink()) continue; // retain vendor links without following them
      if (process.getuid && info.uid !== process.getuid()) fail('ENTRY_OWNER_INVALID');
      if (special(modeOf(info))) fail('SPECIAL_MODE_UNEXPECTED');
      if (info.isDirectory()) stack.push(item);
      else if (info.isFile() && info.nlink===1)
        files.push({path:item,mode:info.mode & 0o100 ? 0o755 : 0o644});
      else fail('SPECIAL_FILE_OR_HARDLINK');
      if (files.length+directories.length+stack.length>200000) fail('TREE_TOO_LARGE');
    }
  }
  // The hook changes metadata only. All binary/resource bytes remain identical.
  for (const item of files) fs.chmodSync(item.path,item.mode);
  for (const item of directories) fs.chmodSync(item,0o755);
  return Object.freeze({status:'LINUX_STAGED_MODES_REPAIRED',files:files.length,directories:directories.length});
}

export default async function afterPack(context) {
  return repairLinuxAfterPack(context);
}
