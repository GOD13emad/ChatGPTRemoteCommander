import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('conversation UIA helper is semantic, exact-targeted, hidden and credential-free',()=>{
  const text=fs.readFileSync(new URL('../tools/conversation-uia.ps1',import.meta.url),'utf8');
  assert.match(text,/SelectionItemPattern/);
  assert.match(text,/EnumWindows/);
  assert.match(text,/GetWindowThreadProcessId/);
  assert.match(text,/TopLevelWindowsForPids/);
  assert.doesNotMatch(text,/MainWindowHandle/);
  assert.doesNotMatch(text,/\\$pid\\s*=/i,'helper must not assign the read-only automatic PID variable');
  assert.match(text,/ValuePattern/);
  assert.match(text,/InvokePattern/);
  assert.match(text,/Normalize-TabTitle/);
  assert.match(text,/High memory usage/);
  assert.match(text,/CHAT_TAB_AMBIGUOUS/);
  assert.match(text,/WAITING_FOR_CHAT_TAB/);
  assert.match(text,/COMPOSER_NOT_EMPTY/);
  assert.match(text,/CHAT_BUSY/);
  assert.match(text,/GetForegroundWindow/);
  assert.match(text,/FOREGROUND_TAB_SWITCH_REQUIRED/);
  assert.match(text,/SEND_NOT_ACKNOWLEDGED/);
  assert.doesNotMatch(text,/https?:\/\//i);
  assert.doesNotMatch(text,/Get-Clipboard|Set-Clipboard|Clipboard\]::|clip\.exe/i);
  assert.doesNotMatch(text,/mouse_event|SendKeys|SetCursorPos/i);
  assert.doesNotMatch(text,/document\.cookie|sessionStorage|localStorage|Authorization\s*:/i);
});

test('controller launches pwsh in hidden MTA mode and never embeds a ChatGPT URL',()=>{
  const text=fs.readFileSync(new URL('../src/conversation-continuation.mjs',import.meta.url),'utf8');
  assert.match(text,/'-MTA'/);
  assert.match(text,/'-WindowStyle','Hidden'/);
  assert.match(text,/existing-chat-uia/);
  assert.doesNotMatch(text,/https?:\/\/chatgpt\.com/i);
  assert.doesNotMatch(text,/document\.cookie|sessionStorage|localStorage|Authorization\s*:/i);
});
