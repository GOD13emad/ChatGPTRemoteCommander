// Hosted source-only regression; no operational adapters, model, or installation.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const pins={'src/project-catalog.mjs':'df91ccf906f24ad63fd2a5e8b899cdb3179190d24d257ae90d3c9bee2096b7b4','src/durable-project-runner.mjs':'3ab5401fe886d86c39456bfa90f0c6ef3a3962ed0ecce2d655c4a31478ed4da9','test/generic-project-runner.test.mjs':'bf4628ec169dc7dad090a3e5f39ae645fe4126b1c8b7728ed49e3ed5b9e2fd37'};
const check=()=>{for(const [file,pin]of Object.entries(pins)){const actual=createHash('sha256').update(fs.readFileSync(file)).digest('hex');if(actual!==pin)throw new Error('CI_SOURCE_PIN_DRIFT');}};
check();const run=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1','test/generic-project-runner.test.mjs'],{shell:false,windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1048576});
process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
if(run.error||run.status!==0||run.signal!==null)throw new Error('CI_SOURCE_TEST_FAILED');
for(const [name,count]of Object.entries({tests:74,pass:74,fail:0,cancelled:0,skipped:0,todo:0}))if(!new RegExp('^# '+name+' '+count+'\\r?$','m').test(run.stdout))throw new Error('CI_EXACT_TEST_COUNT_'+name);
check();console.log(JSON.stringify({status:'PASS_74_SOURCE_TESTS_NOT_OPERATIONAL_ACCEPTANCE',platform:process.platform,tests:74,pass:74,fail:0,skipped:0,whole:'NOT_FINAL'}));
