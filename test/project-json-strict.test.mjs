import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectJsonStrict as parse} from '../src/project-json-strict.mjs';

test('strict proposal JSON preserves nested arrays, Unicode and escaped value text',()=>{
 const input=JSON.stringify({path:'سلام',items:[{value:'a"b'},false,null,12]});
 assert.deepEqual(parse(input),JSON.parse(input));
});
test('duplicate keys and escaped-name aliases fail at every nested depth',()=>{
 for(const input of [
  '{"a":1,"a":2}',
  String.raw`{"a":1,"\u0061":2}`,
  '{"outer":{"a":1,"a":2}}',
  '{"array":[{"x":1,"x":2}]}',
  '{"__proto__":1,"__proto__":2}'
 ])assert.throws(()=>parse(input),{code:'PROJECT_JSON_INVALID'});
});
test('independent same names in different objects remain valid',()=>{
 assert.deepEqual(parse('{"a":{"x":1},"b":{"x":2}}'),{a:{x:1},b:{x:2}});
});
test('invalid syntax, unmatched brackets and lexical corruption fail closed',()=>{
 for(const input of ['','{','{"a":1]', '{"a":}',String.fromCharCode(0xfeff)+'{}',
  '{"x":"unterminated}', '{"x":1} trailing'])
  assert.throws(()=>parse(input),{code:'PROJECT_JSON_INVALID'});
});
test('depth and size bounds reject unusual provider payloads',()=>{
 assert.throws(()=>parse('['.repeat(65)+'0'+']'.repeat(65)),{code:'PROJECT_JSON_INVALID'});
 assert.throws(()=>parse('{"text":"12345"}',8),{code:'PROJECT_JSON_INVALID'});
 assert.throws(()=>parse('{"x":1}',0),{code:'PROJECT_JSON_INVALID'});
});
