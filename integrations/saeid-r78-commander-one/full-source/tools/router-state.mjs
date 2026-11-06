import { readRouterState } from '../src/stable-router.mjs';
function parse(argv){const o={format:'json'};for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--tsv'){o.format='tsv';continue;}const v=argv[++i];if(v===undefined)throw new Error('ROUTER_STATE_ARGUMENT');if(a==='--state')o.state=v;else throw new Error('ROUTER_STATE_ARGUMENT');}if(!o.state)throw new Error('ROUTER_STATE_REQUIRED');return o;}
const o=parse(process.argv.slice(2)),s=readRouterState(o.state),a=s.active;
if(o.format==='tsv'){
  for(const v of [s.profile,s.generation,a.port,a.version,a.commit,a.configSha256,a.configPath??'',a.projectDir??''])if(String(v).includes('\t')||String(v).includes('\n'))throw new Error('ROUTER_STATE_TSV_UNSAFE');
  console.log([s.profile,s.generation,a.port,a.version,a.commit,a.configSha256,a.configPath??'',a.projectDir??''].join('\t'));
}else console.log(JSON.stringify(s,null,2));
