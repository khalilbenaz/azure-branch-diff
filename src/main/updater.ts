import type { UpdateState } from '../shared/types';

/** Sous-ensemble d'electron-updater utilisé ici (remplaçable par un fake dans les tests). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface UpdaterDeps {
  updater: UpdaterLike;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** Page des versions, ouverte quand l'installation automatique n'est pas possible. */
  releasesUrl: string;
  send(state: UpdateState): void;
  openExternal(url: string): Promise<void>;
}

const FIRST_CHECK_MS = 10_000;
const PERIOD_MS = 4 * 3600_000;

/**
 * Mise à jour via les Releases GitHub.
 * Windows : téléchargement en arrière-plan puis installation au redémarrage.
 * macOS : l'installation automatique exige une signature Developer ID ; sans elle, on notifie
 * et l'utilisateur télécharge le .dmg en un clic.
 */
export function createUpdater(d: UpdaterDeps) {
  const automatic = d.platform === 'win32';
  let current: UpdateState = { kind: 'idle' };
  let timers: NodeJS.Timeout[] = [];
  const set = (s: UpdateState) => {
    current = s;
    d.send(s);
  };

  d.updater.autoDownload = automatic;
  d.updater.autoInstallOnAppQuit = automatic;

  d.updater.on('checking-for-update', () => set({ kind: 'checking' }));
  d.updater.on('update-not-available', () => set({ kind: 'idle' }));
  d.updater.on('update-available', (info: { version: string }) =>
    set(automatic ? { kind: 'downloading', version: info.version, percent: 0 } : { kind: 'available', version: info.version, manual: true }),
  );
  d.updater.on('download-progress', (p: { percent: number }) => {
    const version = 'version' in current ? current.version : '';
    set({ kind: 'downloading', version, percent: Math.round(p.percent) });
  });
  d.updater.on('update-downloaded', (info: { version: string }) => set({ kind: 'ready', version: info.version }));
  // Pas de détail technique (URL, en-têtes) dans l'interface. Une mise à jour déjà prête reste proposée.
  d.updater.on('error', () => {
    if (current.kind === 'ready') return d.send(current);
    set({
      kind: 'error',
      message: current.kind === 'downloading' ? 'Le téléchargement de la mise à jour a échoué.' : 'Impossible de vérifier les mises à jour.',
    });
  });

  async function check(): Promise<void> {
    // Un téléchargement en cours ou une version prête ne sont pas remis en cause par le contrôle périodique.
    if (!d.isPackaged || current.kind === 'downloading' || current.kind === 'ready') return;
    set({ kind: 'checking' });
    try {
      await d.updater.checkForUpdates();
    } catch {
      if (current.kind !== 'error') set({ kind: 'error', message: 'Impossible de vérifier les mises à jour.' });
    }
  }

  return {
    check,
    state: () => current,
    async install(): Promise<void> {
      // Installeur silencieux puis relance de l'app (NSIS par utilisateur : pas d'élévation nécessaire).
      if (automatic && current.kind === 'ready') d.updater.quitAndInstall(true, true);
      else if (!automatic) await d.openExternal(d.releasesUrl);
    },
    start() {
      timers.push(setTimeout(() => void check(), FIRST_CHECK_MS));
      timers.push(setInterval(() => void check(), PERIOD_MS));
    },
    stop() {
      timers.forEach((t) => clearTimeout(t));
      timers = [];
    },
  };
}
