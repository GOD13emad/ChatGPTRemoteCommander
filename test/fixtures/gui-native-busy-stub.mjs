import readline from 'node:readline';
const mode=process.argv[2] || 'oneshot';
const emit=()=>{
  const requestMode=process.argv[3] || 'valid';
  const value=requestMode==='linux-valid' ? {ok:false,error:'GUI_FOREGROUND_OR_GEOMETRY_CHANGED',submission:'NOT_SUBMITTED'} :
    requestMode==='linux-naked' ? {ok:false,error:'GUI_FOREGROUND_OR_GEOMETRY_CHANGED'} :
    requestMode==='linux-extra' ? {ok:false,error:'GUI_FOREGROUND_OR_GEOMETRY_CHANGED',submission:'NOT_SUBMITTED',other:true} :
    requestMode==='linux-forged' ? {ok:false,error:'GUI_FOCUS_FAILED',submission:'NOT_SUBMITTED'} :
    requestMode==='valid' ? {ok:false,error:'GUI_NATIVE_BUSY',submission:'NOT_SUBMITTED'} :
    requestMode==='extra' ? {ok:false,error:'GUI_NATIVE_BUSY',submission:'NOT_SUBMITTED',untrusted:true} :
    requestMode==='missing' ? {ok:false,error:'GUI_NATIVE_BUSY'} :
    requestMode==='other' ? {ok:false,error:'GUI_NATIVE_FAILED',submission:'NOT_SUBMITTED'} :
    {ok:true,available:true};
  process.stdout.write(JSON.stringify(value)+'\n');
};
if(mode==='persistent'){
  process.stdout.write('{"ok":true,"ready":true,"protocol":1}\n');
  const lines=readline.createInterface({input:process.stdin});
  for await (const _line of lines) emit();
}else{
  for await (const _line of readline.createInterface({input:process.stdin})) emit();
}
