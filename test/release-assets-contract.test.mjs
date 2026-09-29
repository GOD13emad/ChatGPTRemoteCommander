import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json','utf8'));
const builder = readFileSync('tools/build-release-assets.sh','utf8');
const workflow = readFileSync('.github/workflows/release-sync.yml','utf8');

for (const required of [
  'plugin-template.zip',
  'plugin-template-v$VERSION.zip',
  'ChatGPT-Remote-Commander-v$VERSION-Installer.zip',
  'server-install-windows.ps1',
  'server-install-linux.sh',
  'SHA256SUMS.txt',
  'SHA256SUMS-INSTALLER.txt',
  'zip_tree',
  'sha256sum -c SHA256SUMS.txt',
  'count="$('
]) {
  if (!builder.includes(required)) throw new Error(`release asset builder missing ${required}`);
}
if (!builder.includes('[[ "$count" -eq 15 ]]')) throw new Error('release asset count guard missing');
if (!builder.includes('Release commit: $COMMIT')) throw new Error('installer bundle provenance missing');

for (const required of [
  'bash tools/build-release-assets.sh dist/release',
  '(cd dist/release && sha256sum -c SHA256SUMS.txt)',
  'mapfile -t assets',
  'test "${#assets[@]}" -eq 15',
  'gh release create "$tag" "${assets[@]}"',
  '--verify-tag'
]) {
  if (!workflow.includes(required)) throw new Error(`release workflow missing ${required}`);
}
if (workflow.includes('gh release upload')) throw new Error('immutable release workflow must attach assets at create time, not after publication');
if (!workflow.includes('docs/RELEASE_${version}.md')) throw new Error('release notes must follow package version');
if (pkg.version !== '0.9.23') throw new Error(`unexpected package version ${pkg.version}`);

console.log('RELEASE_ASSET_CONTRACT_PASS');
