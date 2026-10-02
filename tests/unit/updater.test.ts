import { test, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createUpdater, type UpdaterLike } from '../../src/main/updater';
import type { UpdateState } from '../../src/shared/types';

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checks = 0;
  downloads = 0;
  installed = false;
  async checkForUpdates() {
    this.checks++;
    return null;
  }
  async downloadUpdate() {
    this.downloads++;
    return [];
  }
  installArgs: unknown[] = [];
  quitAndInstall(...args: unknown[]) {
    this.installed = true;
    this.installArgs = args;
  }
}

const RELEASES = 'https://github.com/khalilbenaz/azure-branch-diff/releases/latest';

function setup(platform: NodeJS.Platform, isPackaged = true) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const opened: string[] = [];
  const u = createUpdater({ updater, platform, isPackaged, releasesUrl: RELEASES, send: (s) => states.push(s), openExternal: async (url) => void opened.push(url) });
  return { updater, states, opened, u };
}

test('windows : téléchargement automatique puis installation au redémarrage', async () => {
  const { updater, states, u } = setup('win32');
  expect(updater.autoDownload).toBe(true);
  expect(updater.autoInstallOnAppQuit).toBe(true);
  await u.check();
  expect(updater.checks).toBe(1);
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('download-progress', { percent: 42.4 });
  updater.emit('update-downloaded', { version: '1.2.0' });
  expect(states).toEqual([
    { kind: 'checking' },
    { kind: 'downloading', version: '1.2.0', percent: 0 },
    { kind: 'downloading', version: '1.2.0', percent: 42 },
    { kind: 'ready', version: '1.2.0' },
  ]);
  await u.install();
  expect(updater.installed).toBe(true);
});

test('macOS (app non signée Developer ID) : notification et téléchargement manuel du .dmg', async () => {
  const { updater, states, opened, u } = setup('darwin');
  expect(updater.autoDownload).toBe(false);
  updater.emit('update-available', { version: '1.2.0' });
  expect(states.at(-1)).toEqual({ kind: 'available', version: '1.2.0', manual: true });
  await u.install();
  expect(updater.installed).toBe(false);
  expect(updater.downloads).toBe(0);
  expect(opened).toEqual([RELEASES]);
});

test('aucune mise à jour : retour à l’état inactif', () => {
  const { updater, states } = setup('win32');
  updater.emit('update-not-available', {});
  expect(states.at(-1)).toEqual({ kind: 'idle' });
});

test('erreur réseau du contrôle : état erreur, message court sans détails techniques', () => {
  const { updater, states } = setup('win32');
  updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED at https://github.com/... token=abc'));
  expect(states.at(-1)).toEqual({ kind: 'error', message: 'Impossible de vérifier les mises à jour.' });
});

test('en développement (app non packagée) : aucun contrôle', async () => {
  const { updater, u } = setup('win32', false);
  await u.check();
  expect(updater.checks).toBe(0);
});

test('contrôle périodique toutes les 4 h et au démarrage', async () => {
  vi.useFakeTimers();
  const { updater, u } = setup('win32');
  u.start();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(updater.checks).toBe(1);
  await vi.advanceTimersByTimeAsync(4 * 3600_000);
  expect(updater.checks).toBe(2);
  u.stop();
  vi.useRealTimers();
});

test('l’état courant est mémorisé pour une fenêtre ouverte plus tard', () => {
  const { updater, u } = setup('darwin');
  updater.emit('update-available', { version: '2.0.0' });
  expect(u.state()).toEqual({ kind: 'available', version: '2.0.0', manual: true });
});

test('un contrôle périodique n’écrase pas une mise à jour prête', async () => {
  const { updater, states, u } = setup('win32');
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('update-downloaded', { version: '1.2.0' });
  await u.check();
  expect(updater.checks).toBe(0);
  expect(u.state()).toEqual({ kind: 'ready', version: '1.2.0' });
  updater.emit('error', new Error('offline'));
  expect(u.state()).toEqual({ kind: 'ready', version: '1.2.0' });
  expect(states.at(-1)).toEqual({ kind: 'ready', version: '1.2.0' });
});

test('un échec de téléchargement est signalé', () => {
  const { updater, u } = setup('win32');
  updater.emit('update-available', { version: '1.2.0' });
  updater.emit('error', new Error('download failed'));
  expect(u.state()).toEqual({ kind: 'error', message: 'Le téléchargement de la mise à jour a échoué.' });
});

test('installation Windows silencieuse avec relance de l’app', async () => {
  const { updater, u } = setup('win32');
  updater.emit('update-downloaded', { version: '1.2.0' });
  await u.install();
  expect(updater.installArgs).toEqual([true, true]);
});
