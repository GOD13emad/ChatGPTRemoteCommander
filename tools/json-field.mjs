import fs from 'node:fs';
function parse(argv){const o={};for(let i=0;i<argv.length;i++){const a=argv[i],v=argv[++i];if(v===undefined)throw new Error('JSON_FIELD_ARGUMENT');if(a==='--file')o.file=v;else if(a==='--field')o.field=v;else throw new Error('JSON_FIELD_ARGUMENT');}if(!o.file||!o.field)throw new Error('JSON_FIELD_REQUIRED');return o;}
const o=parse(process.argv.slice(2)),obj=JSON.parse(fs.readFileSync(o.file,'utf8'));
let v=obj;for(const part of o.field.split('.')){if(!part||v==null||typeof v!=='object'||!(part in v)){process.exit(3);}v=v[part];}
if(v===null||v===undefined)process.exit(3);
if(typeof v==='object')console.log(JSON.stringify(v));else console.log(String(v));
