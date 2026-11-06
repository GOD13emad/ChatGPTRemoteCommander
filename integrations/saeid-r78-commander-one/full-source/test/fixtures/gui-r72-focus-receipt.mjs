import readline from 'node:readline';
const mode=process.argv[2],variant=process.argv[3];
const valid={ok:false,error:'GUI_PHYSICAL_MOUSE_HELD',action:'focusWindow',phase:'PRE_DISPATCH_GUARD',effect:'NOT_APPLIED'};
const variants={valid,missing:{ok:false,error:valid.error},extra:{...valid,extra:true},
 wrongAction:{...valid,action:'click'},wrongPhase:{...valid,phase:'POST_DISPATCH'},
 wrongEffect:{...valid,effect:'UNKNOWN'},wrongError:{...valid,error:'GUI_MOVE_FAILED'}};
if(mode==='persistent')process.stdout.write('{"ok":true,"ready":true,"protocol":1}\n');
for await(const _ of readline.createInterface({input:process.stdin}))process.stdout.write(JSON.stringify(variants[variant])+'\n');
