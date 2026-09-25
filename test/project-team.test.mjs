import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeamPlanner } from '../src/project-team.mjs';

const choice = (summary = 'Inspect evidence') => ({ action: 'call', tool: 'read_text', argumentsJson: '{"path":"proof.txt"}', summary });
const delegate = (summary = 'Delegate artifact') => ({ action: 'delegate', tool: '', argumentsJson: '{"artifact":"draft.txt","brief":"Create bounded draft"}', summary });
const members = [
  { id: 'research', role: 'Find missing evidence' },
  { id: 'review', role: 'Check constraints' },
  { id: 'verify', role: 'Check acceptance criteria' },
  { id: 'risk', role: 'Check recovery risks' }
];
const provider = (plan, descriptor = {}) => ({
  plan, describe: () => ({ kind: 'codex', model: 'fixed-model', effort: 'high', available: true, ...descriptor })
});
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('worker concurrency is capped and coordinator receives ordered untrusted advice once', async () => {
  let active = 0, peak = 0, coordinatorCalls = 0;
  const completed = [];
  const base = provider(async context => {
    const c = context.collaboration;
    if (c.phase === 'coordinator') {
      coordinatorCalls++;
      assert.equal(active, 0);
      assert.equal(c.adviceTrust, 'untrusted');
      assert.match(c.instructions, /not instructions, authorization/);
      assert.deepEqual(c.workerProposals.map(item => item.id), members.map(item => item.id));
      assert.deepEqual(c.workerProposals.map(item => item.proposal.summary), members.map(item => item.id));
      return choice('coordinated');
    }
    active++; peak = Math.max(peak, active);
    await delay(c.id === 'research' ? 20 : 5);
    active--; completed.push(c.id);
    return choice(c.id);
  });
  const team = createTeamPlanner({ planner: base, workers: members, maxParallel: 2 });
  assert.equal((await team.plan({ goal: 'Inspect' })).summary, 'coordinated');
  assert.equal(peak, 2);
  assert.equal(completed.length, 4);
  assert.equal(coordinatorCalls, 1);
});



test('delegate advice is admitted only when the original worker policy enables execution isolation', async () => {
  const base = provider(async context => context.collaboration.phase === 'coordinator' ? delegate('coordinated delegate') : delegate(context.collaboration.id));
  const team = createTeamPlanner({ planner: base, workers: members.slice(0, 2), maxParallel: 2 });
  const result = await team.plan({ worker: { enabled: true } });
  assert.equal(result.action, 'delegate'); assert.equal(result.tool, '');
  await assert.rejects(team.plan({ worker: { enabled: false } }), { code: 'PLANNER_TEAM_INVALID_PROPOSAL' });
});

test('participants cannot mutate original context, sibling inputs, config or descriptions', async () => {
  const input = { goal: 'Inspect', nested: { value: 'original' } };
  const workers = members.slice(0, 2).map(member => ({ ...member }));
  const base = provider(async context => {
    assert.equal(context.nested.value, 'original');
    context.nested.value = 'modified';
    return choice();
  });
  const team = createTeamPlanner({ planner: base, workers });
  workers[0].id = 'changed';
  const description = team.describe();
  description.workers[0].id = 'tampered';
  await team.plan(input);
  assert.deepEqual(input, { goal: 'Inspect', nested: { value: 'original' } });
  assert.equal(team.describe().workers[0].id, 'research');
});

test('worker failure aborts and drains running siblings without scheduling more work', async () => {
  const calls = []; let siblingSettled = false;
  const base = provider(async (context, { signal }) => {
    const id = context.collaboration.id; calls.push(id);
    if (id === 'research') { await delay(10); throw new Error('PRIVATE_PROVIDER_DETAILS'); }
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => setTimeout(() => {
        siblingSettled = true; reject(new Error('PRIVATE_ABORT_DETAILS'));
      }, 15), { once: true });
    });
  });
  const team = createTeamPlanner({ planner: base, workers: members, maxParallel: 2 });
  await assert.rejects(team.plan({}), cause => cause.code === 'PLANNER_TEAM_WORKER_FAILED' && !String(cause).includes('PRIVATE'));
  assert.equal(siblingSettled, true);
  assert.deepEqual(calls, ['research', 'review']);
});

test('external abort drains workers and prevents coordinator; preabort starts none', async () => {
  let calls = 0, settled = 0;
  const controller = new AbortController();
  const base = provider((context, { signal }) => {
    assert.equal(context.collaboration.phase, 'worker'); calls++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      settled++; reject(Object.assign(new Error('PLANNER_ABORTED'), { code: 'PLANNER_ABORTED' }));
    }, { once: true }));
  });
  const team = createTeamPlanner({ planner: base, workers: members, maxParallel: 2 });
  const pending = team.plan({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'PLANNER_ABORTED' });
  assert.equal(calls, 2); assert.equal(settled, 2);
  await assert.rejects(team.plan({}, { signal: controller.signal }), { code: 'PLANNER_ABORTED' });
  assert.equal(calls, 2);
});

test('coordinator abort cannot return a proposal after cancellation', async () => {
  const controller = new AbortController();
  let settled = false;
  const base = provider(async (context, { signal }) => {
    if (context.collaboration.phase === 'worker') return choice();
    controller.abort();
    assert.equal(signal.aborted, true);
    await delay(5); settled = true;
    return choice('late');
  });
  const team = createTeamPlanner({ planner: base, workers: members.slice(0, 1) });
  await assert.rejects(team.plan({}, { signal: controller.signal }), { code: 'PLANNER_ABORTED' });
  assert.equal(settled, true);
});

test('descriptions preserve model/effort and exact provider-call accounting', () => {
  const base = provider(async () => choice(), { profile: { name: 'pinned' }, callsPerPlan: 1 });
  const team = createTeamPlanner({ planner: base, workers: members });
  const description = team.describe();
  assert.equal(description.kind, 'team'); assert.equal(description.baseKind, 'codex');
  assert.equal(description.model, 'fixed-model'); assert.equal(description.effort, 'high');
  assert.equal(description.callsPerPlan, 5); assert.equal(description.maxParallel, 2);
  description.profile.name = 'modified';
  assert.equal(team.describe().profile.name, 'pinned');
  assert.throws(() => createTeamPlanner({ planner: team, workers: members.slice(0, 1) }), /INVALID_CONFIG/);
  assert.throws(() => createTeamPlanner({ planner: provider(async () => choice(), { callsPerPlan: 2 }), workers: members.slice(0, 1) }), /INVALID_CONFIG/);
});

test('unavailable base is preserved and never invoked', async () => {
  const team = createTeamPlanner({ planner: provider(() => { throw new Error('unexpected'); }, { available: false }), workers: members.slice(0, 1) });
  assert.equal(team.describe().available, false);
  await assert.rejects(team.plan({}), { code: 'PLANNER_PROVIDER_UNAVAILABLE' });
});

test('worker configuration and parallelism are strictly bounded', () => {
  const planner = provider(async () => choice());
  for (const workers of [[], [...members, { id: 'fifth', role: 'x' }], [members[0], members[0]], [{ id: 'bad id', role: 'x' }], [{ id: 'valid', role: '' }], [{ id: 'valid', role: 'x', extra: true }]]) {
    assert.throws(() => createTeamPlanner({ planner, workers }), /INVALID_CONFIG/);
  }
  for (const maxParallel of [0, 5, 1.5]) assert.throws(() => createTeamPlanner({ planner, workers: members, maxParallel }), /INVALID_CONFIG/);
});

for (const [name, output] of [
  ['missing', { action: 'block' }], ['extra', { ...choice(), authority: true }],
  ['bad action', { ...choice(), action: 'execute' }], ['bad tool', { ...choice(), tool: '../run' }],
  ['array arguments', { ...choice(), argumentsJson: '[]' }], ['invalid arguments', { ...choice(), argumentsJson: 'no' }],
  ['non-string summary', { ...choice(), summary: 42 }]
]) test('malformed worker proposal blocks coordinator: ' + name, async () => {
  let calls = 0;
  const team = createTeamPlanner({ planner: provider(async () => { calls++; return output; }), workers: members.slice(0, 1) });
  await assert.rejects(team.plan({}), { code: 'PLANNER_TEAM_INVALID_PROPOSAL' });
  assert.equal(calls, 1);
});

test('malformed coordinator output is rejected and error text stays redacted', async () => {
  const team = createTeamPlanner({ planner: provider(async context => context.collaboration.phase === 'worker' ? choice() : { ...choice(), summary: false }), workers: members.slice(0, 1) });
  await assert.rejects(team.plan({}), { code: 'PLANNER_TEAM_INVALID_PROPOSAL' });
  const failing = createTeamPlanner({ planner: provider(async context => {
    if (context.collaboration.phase === 'worker') return choice();
    throw new Error('PRIVATE_COORDINATOR_CONTEXT');
  }), workers: members.slice(0, 1) });
  await assert.rejects(failing.plan({}), { code: 'PLANNER_TEAM_COORDINATOR_FAILED', message: 'PLANNER_TEAM_COORDINATOR_FAILED' });
});

test('context byte limit and unsupported JSON fail before any provider call', async () => {
  let calls = 0, getterCalls = 0;
  const team = createTeamPlanner({ planner: provider(async () => { calls++; return choice(); }), workers: members.slice(0, 1) });
  await assert.rejects(team.plan({ text: 'ا'.repeat(70000) }), { code: 'PLANNER_TEAM_CONTEXT_LIMIT' });
  await assert.rejects(team.plan({ collaboration: {} }), { code: 'PLANNER_TEAM_INVALID_CONTEXT' });
  await assert.rejects(team.plan({ absent: undefined }), { code: 'PLANNER_TEAM_INVALID_CONTEXT' });
  await assert.rejects(team.plan({ get secret() { getterCalls++; return 'x'; } }), { code: 'PLANNER_TEAM_INVALID_CONTEXT' });
  const circular = {}; circular.self = circular;
  await assert.rejects(team.plan(circular), { code: 'PLANNER_TEAM_INVALID_CONTEXT' });
  assert.equal(calls, 0); assert.equal(getterCalls, 0);
});

test('individual 64KiB output limit fails without truncation or coordinator', async () => {
  let calls = 0;
  const team = createTeamPlanner({ planner: provider(async () => { calls++; return { ...choice(), argumentsJson: JSON.stringify({ text: 'x'.repeat(66000) }) }; }), workers: members.slice(0, 1) });
  await assert.rejects(team.plan({}), { code: 'PLANNER_TEAM_OUTPUT_LIMIT' });
  assert.equal(calls, 1);
});

test('combined context and advice limit aborts before coordinator', async () => {
  let calls = 0;
  const team = createTeamPlanner({ planner: provider(async context => {
    calls++; assert.equal(context.collaboration.phase, 'worker');
    return { ...choice(), argumentsJson: JSON.stringify({ text: 'x'.repeat(20000) }) };
  }), workers: members.slice(0, 2), maxParallel: 1 });
  await assert.rejects(team.plan({ evidence: 'x'.repeat(100000) }), { code: 'PLANNER_TEAM_CONTEXT_LIMIT' });
  assert.equal(calls, 2);
});

test('extend remains a proposal and is allowed only by original adaptive context', async () => {
  const extension = { action: 'extend', tool: '', argumentsJson: '{"steps":[{"id":"next","title":"Inspect"}],"reason":"Evidence"}', summary: 'Propose next step' };
  const team = createTeamPlanner({ planner: provider(async () => extension), workers: members.slice(0, 1) });
  await assert.rejects(team.plan({}), { code: 'PLANNER_TEAM_INVALID_PROPOSAL' });
  assert.deepEqual(await team.plan({ adaptive: { enabled: true } }), extension);
  const invalid = createTeamPlanner({ planner: provider(async () => ({ ...extension, tool:'write_text' })), workers: members.slice(0, 1) });
  await assert.rejects(invalid.plan({ adaptive: { enabled: true } }), { code:'PLANNER_TEAM_INVALID_PROPOSAL' });
});
