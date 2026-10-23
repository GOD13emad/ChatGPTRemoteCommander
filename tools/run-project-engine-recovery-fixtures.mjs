import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const file='test/project-engine-integration.test.mjs';

/**
 * Exact existing acceptance tests, same per-test timeouts. Each test runs
 * once: two cross-run cancelled fixtures isolated; remaining suite excludes
 * only those two cases which have already executed.
 */
export function planProjectEngineRecoveryFixtures(){
  const names=[
    'automatic scheduler never plans an unenrolled workflow and completes only after explicit enrollment',
    'tampered project import after crash blocks recovery without replay'
  ];
  return [
    ...names.map(name=>['--test','--test-concurrency=1','--test-name-pattern='+name,file]),
    ['--test','--test-concurrency=1','--test-skip-pattern=^(automatic scheduler never plans|tampered project import)',file]
  ];
}

function main(){
  for(const args of planProjectEngineRecoveryFixtures()){
    const child=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true,env:process.env});
    if(child.error)throw child.error;
    if(child.signal)throw Error('CI_ENGINE_RECOVERY_CHILD_SIGNAL_'+child.signal);
    if(child.status!==0){process.exitCode=Number.isInteger(child.status)?child.status:1;return;}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}