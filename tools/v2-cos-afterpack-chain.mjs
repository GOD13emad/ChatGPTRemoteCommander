// Copy into an isolated CoS v2.1.50 scripts/ checkout using the V2 staging tool.
// Keep the original upstream macOS hook unchanged and in the same execution order.
import macOS from './afterpack-macos-adhoc-seal.mjs';
import linux from './v2-cos-linux-afterpack.mjs';
export default async function commanderV2AfterPack(context) {
  if (context?.electronPlatformName === 'darwin') return macOS(context);
  if (context?.electronPlatformName === 'linux') return linux(context);
}
