// V2-G1: pure route-identity contract. No permission grants, I/O, state, or runner.
// This module rejects ambiguous identity; enforcement remains with the trusted
// Commander caller-binding, authorization registry, and Workflow/GUI leases.
import { isProxy } from 'node:util/types';

export const V2_ROUTE_CONTRACT_VERSION = 1;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIELDS = Object.freeze(['hostId', 'principalId', 'profileId', 'conversationId', 'operationId']);
const KINDS = new Set(['host-shell', 'workflow-root', 'desktop-seat', 'browser-target']);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function record(input, names) {
  // Snapshot only plain-data objects. Reject getters and Proxy traps before
  // consuming identity so grant, lease and receipt cannot see different values.
  if (!input || typeof input !== 'object' || Array.isArray(input) || isProxy(input))
    fail('V2_ROUTE_RECORD_REQUIRED');
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) fail('V2_ROUTE_RECORD_REQUIRED');
  const actual = Reflect.ownKeys(input);
  if (actual.length !== names.length || actual.some(key => !names.includes(key)))
    fail('V2_ROUTE_UNKNOWN_OR_MISSING_FIELD');
  const snapshot = Object.create(null);
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      fail('V2_ROUTE_RECORD_REQUIRED');
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function identifier(value) {
  if (typeof value !== 'string' || !ID.test(value) || value === '.' || value === '..') fail('V2_ROUTE_INVALID_ID');
  return value;
}

/** Structurally validate an exact selected operation. Not an authorization check. */
export function normalizeV2Route(input) {
  const request = record(input, [...FIELDS, 'target']);
  const normalized = Object.create(null);
  for (const key of FIELDS) normalized[key] = identifier(request[key]);
  const target = record(request.target, ['kind', 'id']);
  if (typeof target.kind !== 'string' || !KINDS.has(target.kind)) fail('V2_ROUTE_INVALID_TARGET');
  normalized.target = Object.freeze({ kind: target.kind, id: identifier(target.id) });
  return Object.freeze(normalized);
}

/** Match the route against identity observed by the trusted transport, never caller claims. */
export function assertV2CallerBinding(route, observed) {
  const parsed = normalizeV2Route(route);
  const snapshot = record(observed, ['hostId', 'principalId', 'profileId', 'conversationId']);
  for (const field of ['hostId', 'principalId', 'profileId', 'conversationId']) {
    if (identifier(snapshot[field]) !== parsed[field]) fail('V2_ROUTE_CALLER_MISMATCH');
  }
  return parsed;
}

/** Different chats on the SAME resource contend for the SAME existing lease. */
export function v2ResourceLeaseKey(route) {
  const r = normalizeV2Route(route);
  return JSON.stringify([V2_ROUTE_CONTRACT_VERSION, r.hostId, r.target.kind, r.target.id]);
}

/** Idempotency is request- and caller-scoped; other chats may not steal receipts. */
export function v2OperationKey(route) {
  const r = normalizeV2Route(route);
  return JSON.stringify([V2_ROUTE_CONTRACT_VERSION, r.hostId, r.principalId, r.profileId, r.conversationId, r.operationId]);
}
