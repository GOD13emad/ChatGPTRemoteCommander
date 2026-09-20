import fs from 'node:fs';
import path from 'node:path';
import { writeRouterStateAtomic } from '../src/stable-router.mjs';
function parse(argv){const o={};for(let i=0;i<argv.length;i++){const a=argv[i],v=argv[++i];if(v===undefined)throw new Error('ROUTER_INIT_ARGUMENT');if(a==='--state')o.state=v;else if(a==='--profile')o.profile=v;else if(a==='--port')o.port=Number(v);else if(a==='--version')o.version=v;else if(a==='--commit')o.commit=v;else if(a==='--config-sha')o.configSha256=v;else if(a==='--config-path')o.configPath=path.resolve(v);else if(a==='--project-dir')o.projectDir=path.resolve(v);else throw new Error('ROUTER_INIT_ARGUMENT');}for(const k of ['state','profile','port','version','commit','configSha256','configPath','projectDir'])if(o[k]===undefined||o[k]===null||o[k]==='')throw new Error('ROUTER_INIT_REQUIRED_'+k);return o;}
const a=parse(process.argv.slice(2));
if(fs.existsSync(a.state))throw new Error('ROUTER_STATE_ALREADY_EXISTS');
if(!fs.existsSync(a.configPath)||!fs.existsSync(a.projectDir))throw new Error('ROUTER_INIT_PATH_MISSING');
const s={schema:1,profile:a.profile,generation:1,active:{port:a.port,version:a.version,commit:a.commit,configSha256:a.configSha256,configPath:a.configPath,projectDir:a.projectDir},previous:null,updatedAt:new Date().toISOString()};
writeRouterStateAtomic(a.state,s);console.log(JSON.stringify({ok:true,state:s}));
