import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { browserNativeGuiStopPath } from '../src/gui-tools-windows.mjs';

test('Windows Browser native GUI_STOP path is fixed in the owner-private companion directory', () => {
  const local = 'C:\\Users\\owner\\AppData\\Local';
  assert.equal(
    browserNativeGuiStopPath({ platform:'win32', env:{LOCALAPPDATA:local}, home:'C:\\Users\\owner' }),
    path.win32.join(local,'ChatGPTRemoteCommander','browser-companion','GUI_STOP')
  );
  assert.equal(browserNativeGuiStopPath({platform:'win32',env:{},home:'C:\\Users\\owner'}),null);
});

test('Linux Browser GUI_STOP path follows the exact state-directory convention', () => {
  assert.equal(
    browserNativeGuiStopPath({ platform:'linux', env:{XDG_STATE_HOME:'/tmp/owner-state'}, home:'/home/owner' }),
    '/tmp/owner-state/chatgpt-remote-commander/browser-companion/GUI_STOP'
  );
  assert.equal(
    browserNativeGuiStopPath({ platform:'linux', env:{}, home:'/home/owner' }),
    '/home/owner/.local/state/chatgpt-remote-commander/browser-companion/GUI_STOP'
  );
});

test('Unsupported systems do not get a stop path or new command authority', () => {
  assert.equal(browserNativeGuiStopPath({ platform:'darwin',env:{},home:'/home/u' }),null);
});
