/*
 * Ad-hoc-Signatur nach dem Packen (ohne Apple-Developer-Konto).
 * Auf Apple-Silicon-Macs startet eine App nur mit gültiger (auch ad-hoc) Signatur.
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
