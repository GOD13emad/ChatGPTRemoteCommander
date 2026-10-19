// Spawned ONLY by the private-Xvfb QA test; never exposed as Commander tool.
import {createNativeX11ApplicationLauncher} from '../src/native-private-x11-app-worker.mjs';
const [root,xvfbBin]=process.argv.slice(2);
if(!root||!xvfbBin)process.exit(65);
const launcher=createNativeX11ApplicationLauncher({
  root,xvfbBin,displayStart:1920,displayEnd:1940,
  catalog:{
    clock:{
      executable:'/usr/bin/xclock',
      args:['-digital','-title','RC_GENERIC_ABRUPT_EXIT_CLOCK','-update','1'],
      windowTitle:'RC_GENERIC_ABRUPT_EXIT_CLOCK'
    }
  }
});
const work=await launcher.forApplication('clock').launchWorkspace({
  workspaceRef:'c'.repeat(64)
});
process.stdout.write(JSON.stringify({
  display:work.displayId,
  serverPid:work.serverPid,
  appPid:work.applicationPid
})+'\n',()=>process.exit(79)); // Bypass finally; PR_SET_PDEATHSIG is tested.
