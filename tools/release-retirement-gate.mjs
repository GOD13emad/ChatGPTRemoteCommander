#!/usr/bin/env node
// R204: fail-closed, read-only decision before ANY deletion of an old Core release.
// No ticket is created by this tool. Owner must approve ONE exact target AFTER
// browser-login preservation, workflow-state and rollback acceptance.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const RELEASE = /^v\d+\.\d+\.\d+-([0-9a-f]{12})$/;
const hash = value => createHash('sha256').update(value).digest('hex');

export function checkContract({ ticket, targetName, targetCommit, activeCommit,
    routeHashes, referencedPaths, retainedPaths, targetPath, now = Date.now() }) {
  const reject = reason => ({ allow: false, reason });
  if (!ticket || ticket.schema !== 1 ||
      ticket.intent !== 'OWNER_APPROVED_ONE_RETIRED_CORE_RELEASE' ||
      ticket.ownerApproved !== true) return reject('OWNER_ACCEPTANCE_REQUIRED');
  const required = ['applicationFunctional', 'browserProfilePreserved',
    'workflowHistoryPreserved', 'rollbackVerified'];
  if (!ticket.acceptedChecks || required.some(k => ticket.acceptedChecks[k] !== true))
    return reject('ACCEPTANCE_GATES_OPEN');
  if (ticket.targetName !== targetName || ticket.targetCommit !== targetCommit ||
      !HEX40.test(targetCommit) || !RELEASE.test(targetName) ||
      !targetCommit.startsWith(RELEASE.exec(targetName)[1]))
    return reject('TARGET_IDENTITY_MISMATCH');
  if (!HEX40.test(activeCommit) || ticket.activeCommit !== activeCommit ||
      activeCommit === targetCommit) return reject('ACTIVE_IDENTITY_MISMATCH');
  const when = Date.parse(ticket.approvedAtUtc);
  const until = Date.parse(ticket.expiresAtUtc);
  if (!Number.isFinite(when) || !Number.isFinite(until) ||
      when > now + 300000 || until <= now || until > when + 86400000 ||
      now - when > 86400000) return reject('APPROVAL_EXPIRED_OR_INVALID');
  if (!routeHashes || !ticket.routeHashes ||
      typeof ticket.routeHashes !== 'object' || Array.isArray(ticket.routeHashes))
    return reject('ROUTE_EVIDENCE_MISSING');
  const keys = Object.keys(routeHashes).sort();
  if (keys.length === 0 ||
      keys.join('|') !== Object.keys(ticket.routeHashes).sort().join('|') ||
      keys.some(k => !HEX64.test(routeHashes[k]) || ticket.routeHashes[k] !== routeHashes[k]))
    return reject('ROUTE_HASH_STALE');
  if (!Array.isArray(referencedPaths) || !Array.isArray(retainedPaths))
    return reject('UNKNOWN_PROCESS_OR_ROUTE_REFERENCES');
  if ([...referencedPaths, ...retainedPaths].some(p => path.resolve(p) === path.resolve(targetPath)))
    return reject('TARGET_STILL_REFERENCED');
  return { allow: true, reason: 'EXACT_OWNER_ACCEPTED_RETIREMENT' };
}

function inspect({ stateRoot, releaseRoot, routingRoot, target }) {
  const deny = reason => ({ allow: false, reason });
  for (const p of [stateRoot, releaseRoot, routingRoot, target]) {
    if (!p || !path.isAbsolute(p)) return deny('NON_ABSOLUTE_INPUT');
    let info;
    try { info = fs.lstatSync(p); } catch { return deny('MISSING_OR_UNREADABLE_INPUT'); }
    if (!info.isDirectory() || info.isSymbolicLink()) return deny('SYMLINK_OR_NON_DIRECTORY');
  }
  const state = fs.realpathSync(stateRoot);
  const releases = fs.realpathSync(releaseRoot);
  const routes = fs.realpathSync(routingRoot);
  const release = fs.realpathSync(target);
  if (path.dirname(releases) !== state || path.dirname(routes) !== state ||
      path.dirname(release) !== releases) return deny('TARGET_OUTSIDE_OWNED_RELEASE_ROOT');
  const targetName = path.basename(release);
  if (!RELEASE.test(targetName)) return deny('UNKNOWN_RELEASE_NAME');
  const ticketFile = path.join(state, 'maintenance', 'release-retirement-acceptance.json');
  if (!fs.existsSync(ticketFile)) return deny('OWNER_ACCEPTANCE_REQUIRED');
  if (fs.lstatSync(ticketFile).isSymbolicLink()) return deny('SYMLINK_TICKET');
  let ticket;
  try { ticket = JSON.parse(fs.readFileSync(ticketFile, 'utf8')); }
  catch { return deny('INVALID_OWNER_TICKET'); }
  let targetCommit;
  try {
    const gitDir = path.join(release, '.git');
    if (fs.lstatSync(gitDir).isSymbolicLink()) return deny('RELEASE_GIT_SYMLINK');
    targetCommit = execFileSync('git', ['-C', release, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', timeout: 5000 }).trim().toLowerCase();
    const gitStatus = execFileSync('git',
      ['-C', release, 'status', '--porcelain', '--untracked-files=all'],
      { encoding: 'utf8', timeout: 5000 }).trim();
    if (gitStatus) return deny('RELEASE_CONTAINS_UNKNOWN_LOCAL_CHANGES');
  } catch { return deny('RELEASE_GIT_PROVENANCE_UNPROVEN'); }
  const routeHashes = {};
  const referenced = [];
  let activeCommit = null;
  let routeFiles;
  try { routeFiles = fs.readdirSync(routes).filter(n =>
    n.endsWith('.json') && !n.endsWith('.runtime.json')).sort(); }
  catch { return deny('ROUTE_LIST_UNREADABLE'); }
  if (!routeFiles.includes('default.json')) return deny('CANONICAL_ROUTE_MISSING');
  for (const name of routeFiles) {
    const file = path.join(routes, name);
    let route, content;
    try {
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())
        return deny('ROUTE_FILE_UNTRUSTED');
      content = fs.readFileSync(file);
      route = JSON.parse(content.toString('utf8'));
    } catch { return deny('ROUTE_UNREADABLE_OR_INVALID'); }
    if (!route?.active || !HEX40.test(String(route.active.commit || '')) ||
        !route.active.projectDir || !route.profile) return deny('ACTIVE_ROUTE_INVALID');
    if (name === 'default.json') activeCommit = String(route.active.commit).toLowerCase();
    routeHashes[name] = hash(content);
    for (const item of [route.active, route.previous]) {
      if (!item) continue;
      if (typeof item.projectDir !== 'string' || !item.projectDir ||
          !path.isAbsolute(item.projectDir)) return deny('UNKNOWN_ROUTE_REFERENCE');
      referenced.push(item.projectDir);
    }
  }
  const retained = [];
  const keeperFile = path.join(state, 'retained-backends.json');
  if (fs.existsSync(keeperFile)) {
    try {
      if (fs.lstatSync(keeperFile).isSymbolicLink()) return deny('RETAINED_STATE_SYMLINK');
      const x = JSON.parse(fs.readFileSync(keeperFile, 'utf8'));
      if (!Array.isArray(x.items)) return deny('RETAINED_BACKEND_STATE_UNVERIFIED');
      for (const item of x.items) {
        if (typeof item.projectDir !== 'string' || !path.isAbsolute(item.projectDir))
          return deny('RETAINED_PROJECT_UNKNOWN');
        retained.push(item.projectDir);
      }
    } catch { return deny('RETAINED_BACKEND_STATE_UNVERIFIED'); }
  }
  return checkContract({ ticket, targetName, targetCommit, activeCommit,
    routeHashes, referencedPaths: referenced, retainedPaths: retained, targetPath: release });
}

if (process.argv[1] && path.basename(process.argv[1]) === 'release-retirement-gate.mjs') {
  const args = process.argv.slice(2);
  const config = {};
  try {
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i];
      if (!['--state-root', '--release-root', '--routing-root', '--target'].includes(key) ||
          !args[i + 1] || config[key]) throw new Error('INVALID_ARGUMENTS');
      config[key] = args[i + 1];
    }
    if (Object.keys(config).length !== 4) throw new Error('INCOMPLETE_ARGUMENTS');
    const result = inspect({ stateRoot: config['--state-root'],
      releaseRoot: config['--release-root'],
      routingRoot: config['--routing-root'], target: config['--target'] });
    console.log(JSON.stringify({ schema: 1, ...result }));
    if (!result.allow) process.exitCode = 3;
  } catch {
    console.log(JSON.stringify({ schema: 1, allow: false, reason: 'EVIDENCE_OR_ARGUMENT_ERROR' }));
    process.exitCode = 3;
  }
}
