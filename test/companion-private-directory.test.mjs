import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompanionAcl, companionSafePosixAncestor } from '../src/companion-private-directory.mjs';

const currentSid = 'S-1-5-21-1-2-3-1001';
const base = () => ({ path: 'C:\\example\\private', currentSid, ownerSid: currentSid, sddl: 'D:(A;OICI;FA;;;OW)',
  rules: [{ sid: currentSid, access: 'Allow', rights: 2032127 }, { sid: 'S-1-5-18', access: 'Allow', rights: 2032127 }] });
test('owner and SYSTEM-only ACL yields bounded proof', () => { assert.equal(evaluateCompanionAcl(base(), 'C:\\example\\private').private, true); });
test('broad inherited read or write access is never private', () => {
  const acl = base(); acl.rules.push({ sid: 'S-1-1-0', access: 'Allow', rights: 1 });
  assert.throws(() => evaluateCompanionAcl(acl, acl.path), /DIRECTORY_NOT_PRIVATE/);
});
test('denying broad access cannot disguise a broad allow', () => {
  const acl = base(); acl.rules.push({ sid: 'S-1-1-0', access: 'Deny', rights: 1 }, { sid: 'S-1-1-0', access: 'Allow', rights: 1 });
  assert.throws(() => evaluateCompanionAcl(acl, acl.path), /DIRECTORY_NOT_PRIVATE/);
});
test('wrong owner or path and unknown proof fields fail closed', () => {
  const acl = base(); acl.ownerSid = 'S-1-5-18'; assert.throws(() => evaluateCompanionAcl(acl, acl.path), /ACL_INVALID/);
  assert.throws(() => evaluateCompanionAcl(base(), 'C:\\example\\other'), /ACL_INVALID/);
  assert.throws(() => evaluateCompanionAcl({ ...base(), private: true }, base().path), /ACL_INVALID/);
});
test('owner requires observed read and write rights', () => {
  const acl = base(); acl.rules[0].rights = 1; assert.throws(() => evaluateCompanionAcl(acl, acl.path), /OWNER_ACCESS_UNPROVEN/);
});

test('POSIX ancestor policy matches native root-owned sticky exception only', () => {
  assert.equal(companionSafePosixAncestor({ mode: 0o755, uid: 1001 }), true);
  assert.equal(companionSafePosixAncestor({ mode: 0o700, uid: 1001 }), true);
  assert.equal(companionSafePosixAncestor({ mode: 0o1777, uid: 0 }), true);
  for (const node of [{ mode: 0o777, uid: 0 }, { mode: 0o775, uid: 1001 },
    { mode: 0o1777, uid: 1001 }, { mode: NaN, uid: 0 }, { mode: 0o755, uid: -1 }]) {
    assert.equal(companionSafePosixAncestor(node), false);
  }
});
