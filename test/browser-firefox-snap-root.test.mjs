import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {defaultBrowserProfileRoot} from '../src/browser-tools.mjs';

const home=path.join(path.sep,'home','isolated-owner');
const snapCommon=path.join(home,'snap','firefox','common');
const snapExists=name=>name==='/snap/bin/firefox'||name===snapCommon;
const noSnap=()=>false;
const standard=path.join(home,'.local','state','chatgpt-remote-commander','browser-profiles');
const confined=path.join(snapCommon,'chatgpt-remote-commander','browser-profiles');

test('Snap Firefox defaults to its own common writable profile subtree',()=>{
 const actual=defaultBrowserProfileRoot({
  platform:'linux',home,executable:'/usr/bin/firefox',pathExists:snapExists
 });
 assert.equal(actual,confined);
 assert.ok(actual.startsWith(snapCommon+path.sep));
});

test('non-Snap Firefox retains the existing Linux default path',()=>{
 assert.equal(defaultBrowserProfileRoot({
  platform:'linux',home,executable:'/usr/bin/firefox',pathExists:noSnap
 }),standard);
});

test('Chromium retains Linux default even if Firefox Snap is installed',()=>{
 assert.equal(defaultBrowserProfileRoot({
  platform:'linux',home,executable:'/usr/bin/chromium',pathExists:snapExists
 }),standard);
});

test('unknown executable and uninstalled Snap do not select a confined root',()=>{
 assert.equal(defaultBrowserProfileRoot({
  platform:'linux',home,executable:null,pathExists:snapExists
 }),standard);
 assert.equal(defaultBrowserProfileRoot({
  platform:'linux',home,executable:'/usr/bin/firefox',pathExists:name=>name===snapCommon
 }),standard);
});

test('Windows profile-root default is unchanged, independent of Snap paths',()=>{
 const winHome='C:\\Users\\Owner';
 const appData='C:\\Users\\Owner\\AppData\\Local';
 assert.equal(defaultBrowserProfileRoot({
  platform:'win32',home:winHome,localAppData:appData,
  executable:'C:\\Program Files\\Firefox\\firefox.exe',pathExists:snapExists
 }),path.join(appData,'ChatGPTRemoteCommander','browser-profiles'));
});
