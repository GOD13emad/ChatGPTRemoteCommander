import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isWorkspaceControllerToolName} from '../src/workspace-routing.mjs';
import {workspaceToolDefinitions} from '../src/workspace-tools.mjs';
import {workspaceTargetDefinitions} from '../src/workspace-target-tools.mjs';

test('reconciliation belongs to the scoped CUA workspace controller, not legacy target adapter', () => {
  assert.equal(isWorkspaceControllerToolName('workspace_target_reconcile'), true);
  assert.equal(isWorkspaceControllerToolName('workspace_window_observe'), true);
  assert.equal(isWorkspaceControllerToolName('workspace_browser_click'), true);
  for (const name of ['workspace_target_list','workspace_target_open','workspace_target_end'])
    assert.equal(isWorkspaceControllerToolName(name), false);
  assert.equal(workspaceToolDefinitions.some(t => t.name === 'workspace_target_reconcile'), true);
  assert.equal(workspaceTargetDefinitions.some(t => t.name === 'workspace_target_reconcile'), false);
});

test('server dispatch uses controller classifier before legacy workspace_target prefix branch', () => {
  const source = readFileSync(new URL('../src/server-v0.3.mjs', import.meta.url), 'utf8');
  const controller = source.indexOf('if (isWorkspaceControllerToolName(name))');
  const legacy = source.indexOf("if (name.startsWith('workspace_target_'))");
  assert.ok(controller > 0 && legacy > controller, 'reconciliation must be routed before the legacy target branch');
});
