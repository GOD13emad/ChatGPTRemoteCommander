import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {isPrivateQaSymlinkTarget,smoke} from '../tools/v2-public-appimage-core-smoke.mjs';

const root=path.join(os.tmpdir(),'commander-v2-unique-private-qa-root');
const parent=path.join(root,'config','Commander V2');

test('internal absolute Electron SingletonSocket is safe within isolated QA root',()=>{
 const socket=path.join(root,'tmp','scoped_dir01','SingletonSocket');
 assert.equal(isPrivateQaSymlinkTarget(root,parent,socket),true);
});

test('internal relative AppImage library and icon links remain allowed',()=>{
 assert.equal(isPrivateQaSymlinkTarget(root,path.join(root,'tmp','app','usr','lib'),
  'libnotify.so.4.0.0'),true);
 assert.equal(isPrivateQaSymlinkTarget(root,path.join(root,'tmp','app'),
  'usr/share/icons/commander-v2.png'),true);
});

test('absolute link to a host path outside the QA scratch is refused',()=>{
 const outside=path.join(os.tmpdir(),'commander-v2-external-user-profile');
 assert.equal(isPrivateQaSymlinkTarget(root,parent,outside),false);
});

test('relative traversal outside QA root is refused',()=>{
 const outside=path.join(os.tmpdir(),'commander-v2-other-user');
 const escape=path.relative(parent,outside);
 assert.equal(isPrivateQaSymlinkTarget(root,parent,escape),false);
});

test('sibling with matching path prefix is not inside the QA scratch',()=>{
 const sibling=root+'-different';
 assert.equal(isPrivateQaSymlinkTarget(root,parent,
  path.join(sibling,'SingletonSocket')),false);
});

test('exact private root remains inside the deletion scope',()=>{
 assert.equal(isPrivateQaSymlinkTarget(root,parent,root),true);
});
test('rejects arbitrary candidate-mode injection before any native launch',async()=>{
 await assert.rejects(smoke({candidate:'../../other'}),{code:'INVALID_MODE'});
});
