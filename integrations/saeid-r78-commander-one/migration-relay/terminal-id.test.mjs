import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTerminalNamespace,formatTerminalId,isTerminalId} from './terminal-id.mjs';
test('legacy undefined namespace retains exact legacy wire identity',()=>{
 assert.equal(validateTerminalNamespace(undefined),null);assert.equal(formatTerminalId(1),'term-1');
 assert.equal(formatTerminalId(9999999999999),'term-9999999999999');
});
test('new generation namespace does not overlap legacy IDs',()=>{
 const n=validateTerminalNamespace('one-gen48');assert.equal(formatTerminalId(1,n),'one-gen48-term-1');
 assert.notEqual(formatTerminalId(1,n),formatTerminalId(1));
});
test('untrusted namespace values are rejected rather than normalized',()=>{
 for(const v of [null,'','ONE',' term','a/../b','a\\b','a.term','-a','a--b','a-','a'.repeat(65),7,true,{},['one']])assert.throws(()=>validateTerminalNamespace(v),/TERMINAL_NAMESPACE_INVALID/);
});
test('bounded format exhaustion is pre-effect fail closed',()=>{
 for(const v of [0,-1,1.1,Number.MAX_SAFE_INTEGER,NaN,Infinity,'1'])assert.throws(()=>formatTerminalId(v),/TERMINAL_SEQUENCE_EXHAUSTED/);
});
test('relay labels allow both bounded forms without deriving authority',()=>{
 for(const v of ['term-1','term-9999999999999','one-gen48-term-1','one-a1-b2-term-3'])assert.equal(isTerminalId(v),true);
 for(const v of ['term-0','term-01','one-term-0','one-term-01','../term-1','one/term-1','term-10000000000000','a'.repeat(65)+'-term-1',{},null])assert.equal(isTerminalId(v),false);
});
