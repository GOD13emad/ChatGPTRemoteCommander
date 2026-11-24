import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLinuxGuiBackend} from '../src/gui-linux-session-route.mjs';

const base={Desktop:'KDE',Type:'x11',Active:'yes',Remote:'no',Class:'user',
  Seat:'seat0',Display:':0',LockedHint:'no'};
function route(env,rows=[{id:'4',uid:1000,props:base}]){
  return resolveLinuxGuiBackend({env,uid:1000,run:(_file,args)=>{
    if(args[0]==='list-sessions')return rows.map(x=>x.id+' '+x.uid+' owner').join('\n');
    return Object.entries(rows.find(x=>x.id===args[1]).props).map(([k,v])=>k+'='+v).join('\n');
  }});
}
test('legacy KDE force flag cannot override actual local X11 seat',()=>{
  assert.deepEqual(route({RC_FORCE_KDE_PORTAL:'1'}),{backend:'kde-x11-readonly',sessionId:'4',display:':0'});
});
test('verified Wayland still selects Portal',()=>{
  assert.equal(route({XDG_SESSION_TYPE:'wayland'},[{id:'4',uid:1000,props:{...base,Type:'wayland',Display:''}}]).backend,'kde-wayland');
});
test('wrong session type, private display, explicit other session and Wayland socket on X11 refuse KDE route',()=>{
  for(const env of [{XDG_SESSION_TYPE:'wayland'},{DISPLAY:':1970'},{XDG_SESSION_ID:'8'},{WAYLAND_DISPLAY:'wayland-0'}])
    assert.equal(route({...env,RC_FORCE_KDE_PORTAL:'1'}).backend,'blocked');
});
test('locked, remote, greeter, inactive and ambiguous seats do not select a KDE input route',()=>{
  for(const props of [{LockedHint:'yes'},{Remote:'yes'},{Class:'greeter'},{Active:'no'},{Seat:''}])
    assert.equal(route({RC_FORCE_KDE_PORTAL:'1'},[{id:'4',uid:1000,props:{...base,...props}}]).backend,'blocked');
  assert.equal(route({RC_FORCE_KDE_PORTAL:'1'},[{id:'4',uid:1000,props:base},{id:'5',uid:1000,props:base}]).backend,'blocked');
});
test('another UID and unavailable logind cannot prove KDE; ordinary GNOME route remains compatible',()=>{
  assert.equal(route({RC_FORCE_KDE_PORTAL:'1'},[{id:'4',uid:1001,props:base}]).backend,'blocked');
  assert.equal(resolveLinuxGuiBackend({env:{RC_FORCE_KDE_PORTAL:'1'},uid:1000,run:()=>{throw Error()}}).backend,'blocked');
  assert.equal(route({XDG_CURRENT_DESKTOP:'GNOME'},[{id:'4',uid:1000,props:{...base,Desktop:'GNOME',Type:'wayland'}}]).backend,'gnome');
});
