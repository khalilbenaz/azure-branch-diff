import type { UpdateState } from '../shared/types';
import type { MacInstaller, UpdateFile } from './macUpdate';

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
  /** macOS : installation par l'app elle-même (sans Squirrel.Mac, qui exige une signature Developer ID). */
  mac?: MacInstaller;
}

const FIRST_CHECK_MS = 10_000;
const PERIOD_MS = 4 * 3600_000;

/**
 * Mise à jour via les Releases GitHub, automatique sur les deux systèmes.
 * Windows : electron-updater télécharge, puis installe au redémarrage.
 * macOS : l'app télécharge le zip, vérifie SHA-512, identifiant, version et signature, puis remplace
 * son bundle au redémarrage. Sans installateur (ou dossier non modifiable) : lien vers la page des versions.
 */
export function createUpdater(d: UpdaterDeps) {
  const win = d.platform === 'win32';
  const mac = d.platform === 'darwin' ? d.mac : undefined;
  const automatic = win || !!mac;
  let current: UpdateState = { kind: 'idle' };
  let timers: NodeJS.Timeout[] = [];
  let macDownload: Promise<void> | null = null;
  const set = (s: UpdateState) => {
    current = s;
    d.send(s);
  };

  // electron-updater ne télécharge et n'installe lui-même que sous Windows.
  d.updater.autoDownload = win;
  d.updater.autoInstallOnAppQuit = win;

  const downloadFailed = () => set({ kind: 'error', message: 'Le téléchargement de la mise à jour a échoué.' });

  d.updater.on('checking-for-update', () => set({ kind: 'checking' }));
  d.updater.on('update-not-available', () => set({ kind: 'idle' }));
  d.updater.on('update-available', (info: { version: string; files?: UpdateFile[] }) => {
    if (!automatic) return set({ kind: 'available', version: info.version, manual: true });
    set({ kind: 'downloading', version: info.version, percent: 0 });
    if (!mac || macDownload) return;
    macDownload = mac
      .download(info, (percent) => set({ kind: 'downloading', version: info.version, percent }))
      .then(() => set({ kind: 'ready', version: info.version }))
      .catch(downloadFailed)
      .finally(() => {
        macDownload = null;
      });
  });
  d.updater.on('download-progress', (p: { percent: number }) => {
    const version = 'version' in current ? current.version : '';
    set({ kind: 'downloading', version, percent: Math.round(p.percent) });
  });
  d.updater.on('update-downloaded', (info: { version: string }) => set({ kind: 'ready', version: info.version }));
  // Pas de détail technique (URL, en-têtes) dans l'interface. Une mise à jour déjà prête reste proposée.
  d.updater.on('error', () => {
    if (current.kind === 'ready') return d.send(current);
    if (current.kind === 'downloading') return downloadFailed();
    set({ kind: 'error', message: 'Impossible de vérifier les mises à jour.' });
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
      // Windows : installeur silencieux puis relance (NSIS par utilisateur : pas d'élévation nécessaire).
      if (win && current.kind === 'ready') return d.updater.quitAndInstall(true, true);
      // macOS : remplacement du bundle puis relance ; dossier non modifiable → page des versions.
      if (mac && current.kind === 'ready' && (await mac.install(true))) return;
      if (!win) await d.openExternal(d.releasesUrl);
    },
    /** Fermeture de l'app avec une version prête : installée sans relance (comme sous Windows). */
    async installOnQuit(): Promise<void> {
      if (mac && current.kind === 'ready') await mac.install(false);
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
