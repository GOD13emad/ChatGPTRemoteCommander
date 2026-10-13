import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkEventAuthorizer } from '../src/work-events-policy.mjs';

const issuer = 'https://idp.example.test';
const resource = 'https://mcp.example.test/mcp';
const expiresAt = () => Math.floor(Date.now() / 1000) + 600;
const goodClaims = () => ({ issuer, resource, subject: 'person-a', tenantId: 'team-a', expiresAt: expiresAt(), scopes: ['commander.events.subscribe'] });
const project = { id: 'project-alpha', tenantId: 'team-a', ownerIssuer: issuer, ownerSubject: 'person-a' };
function fixture({ claims = goodClaims(), record = project, reject = false } = {}) {
  let verifyCalls = 0;
  let accessCalls = 0;
  const gate = createWorkEventAuthorizer({
    issuer, resource,
    verifyAccessToken: async token => { verifyCalls++; if (reject || token !== 'fixture-token') throw new Error('invalid token'); return claims; },
    resolveProjectAccess: async id => { accessCalls++; return id === project.id ? record : null; }
  });
  return { gate, counters: () => ({ verifyCalls, accessCalls }) };
}

test('verified scoped OAuth identity may subscribe only to an owned project', async () => {
  const { gate, counters } = fixture();
  const result = await gate({ accessToken: 'fixture-token', projectId: 'project-alpha' });
  assert.deepEqual(result, { projectId: 'project-alpha', eventName: 'operation.completed', ownerSubject: 'person-a', tenantId: 'team-a' });
  assert.deepEqual(counters(), { verifyCalls: 1, accessCalls: 1 });
  assert.equal(JSON.stringify(result).includes('fixture-token'), false);
});

test('missing, invalid or unverified credentials cannot resolve a project', async () => {
  for (const input of ['', null, 'fake']) {
    const { gate, counters } = fixture({ reject: true });
    await assert.rejects(gate({ accessToken: input, projectId: 'project-alpha' }), /unauthorized/i);
    assert.equal(counters().accessCalls, 0);
  }
});

test('wrong OAuth audience, issuer, expiry or missing scope blocks before project lookup', async () => {
  for (const claims of [
    { ...goodClaims(), resource: 'https://some-other-server.test/mcp' },
    { ...goodClaims(), issuer: 'https://other-idp.example.test' },
    { ...goodClaims(), expiresAt: Math.floor(Date.now() / 1000) - 30 },
    { ...goodClaims(), scopes: [] },
    { ...goodClaims(), subject: '' },
    { ...goodClaims(), tenantId: '' },
    { ...goodClaims(), expiresAt: undefined }
  ]) {
    const { gate, counters } = fixture({ claims });
    await assert.rejects(gate({ accessToken: 'fixture-token', projectId: 'project-alpha' }), /unauthorized/i);
    assert.equal(counters().accessCalls, 0);
  }
});

test('project access denies other owner, other tenant, unknown project and unknown ownership', async () => {
  const records = [
    { ...project, ownerSubject: 'person-b' },
    { ...project, tenantId: 'team-b' },
    { ...project, ownerIssuer: 'https://other-idp.example.test' },
    { ...project, ownerSubject: undefined }
  ];
  for (const record of records) {
    const { gate } = fixture({ record });
    await assert.rejects(gate({ accessToken: 'fixture-token', projectId: 'project-alpha' }), /forbidden/i);
  }
  const { gate } = fixture();
  await assert.rejects(gate({ accessToken: 'fixture-token', projectId: 'unknown-project' }), /forbidden/i);
});

test('malformed project IDs and missing verifier/ACL source fail closed', async () => {
  assert.throws(() => createWorkEventAuthorizer({ issuer, resource }), /verifier/i);
  assert.throws(() => createWorkEventAuthorizer({ issuer, resource, verifyAccessToken: async () => goodClaims() }), /project/i);
  const { gate } = fixture();
  for (const projectId of ['../wrong', 'https://evil.test/', '', 'a'.repeat(129), null]) {
    await assert.rejects(gate({ accessToken: 'fixture-token', projectId }), /forbidden|invalid/i);
  }
});
