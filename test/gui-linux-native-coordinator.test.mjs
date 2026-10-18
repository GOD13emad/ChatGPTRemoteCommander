// Run cross-process Linux flock acceptance only on native Linux. The Python
// fixture uses unique disposable directories and never calls Mutter/GUI.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
test('Linux native GUI helpers share a fail-closed account lock across processes',{
 skip:process.platform!=='linux'
},()=>{
 const child=spawnSync('python3',[path.join(dir,'gui-linux-native-coordinator-qa.py')],{
  encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:65536
 });
 assert.equal(child.status,0,'Native test failed: '+child.stdout.slice(-3000)+' '+child.stderr.slice(-3000));
 assert.match(child.stderr,/Ran 5 tests/);
 assert.match(child.stderr,/OK/);
});
test('GNOME native helper advertises coordinator handshake when GI is installed',{
 skip:process.platform!=='linux'
},t=>{
 const probe=spawnSync('python3',['-c',[
   'import gi',
   "gi.require_version('Gio','2.0')",
   "gi.require_version('GLib','2.0')",
   "gi.require_version('GdkPixbuf','2.0')",
   'from gi.repository import Gio, GLib, GdkPixbuf'
 ].join(';')],{encoding:'utf8',timeout:5000,windowsHide:true});
 if(probe.error)throw probe.error;
 if(probe.status!==0){
  // Absence of GNOME dependencies only skips the desktop startup check:
  // the real cross-process flock test above MUST still pass.
  if(!/ModuleNotFoundError|ImportError|Namespace .* not available/.test(probe.stderr))
    assert.fail('Unexpected GNOME import failure: '+probe.stderr.slice(0,700));
  t.skip('Clean/headless Linux runner has no GNOME GI runtime');
  return;
 }
 const native=spawnSync('python3',[path.join(dir,'../tools/gui-control-linux.py'),'--server'],{
  encoding:'utf8',input:'',timeout:12000,maxBuffer:32768
 });
 assert.equal(native.status,0,native.stderr);
 const ready=JSON.parse(native.stdout.trim().split(/\r?\n/)[0]);
 assert.equal(ready.ok,true);
 assert.equal(ready.protocol,1);
 assert.equal(ready.nativeInputCoordinator,1);
});
