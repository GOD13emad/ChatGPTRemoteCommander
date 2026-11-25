'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluate,load}=require('../scripts/ui-release-gate-r40.cjs');
const manifest=load().manifest;
const clone=o=>JSON.parse(JSON.stringify(o));
test('release cannot be authorized from a green CI alone',()=>{
 const r=evaluate(manifest);assert.equal(r.status,'BLOCKED');assert.equal(r.promotionAuthorized,false);assert.ok(r.openChecks>20);
});
test('four hosts and exact source commits are mandatory',()=>{
 const p=clone(manifest);p.hosts.pop();assert.ok(evaluate(p).blockers.some(x=>x.gate==='FOUR_HOSTS'));
 const q=clone(manifest);q.components[0].sha='main';assert.ok(evaluate(q).blockers.some(x=>x.gate==='SOURCE_browser'));
});
test('browser owner session and GUI latch must be respected',()=>{
 const r=evaluate(manifest).blockers;assert.ok(r.some(x=>x.gate==='LEASE_emad-windows'));assert.ok(r.some(x=>x.gate==='GUI_emad-windows'));
});
test('offline MMZ root and local sudo cannot be bypassed',()=>{
 const r=evaluate(manifest).blockers;assert.ok(r.some(x=>x.gate==='CONNECT_mmz-linux'));assert.ok(r.some(x=>x.gate==='MMZ_LOCAL'));
});
test('signing, real installer receipts and rollback are separate gates',()=>{
 const r=evaluate(manifest).blockers;assert.ok(r.some(x=>x.gate==='GATE_trustedWindowsAuthenticode'));assert.ok(r.some(x=>x.gate==='ROLLBACK_HOST_saeid-windows'));assert.ok(r.some(x=>x.gate==='ARTIFACTS'));
});
test('false user authority and fake tag do not authorize release',()=>{
 const p=clone(manifest);p.automaticPromotionAuthorized=true;p.releaseTag='v0.8.2';assert.ok(evaluate(p).blockers.some(x=>x.gate==='NO_AUTOPROMOTION'));assert.equal(evaluate(p).promotionAuthorized,false);
});
test('read-only gate has no network shell registry or user profile operations',()=>{
 const s=fs.readFileSync(path.resolve(__dirname,'../scripts/ui-release-gate-r40.cjs'),'utf8');assert.doesNotMatch(s,/child_process|\.exec\(|\.spawn\(|https\.request|fetch\(|process\.kill|Registry\./);
});
