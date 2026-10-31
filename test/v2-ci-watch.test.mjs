import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classify,changes,check} from '../tools/v2-ci-watch.mjs';
const sha='a'.repeat(40);
const run=(status,conclusion=null)=>({head_sha:sha,event:'pull_request',id:42,name:'CI',status,conclusion,run_attempt:1});
const reply=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}});
const fetcher=(runs,pr={number:426,state:'open',draft:true,head:{sha}})=>async (url,req)=>{
 assert.equal(req.redirect,'error');assert.equal(req.method,'GET');
 return reply(url.includes('/pulls/')?pr:{workflow_runs:runs});
};
test('exact SHA only, never claims IdP, fleet or release acceptance',()=>{
 const r=classify(sha,[run('completed','success'),{...run('completed','failure'),head_sha:'b'.repeat(40)}]);
 assert.equal(r.state,'CI_COMPLETE_CANDIDATE_ONLY');
 assert.equal(r.liveIdpAccepted,false);assert.equal(r.fleetAccepted,false);
 assert.equal(classify(sha,[run('completed','failure')]).state,'CI_FAILURE');
 assert.equal(classify(sha,[run('in_progress')]).state,'CI_PENDING');
});
test('deduplicates failures and only signals new material changes',()=>{
 const bad=classify(sha,[run('completed','failure')]);
 assert.equal(changes(null,bad).length,1);
 assert.equal(changes(bad,bad).length,0);
 assert.equal(changes(bad,classify(sha,[run('completed','success')]))[0].type,'CI_FINISHED_NOT_RELEASE_READY');
});
test('persist state and transitions, fail closed on invalid PR',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2-ci-'));
 try{
  assert.equal((await check({dir,fetcher:fetcher([run('completed','failure')])})).alerts.length,1);
  assert.equal((await check({dir,fetcher:fetcher([run('completed','failure')])})).alerts.length,0);
  assert.equal((await readFile(join(dir,'transitions.jsonl'),'utf8')).trim().split('\n').length,1);
  assert.equal(JSON.parse(await readFile(join(dir,'latest.json'),'utf8')).state,'CI_FAILURE');
  await assert.rejects(check({dir,fetcher:fetcher([],{number:426,state:'closed',head:{sha}})}),{code:'CI_WATCH_PR_UNAVAILABLE'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
