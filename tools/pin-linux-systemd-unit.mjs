// Reconcile only the owner systemd unit's pinned launcher after a qualified route cutover.
// This tool never starts, stops, enables or restarts a service.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const within = (root, candidate) => {
  const rel = path.relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

export function reconcileUnit({ unitPath, routePath, releasesRoot, apply = false }) {
  for (const [name, value] of Object.entries({ unitPath, routePath, releasesRoot })) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw Error('UNIT_RECONCILE_INVALID_' + name);
  }
  const resolvedRoot = fs.realpathSync(releasesRoot);
  if (resolvedRoot !== path.resolve(releasesRoot)) throw Error('UNIT_RECONCILE_RELEASE_ROOT_SYMLINK');
  const routeStat = fs.lstatSync(routePath);
  if (!routeStat.isFile() || routeStat.isSymbolicLink()) throw Error('UNIT_RECONCILE_ROUTE_NOT_REGULAR');
  const route = JSON.parse(fs.readFileSync(routePath, 'utf8'));
  const active = route?.active?.projectDir;
  if (typeof active !== 'string' || !path.isAbsolute(active) ||
      !within(resolvedRoot, active) || !/^v[0-9]/.test(path.basename(active)) ||
      fs.realpathSync(active) !== path.resolve(active)) {
    throw Error('UNIT_RECONCILE_ACTIVE_ROUTE_INVALID');
  }
  const launcher = path.join(active, 'autostart-linux.sh');
  const launcherStat = fs.lstatSync(launcher);
  if (!launcherStat.isFile() || launcherStat.isSymbolicLink()) throw Error('UNIT_RECONCILE_LAUNCHER_INVALID');
  const unitStat = fs.lstatSync(unitPath);
  if (!unitStat.isFile() || unitStat.isSymbolicLink() ||
      (typeof process.getuid === 'function' && unitStat.uid !== process.getuid())) {
    throw Error('UNIT_RECONCILE_OWNER_UNIT_INVALID');
  }
  const old = fs.readFileSync(unitPath);
  const contents = old.toString('utf8');
  if (Buffer.from(contents, 'utf8').compare(old) !== 0) throw Error('UNIT_RECONCILE_UNIT_NOT_UTF8');
  const lines = contents.split(/(?<=\n)/u);
  const matched = lines.map((line, index) => ({ line, index }))
    .filter(x => x.line.trimStart().startsWith('ExecStart='));
  if (matched.length !== 1) throw Error('UNIT_RECONCILE_EXECSTART_COUNT');
  const oldLine = matched[0].line.replace(/\r?\n$/, '');
  const prefix = 'ExecStart=/bin/bash ';
  if (!oldLine.startsWith(prefix) || !oldLine.endsWith('/autostart-linux.sh')) {
    throw Error('UNIT_RECONCILE_EXECSTART_SHAPE');
  }
  const priorLauncher = oldLine.slice(prefix.length);
  if (!path.isAbsolute(priorLauncher) ||
      !within(resolvedRoot, path.dirname(priorLauncher)) ||
      !/^v[0-9]/.test(path.basename(path.dirname(priorLauncher))) ||
      path.join(path.dirname(priorLauncher), 'autostart-linux.sh') !== priorLauncher) {
    throw Error('UNIT_RECONCILE_UNOWNED_LAUNCHER');
  }
  const desiredLine = prefix + launcher;
  if (oldLine === desiredLine) return { ok: true, changed: false, active };
  if (!apply) return { ok: true, changed: false, wouldChange: true, active };
  const updated = [...lines];
  const eol = matched[0].line.endsWith('\r\n') ? '\r\n'
    : matched[0].line.endsWith('\n') ? '\n' : '';
  updated[matched[0].index] = desiredLine + eol;
  const next = updated.join('');
  const before = sha(old);
  // Guard stale reads and a concurrently replaced unit; do not overwrite unknown state.
  const checkStat = fs.lstatSync(unitPath);
  if (checkStat.dev !== unitStat.dev || checkStat.ino !== unitStat.ino ||
      checkStat.mtimeMs !== unitStat.mtimeMs ||
      sha(fs.readFileSync(unitPath)) !== before) throw Error('UNIT_RECONCILE_STALE_PRECONDITION');
  const temp = path.join(path.dirname(unitPath), '.rc-supervisor-unit-' + process.pid + '-' + crypto.randomUUID());
  try {
    fs.writeFileSync(temp, next, { flag: 'wx', mode: unitStat.mode & 0o777 });
    fs.chmodSync(temp, unitStat.mode & 0o777);
    fs.renameSync(temp, unitPath);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  if (sha(fs.readFileSync(unitPath)) !== sha(Buffer.from(next, 'utf8')))
    throw Error('UNIT_RECONCILE_READBACK_MISMATCH');
  return { ok: true, changed: true, active };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--apply') { options.apply = true; continue; }
    if (a === '--route' || a === '--unit' || a === '--releases-root') {
      if (!process.argv[i + 1]) throw Error('UNIT_RECONCILE_MISSING_ARGUMENT');
      options[{ '--route': 'routePath', '--unit': 'unitPath', '--releases-root': 'releasesRoot' }[a]] = process.argv[++i];
      continue;
    }
    throw Error('UNIT_RECONCILE_UNKNOWN_ARGUMENT');
  }
  try {
    const result = reconcileUnit(options);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('UNIT_RECONCILE_REFUSED ' + error.message + '\n');
    process.exitCode = 1;
  }
}
