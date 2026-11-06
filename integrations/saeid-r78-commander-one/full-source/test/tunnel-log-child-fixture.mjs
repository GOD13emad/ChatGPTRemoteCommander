import fs from 'node:fs';

const pidFile = process.argv[2];
const chunks = Number(process.argv[3] ?? 12);
const chunkBytes = Number(process.argv[4] ?? 65536);
fs.writeFileSync(pidFile, String(process.pid) + '\n');
for (let i = 0; i < chunks; i += 1) {
  const byte = 65 + (i % 26);
  const chunk = Buffer.alloc(chunkBytes, byte);
  await new Promise((resolve, reject) => {
    const stream = i % 5 === 4 ? process.stderr : process.stdout;
    if (stream.write(chunk)) resolve();
    else {
      stream.once('drain', resolve);
      stream.once('error', reject);
    }
  });
  await new Promise(resolve => setTimeout(resolve, 8));
}
process.stdout.write(Buffer.from('TUNNEL_CHILD_DONE\n'));
