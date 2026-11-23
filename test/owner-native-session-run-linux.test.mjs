import test from 'node:test';
import assert from 'node:assert/strict';
import {planNativeOwnerSession} from '../tools/owner-native-session-run-linux.mjs';

const manager=[
 'XDG_RUNTIME_DIR=/run/user/1000',
 'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus',
 'XDG_SESSION_TYPE=wayland','WAYLAND_DISPLAY=wayland-0','DISPLAY=:0'
].join('\n')+'\n';
const logind=[
 'Id=3','User=1000','Seat=seat0','Active=yes','Remote=no',
 'Type=wayland','Class=user','State=active','Display='
].join('\n')+'\n';
const base={
 uid:1000,profile:'Emad',task:'worker-preflight',managerText:manager,
 logindText:logind,verifySocket:(file,uid)=>
  file==='/run/user/1000/wayland-0'&&uid===1000,
 unit:'rc012-native-test-0001',
 nodeExecutable:'/usr/lib/chatgpt-remote-commander/runtime/node',
 toolPath:'/usr/lib/chatgpt-remote-commander/app/tools/provision-owner-worker-key-linux.mjs'
};
function fails(name,changes,code){
 test(name,()=>{
   assert.throws(()=>planNativeOwnerSession({...base,...changes}),{code});
 });
}
test('Wayland active owner launches existing native preflight in one systemd user unit',()=>{
 const p=planNativeOwnerSession(base);
 assert.equal(p.executable,'/usr/bin/systemd-run');
 assert.equal(p.sessionId,'3');
 assert.equal(p.sessionType,'wayland');
 assert.equal(p.grantIssued,false);
 assert.equal(p.noPrivilegeElevation,true);
 assert.ok(p.args.includes('NoNewPrivileges=yes'));
 assert.ok(p.args.includes('XDG_SESSION_TYPE=wayland'));
 assert.ok(p.args.includes('WAYLAND_DISPLAY=wayland-0'));
 assert.ok(p.args.includes('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus'));
 assert.deepEqual(p.args.slice(-3),[base.toolPath,'--preflight','Emad']);
 assert.equal(p.args.includes('sudo'),false);
 assert.equal(p.args.includes('sh'),false);
});
test('X11 owner uses exact logind display without requiring manager XDG_SESSION_TYPE',()=>{
 const p=planNativeOwnerSession({...base,
   logindText:logind.replace('Type=wayland','Type=x11').replace('Display=','Display=:0'),
   managerText:manager.replace('XDG_SESSION_TYPE=wayland\n','')
      .replace('WAYLAND_DISPLAY=wayland-0\n','')});
 assert.equal(p.sessionType,'x11');
 assert.ok(p.args.includes('DISPLAY=:0'));
 assert.equal(p.args.some(v=>v.startsWith('WAYLAND_DISPLAY=')),false);
});
test('Enrollment and rebind remain explicit native approval operations',()=>{
 for(const [task,flag] of [
   ['worker-enroll','--enroll'],['worker-rebind','--rebind']]){
   const p=planNativeOwnerSession({...base,task});
   assert.deepEqual(p.args.slice(-2),[flag,'Emad']);
   assert.ok(p.args.includes('RuntimeMaxSec=150s'));
 }
});
fails('foreign owner rejected',{uid:1001},'RC012_NATIVE_SEAT_NOT_ACTIVE');
fails('remote session rejected',{logindText:logind.replace('Remote=no','Remote=yes')},'RC012_NATIVE_SEAT_NOT_ACTIVE');
fails('inactive session rejected',{logindText:logind.replace('Active=yes','Active=no')},'RC012_NATIVE_SEAT_NOT_ACTIVE');
fails('greeter session rejected',{logindText:logind.replace('Class=user','Class=greeter')},'RC012_NATIVE_SEAT_NOT_ACTIVE');
fails('untyped manager rejected',{managerText:manager.replace('XDG_SESSION_TYPE=wayland\n','')},'RC012_NATIVE_SEAT_WAYLAND_SOCKET_UNVERIFIED');
fails('foreign manager runtime rejected',{managerText:manager.replace('/run/user/1000','/run/user/1001')},'RC012_NATIVE_SEAT_MANAGER_SCOPE_MISMATCH');
fails('display traversal rejected',{managerText:manager.replace('WAYLAND_DISPLAY=wayland-0','WAYLAND_DISPLAY=../wayland-0')},'RC012_NATIVE_SEAT_WAYLAND_SOCKET_UNVERIFIED');
fails('unknown owner socket rejected',{verifySocket:()=>false},'RC012_NATIVE_SEAT_WAYLAND_SOCKET_UNVERIFIED');
fails('duplicate session type rejected',{managerText:manager+'XDG_SESSION_TYPE=wayland\n'},'RC012_NATIVE_SEAT_ENV_DUPLICATE');
fails('foreign X11 display rejected',{logindText:logind.replace('Type=wayland','Type=x11').replace('Display=','Display=:3')},'RC012_NATIVE_SEAT_X11_DISPLAY_MISMATCH');
fails('unsafe profile rejected',{profile:'../Emad'},'RC012_NATIVE_SEAT_LAUNCH_INVALID');
fails('unknown task rejected',{task:'execute-root'},'RC012_NATIVE_SEAT_LAUNCH_INVALID');
fails('relative native tool rejected',{toolPath:'./tools/provision-owner-worker-key-linux.mjs'},'RC012_NATIVE_SEAT_LAUNCH_INVALID');
fails('unit injection rejected',{unit:'rc012;touch /tmp/owned'},'RC012_NATIVE_SEAT_LAUNCH_INVALID');
