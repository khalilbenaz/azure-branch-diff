// Signature macOS avec le certificat auto-signé du projet (identité stable d'une version à l'autre :
// le trousseau macOS reconnaît l'app après une mise à jour, et l'app n'accepte que des mises à jour
// signées par ce même certificat). Sans certificat (build local), la signature ad hoc reste.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const identity = process.env.MAC_SIGN_IDENTITY; // empreinte SHA-1 du certificat
  const keychain = process.env.MAC_SIGN_KEYCHAIN;
  if (!identity || !keychain) {
    console.log('  • signature : ad hoc (pas de certificat MAC_SIGN_IDENTITY)');
    return;
  }
  if (!/^[0-9A-F]{40}$/i.test(identity)) throw new Error('MAC_SIGN_IDENTITY : empreinte SHA-1 attendue.');
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', identity, '--keychain', keychain, app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • signature : certificat ${identity.slice(0, 8)}…`);
};
