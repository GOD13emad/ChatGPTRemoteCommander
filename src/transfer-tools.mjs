import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PEERS = Object.freeze(['PC', 'Linux', 'EmadServer', 'Amirreza']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,90}$/;
const opts = { timeout: 14000, maxBuffer: 131072, windowsHide: true };
const immutable = (name, description, properties, required = [], readOnly = false) => ({
  name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: !readOnly }
});
const peerProperty = { type: 'string', enum: PEERS };
const idProperty = { type: 'string', pattern: ID_PATTERN.source, minLength: 3, maxLength: 91 };

export const transferMeshToolDefinitions = Object.freeze([
  immutable('transfer_mesh_info', 'Read configured local transfer identity, pilot path and available peers. Does not transfer bytes.', {}, [], true),
  immutable('transfer_mesh_send', 'Queue an authorized local file for encrypted pair-specific delivery; never sends file content through chat. Caller must provide an explicit local source path and unique transfer ID. Returns QUEUED, not delivered.', {
    peer: peerProperty, path: {type:'string',minLength:1,maxLength:4096}, id: idProperty
  }, ['peer','path','id']),
  immutable('transfer_mesh_status', 'Check if a previously queued transfer arrived intact at this local node, without accepting the file into the destination.', {
    peer: peerProperty, id: idProperty
  }, ['peer','id'], true),
  immutable('transfer_mesh_receive', 'Hash-verify a received transfer before exclusively materializing its file in an authorized destination directory. Existing destination files are never overwritten.', {
    peer: peerProperty, id: idProperty, dest: {type:'string',minLength:1,maxLength:4096}
  }, ['peer','id','dest'])
]);

function within(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function canonicalExisting(p) { return fs.realpathSync.native(path.resolve(p)); }
function allowedPath(target, allow, kind) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('TRANSFER_ABSOLUTE_PATH_REQUIRED');
  if (!Array.isArray(allow) || allow.length === 0) throw new Error('TRANSFER_ALLOWED_ROOTS_MISSING');
  const real = canonicalExisting(target);
  if (!allow.some(root => within(real, canonicalExisting(root)))) throw new Error('TRANSFER_PATH_NOT_ALLOWED');
  const info = fs.lstatSync(target);
  if (info.isSymbolicLink()) throw new Error('TRANSFER_SYMLINK_DENIED');
  if (kind === 'file' && !info.isFile()) throw new Error('TRANSFER_SOURCE_NOT_FILE');
  if (kind === 'directory' && !info.isDirectory()) throw new Error('TRANSFER_DEST_NOT_DIRECTORY');
  return real;
}

export function createTransferMeshTools({ config = {} } = {}) {
  const policy = config.transferMesh || {};
  if (policy.enabled !== true || config.powerMode?.enabled !== true) return { enabled: false, definitions: [], execute: async () => { throw new Error('TRANSFER_MESH_DISABLED'); } };
  if (!path.isAbsolute(String(policy.root || ''))) throw new Error('TRANSFER_MESH_ROOT_INVALID');
  const root = canonicalExisting(policy.root);
  const cli = canonicalExisting(path.join(root,'transfer.mjs'));
  const st = fs.lstatSync(cli);
  if (!st.isFile() || st.isSymbolicLink() || !within(cli,root)) throw new Error('TRANSFER_MESH_CLI_INVALID');
  const spawnEnv = { ...process.env, COMMANDER_TRANSFER_HOME: root };
  async function execute(name, args = {}) {
    if (!transferMeshToolDefinitions.some(t => t.name === name)) throw new Error('TRANSFER_UNKNOWN_TOOL');
    if (args.peer !== undefined && !PEERS.includes(args.peer)) throw new Error('TRANSFER_UNKNOWN_PEER');
    if (args.id !== undefined && !ID_PATTERN.test(args.id)) throw new Error('TRANSFER_ID_INVALID');
    let cmd;
    if (name === 'transfer_mesh_info') cmd = ['info'];
    if (name === 'transfer_mesh_send') {
      if (!PEERS.includes(args.peer) || !ID_PATTERN.test(args.id)) throw new Error('TRANSFER_ARGS_INVALID');
      const file = allowedPath(args.path, policy.sourceRoots, 'file');
      cmd = ['send','--peer',args.peer,'--path',file,'--id',args.id];
    }
    if (name === 'transfer_mesh_status') {
      if (!PEERS.includes(args.peer) || !ID_PATTERN.test(args.id)) throw new Error('TRANSFER_ARGS_INVALID');
      cmd = ['status','--peer',args.peer,'--id',args.id];
    }
    if (name === 'transfer_mesh_receive') {
      if (!PEERS.includes(args.peer) || !ID_PATTERN.test(args.id)) throw new Error('TRANSFER_ARGS_INVALID');
      const dest = allowedPath(args.dest, policy.destinationRoots, 'directory');
      cmd = ['receive','--peer',args.peer,'--id',args.id,'--dest',dest];
    }
    const { stdout } = await execFileAsync(process.execPath, [cli, ...cmd], { ...opts, env: spawnEnv });
    const lines = stdout.trim().split(/\r?\n/);
    const result = JSON.parse(lines.at(-1));
    if (result?.schema && result.schema !== 'ctmesh-v1') throw new Error('TRANSFER_SCHEMA_UNEXPECTED');
    return result;
  }
  return { enabled:true, definitions: transferMeshToolDefinitions.map(x => ({...x, inputSchema:{...x.inputSchema, properties:{...x.inputSchema.properties}}})), execute };
}
