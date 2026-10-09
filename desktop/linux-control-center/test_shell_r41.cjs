'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'test_native_render_r35.sh'),'utf8');

test('bash -c single-quoted body has no nested single quotes and includes fail-closed probes',()=>{
  const marker="bash -euo pipefail -c '";
  const index=source.indexOf(marker);
  assert.ok(index>=0,'shell subcommand missing');
  const rest=source.slice(index+marker.length);
  const end=rest.indexOf("'\nconvert ");
  assert.ok(end>=0,'outer bash -c close not followed by image conversion');
  const quoted=rest.slice(0,end);
  assert.doesNotMatch(quoted,/'/,'a nested single quote would end the outer bash -c argument');
  for(const indicator of ['R39_WINDOW_TREE','R39_ALL_VISIBLE_WINDOW_NAMES','GTK_NATIVE_WINDOW_MISSING','SIDEBAR_FOUR_PAGES_NOT_ACCEPTED','R36_NATIVE_STACK_PAGES=4_VISIBLE=4']){
    assert.ok(quoted.includes(indicator),indicator);
  }
  assert.ok(quoted.includes('xdotool search --onlyvisible --name ".*"'));
  assert.match(source,/set -euo pipefail/);
});
