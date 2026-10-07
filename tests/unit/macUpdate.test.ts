import { test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMacInstaller, pickZip, SWAP_SCRIPT, type MacInstallerDeps } from '../../src/main/macUpdate';

const ZIP = Buffer.from('contenu du zip');
const SHA = createHash('sha512').update(ZIP).digest('base64');
const FILES = [
  { url: 'Azure-Branch-Diff-mac-x64.zip', sha512: 'autre' },
  { url: 'Azure-Branch-Diff-mac-arm64.zip', sha512: SHA, size: ZIP.length },
  { url: 'Azure-Branch-Diff-mac-arm64.dmg', sha512: 'dmg' },
];

function setup(over: Partial<MacInstallerDeps> = {}, plist = { id: 'com.khalilbenaz.azurebranchdiff', version: '9.9.9' }) {
  const apps = mkdtempSync(join(tmpdir(), 'abd-apps-'));
  const bundle = join(apps, 'Azure Branch Diff.app');
  mkdirSync(bundle);
  const calls: string[][] = [];
  const spawned: string[][] = [];
  let quit = 0;
  const fetched: string[] = [];
  const deps: MacInstallerDeps = {
    arch: 'arm64',
    bundlePath: bundle,
    bundleId: 'com.khalilbenaz.azurebranchdiff',
    tmpDir: mkdtempSync(join(tmpdir(), 'abd-tmp-')),
    repo: 'khalilbenaz/azure-branch-diff',
    pid: 4242,
    fetch: async (url) => {
      fetched.push(url);
      return new Response(ZIP, { headers: { 'content-length': String(ZIP.length) } });
    },
    run: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd.endsWith('defaults')) return args[2] === 'CFBundleIdentifier' ? `${plist.id}\n` : `${plist.version}\n`;
      return '';
    },
    spawnDetached: (cmd, args) => void spawned.push([cmd, ...args]),
    quit: () => void quit++,
    ...over,
  };
  return { deps, bundle, calls, spawned, fetched, quits: () => quit };
}

test('pickZip : le zip de l’architecture, jamais le .dmg', () => {
  expect(pickZip(FILES, 'arm64').url).toBe('Azure-Branch-Diff-mac-arm64.zip');
  expect(pickZip(FILES, 'x64').url).toBe('Azure-Branch-Diff-mac-x64.zip');
  expect(() => pickZip([{ url: '../evil.zip', sha512: 'x' }], 'arm64')).toThrow();
});

test('téléchargement vérifié puis remplacement au redémarrage', async () => {
  const { deps, bundle, calls, spawned, fetched, quits } = setup();
  const mac = createMacInstaller(deps);
  const progress: number[] = [];
  await mac.download({ version: '9.9.9', files: FILES }, (p) => progress.push(p));
  expect(fetched).toEqual(['https://github.com/khalilbenaz/azure-branch-diff/releases/download/v9.9.9/Azure-Branch-Diff-mac-arm64.zip']);
  expect(progress.at(-1)).toBe(100);
  expect(calls.map((c) => c[0])).toEqual(['/usr/bin/ditto', '/usr/bin/defaults', '/usr/bin/defaults', '/usr/bin/codesign', '/usr/bin/xattr']);
  expect(await mac.install(true)).toBe(true);
  const [sh, script, pid, target, staged, relaunch] = spawned[0];
  expect([sh, pid, target, relaunch]).toEqual(['/bin/sh', '4242', bundle, '1']);
  expect(staged.endsWith('Azure Branch Diff.app')).toBe(true);
  expect(readFileSync(script, 'utf8')).toBe(SWAP_SCRIPT);
  expect(quits()).toBe(1);
  expect(await mac.install(true)).toBe(false); // une seule installation
});

test('empreinte SHA-512 différente : refusé, rien n’est installé', async () => {
  const { deps } = setup({ fetch: async () => new Response(Buffer.from('falsifié')) });
  const mac = createMacInstaller(deps);
  await expect(mac.download({ version: '9.9.9', files: FILES }, () => {})).rejects.toThrow(/SHA-512/);
  expect(await mac.install(true)).toBe(false);
});

test('autre application ou autre version dans le zip : refusé', async () => {
  await expect(createMacInstaller(setup({}, { id: 'com.evil', version: '9.9.9' }).deps).download({ version: '9.9.9', files: FILES }, () => {})).rejects.toThrow(/Identifiant/);
  await expect(createMacInstaller(setup({}, { id: 'com.khalilbenaz.azurebranchdiff', version: '1.0.0' }).deps).download({ version: '9.9.9', files: FILES }, () => {})).rejects.toThrow(/version/);
  await expect(createMacInstaller(setup().deps).download({ version: '9.9.9; rm -rf /', files: FILES }, () => {})).rejects.toThrow(/Version/);
});

test('emplacement inattendu : refusé dès la création', () => {
  expect(() => createMacInstaller({ ...setup().deps, bundlePath: 'relatif/App.app' })).toThrow();
  expect(() => createMacInstaller({ ...setup().deps, bundlePath: '/Applications' })).toThrow();
});

test.runIf(process.platform !== 'win32')('script de remplacement : nouvelle version en place, ancienne retirée', () => {
  const root = mkdtempSync(join(tmpdir(), 'abd-swap-'));
  const target = join(root, 'App.app');
  const fresh = join(root, 'new', 'App.app');
  mkdirSync(target);
  writeFileSync(join(target, 'v'), 'old');
  mkdirSync(fresh, { recursive: true });
  writeFileSync(join(fresh, 'v'), 'new');
  const script = join(root, 'swap.sh');
  writeFileSync(script, SWAP_SCRIPT);
  // pid inexistant : l'app est déjà fermée ; pas de relance.
  const r = spawnSync('/bin/sh', [script, '999999', target, fresh, '0']);
  expect(r.status).toBe(0);
  expect(readFileSync(join(target, 'v'), 'utf8')).toBe('new');
  expect(existsSync(`${target}.abd-previous`)).toBe(false);
});
