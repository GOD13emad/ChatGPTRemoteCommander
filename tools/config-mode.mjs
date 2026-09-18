import fs from 'node:fs';
const file = process.argv[2];
if (!file) throw new Error('config path required');
const data = JSON.parse(fs.readFileSync(file,'utf8'));
const power = data.powerMode?.enabled === true;
const gui = data.powerMode?.guiControl?.enabled === true;
process.stdout.write(power ? (gui ? 'POWER + GUI' : 'POWER') : 'STANDARD');
