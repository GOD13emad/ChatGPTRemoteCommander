import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';

test('private Browser GUI_STOP blocks actual Core GUI admission before invoking native helper', { skip: !['linux','win32'].includes(process.platform) }, async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'rc-private-browser-stop-'));
  const envKey = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_STATE_HOME';
  const previous = process.env[envKey];
  process.env[envKey] = fixture;
  try {
    // Fresh import to bind the fixture-only state root, not the user's real state.
    const { createGuiController } = await import('../src/gui-tools-windows.mjs?native_stop_fixture=1');
    let invocations = 0;
    const controller = createGuiController({
      platform: process.platform,
      invoke: async () => {
        invocations += 1;
        return { ok: true, available: true, backend: 'fixture' };
      }
    });
    const ctx = {
      config: {
        powerMode: {
          enabled: true,
          guiControl: {
            enabled: true,
            allowScreenshot: true,
            allowMouse: true,
            allowKeyboard: true,
            allowWindowFocus: true
          }
        }
      }
    };
    const privateRoot = process.platform === 'win32'
      ? path.win32.join(fixture, 'ChatGPTRemoteCommander', 'browser-companion')
      : path.posix.join(fixture, 'chatgpt-remote-commander', 'browser-companion');
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    await writeFile(path.join(privateRoot, 'GUI_STOP'), 'COMMANDER_NATIVE_GUI_EMERGENCY_STOP\n', { mode: 0o600 });
    const status = await controller.execute(ctx, 'gui_status', {});
    assert.equal(status.available, false);
    assert.equal(status.blocked, true);
    assert.equal(status.reason, 'LOCAL_GUI_STOP');
    await assert.rejects(
      () => controller.execute(ctx, 'gui_session_begin', {}),
      { message: 'GUI_LOCAL_STOP' }
    );
    assert.equal(invocations, 0, 'no GUI native process may be called while private STOP exists');
  } finally {
    if (previous === undefined) delete process.env[envKey];
    else process.env[envKey] = previous;
    await rm(fixture, { recursive: true, force: true });
  }
});
