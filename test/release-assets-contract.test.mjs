import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json','utf8'));
const builder = readFileSync('tools/build-release-assets.sh','utf8');
const workflow = readFileSync('.github/workflows/release-sync.yml','utf8');
const browserFetcher = readFileSync('scripts/fetch-browser-setup.ps1','utf8');
const innoFetcher = readFileSync('scripts/install-inno-setup.ps1','utf8');
const browserVersion = '0.8.0';
const browserSha256 = '61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e';
if (!/^[0-9a-f]{64}$/.test(browserSha256)) throw new Error('Browser release SHA pin must be concrete');

for (const required of [
  'plugin-template.zip',
  'plugin-template-v$VERSION.zip',
  'ChatGPT-Remote-Commander-v$VERSION-Installer.zip',
  'ChatGPT-Remote-Commander-Windows-Setup-v$VERSION.zip',
  'ChatGPT-Remote-Commander-Windows-Setup.zip',
  'ChatGPT-Remote-Commander-Linux-Setup-v$VERSION.zip',
  'ChatGPT-Remote-Commander-Linux-Setup.zip',
  'setup-wizard.ps1',
  'setup-wizard.sh',
  'build-device-plugin.ps1',
  'build-device-plugin.sh',
  'tools/generate-device-plugin.mjs',
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
if (!builder.includes('[[ "$count" -eq 19 ]]')) throw new Error('release asset count guard missing');
if (!builder.includes('Release commit: $COMMIT')) throw new Error('installer bundle provenance missing');

for (const required of [
  'actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
  './scripts/install-inno-setup.ps1',
  './scripts/fetch-browser-setup.ps1',
  "-Version '0.8.0'",
  "-Sha256 '61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e'",
  '-BrowserInstaller $browser',
  '.\\installer\\build-setup.ps1',
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  "if: github.event_name != 'pull_request'",
  'Remote-Commander-Setup-v${version}.exe',
  'bash tools/build-release-assets.sh dist/release',
  'sha256sum -c SHA256SUMS.txt',
  'mapfile -t assets',
  'test "${#assets[@]}" -eq 20',
  'gh release create "$tag" "${assets[@]}"',
  '--verify-tag'
]) {
  if (!workflow.includes(required)) throw new Error(`release workflow missing ${required}`);
}
if (workflow.includes('gh release upload')) throw new Error('immutable release workflow must attach assets at create time, not after publication');
if (workflow.includes('choco install innosetup')) throw new Error('release workflow must not depend on mutable Chocolatey Inno acquisition');
if (!browserFetcher.includes('releases/download/v$Version/$Name')) throw new Error('Browser fetcher must use immutable versioned release URL');
if (!browserFetcher.includes('Get-FileHash') || !browserFetcher.includes('Browser SHA256 mismatch')) throw new Error('Browser dependency hash verification missing');
if (!innoFetcher.includes('9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732')) throw new Error('Inno Setup compiler hash pin missing');
if (!workflow.includes(browserVersion) || !workflow.includes(browserSha256)) throw new Error('Browser release pin missing from workflow');
if (!workflow.includes('docs/RELEASE_${version}.md')) throw new Error('release notes must follow package version');
if (pkg.version !== '0.10.19') throw new Error(`unexpected package version ${pkg.version}`);

console.log('RELEASE_ASSET_CONTRACT_PASS');
