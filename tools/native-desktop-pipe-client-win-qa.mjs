// PRIVATE QA client for SAME-Windows-user named pipe. Read-only commands
// status/observeA/observeB and bounded shutdown; no native input endpoint.
import net from 'node:net';
const pipeName=process.argv[2]||'';
const command=process.argv[3]||'';
if(!/^rc_qa_desk_[a-f0-9]{32}$/.test(pipeName)||
   !['status','observeA','observeB','shutdown'].includes(command)){
  process.stderr.write('QA_CLIENT_ARGUMENT_INVALID\n');process.exit(2);
}
const address='\\\\.\\pipe\\'+pipeName;
const socket=net.createConnection(address);
let content='',finished=false;
const stop=(code)=>{
  if(finished)return;
  finished=true;
  socket.destroy();
  process.exitCode=code;
};
socket.setTimeout(4000);
socket.on('connect',()=>socket.write(command+'\n'));
socket.on('data',data=>{
  content+=data.toString('utf8');
  if(content.length>8192){stop(3);return;}
  if(!content.includes('\n'))return;
  try{
    const parsed=JSON.parse(content.trim());
    if(typeof parsed!=='object'||parsed===null||typeof parsed.ok!=='boolean')
      throw Error('invalid');
    process.stdout.write(JSON.stringify({clientPid:process.pid,command,reply:parsed})+'\n');
    stop(parsed.ok?0:4);
  }catch{stop(3)}
});
socket.on('error',e=>{process.stderr.write('QA_CLIENT_CONNECTION_ERROR:'+e.code+'\n');stop(5)});
socket.on('timeout',()=>{process.stderr.write('QA_CLIENT_TIMEOUT\n');stop(6)});
socket.on('end',()=>{if(!finished)stop(7)});
