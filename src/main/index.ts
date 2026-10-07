import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, safeStorage, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFile, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import icon from '../../build/icon.png?asset';
import pkg from '../../package.json';
import { API_METHODS } from '../shared/api';
import { AuthStore } from './auth';
import { createAzureContext } from './azure/client';
import { fakeContext } from './azure/fake';
import { createHandlers } from './ipc';
import { createUpdater } from './updater';
import { createMacInstaller, type MacInstaller } from './macUpdate';
import { SettingsStore, type ThemeSource } from './settings';
import { isSafeExternalUrl } from './urls';

// Version de l'app (app.getVersion() renvoie celle d'Electron quand l'app n'est pas packagée).
const APP_VERSION = pkg.version;
const RELEASES_URL = 'https://github.com/khalilbenaz/azure-branch-diff/releases/latest';

// Tests E2E : profil isolé (jamais pris en compte par l'app installée, sauf pour le test de démarrage).
if (process.env.ABD_USER_DATA && (!app.isPackaged || process.env.AZ_FAKE === '1')) app.setPath('userData', process.env.ABD_USER_DATA);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Azure Branch Diff',
    icon,
    show: false,
    // Fond identique à l'interface : pas d'éclair blanc avant le premier rendu.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#11161d' : '#f3f4f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // macOS : après un redimensionnement (bord, plein écran, mosaïque), la surface affichée peut garder
  // l'ancienne taille et laisser voir le fond natif à droite. On force un rendu complet à la nouvelle taille.
  const repaint = () => {
    if (!win.isDestroyed()) win.webContents.invalidate();
  };
  for (const ev of ['resize', 'resized', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore'] as const) {
    win.on(ev as 'resize', repaint);
  }
  // L'app ne navigue jamais : tout lien externe part dans le navigateur.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Serveur de développement uniquement hors app installée (sinon une variable d'environnement chargerait une page distante).
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(() => {
  // Thème choisi par l'utilisateur (Système / Clair / Sombre) : appliqué avant la première fenêtre,
  // il pilote prefers-color-scheme (interface, Monaco) et les boîtes de dialogue natives.
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  nativeTheme.themeSource = settings.theme();
  // Fond natif des fenêtres aligné sur le thème effectif (aussi quand le système bascule clair/sombre).
  nativeTheme.on('updated', () => {
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#11161d' : '#f3f4f7');
  });
  ipcMain.handle('theme:get', () => settings.theme());
  ipcMain.handle('theme:set', (_e, t: unknown) => {
    settings.setTheme(t as ThemeSource); // valeur vérifiée par SettingsStore
    nativeTheme.themeSource = settings.theme();
  // Fond natif des fenêtres aligné sur le thème effectif (aussi quand le système bascule clair/sombre).
  nativeTheme.on('updated', () => {
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#11161d' : '#f3f4f7');
  });
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#11161d' : '#f3f4f7');
    return settings.theme();
  });

  // En développement, le Dock afficherait l'icône d'Electron.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon);
  // Aucune permission navigateur (caméra, notifications, géolocalisation…) n'est nécessaire.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const handlers = createHandlers({
    store: new AuthStore(join(app.getPath('userData'), 'credentials.json'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
    }),
    // AZ_FAKE=1 : Azure simulé (démo, tests) ; AZ_FAKE_BULK=n : n fichiers modifiés (tests de performance).
    connect: process.env.AZ_FAKE === '1' ? async () => fakeContext({ bulkChanges: Number(process.env.AZ_FAKE_BULK) || undefined }) : createAzureContext,
    // Mode démo : organisations « découvertes » fictives.
    discover: process.env.AZ_FAKE === '1' ? async () => ['https://dev.azure.com/demo', 'https://dev.azure.com/demo2'] : undefined,
    pickFolder: async () => {
      const win = BrowserWindow.getFocusedWindow();
      const opts = { properties: ['openDirectory' as const], title: 'Choisir le dossier local à comparer' };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    openExternal: (url) => shell.openExternal(url),
    confirm: async (message, detail) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const opts = { type: 'question' as const, buttons: ['Pousser', 'Annuler'], defaultId: 1, cancelId: 1, message, detail, noLink: true };
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      return r.response === 0;
    },
  });
  // macOS : l'app installe elle-même ses mises à jour (pas de signature Developer ID pour Squirrel.Mac).
  let mac: MacInstaller | undefined;
  if (process.platform === 'darwin' && app.isPackaged) {
    try {
      mac = createMacInstaller({
        arch: process.arch,
        bundlePath: resolve(app.getPath('exe'), '..', '..', '..'),
        bundleId: 'com.khalilbenaz.azurebranchdiff',
        tmpDir: app.getPath('temp'),
        repo: 'khalilbenaz/azure-branch-diff',
        pid: process.pid,
        fetch: (url) => net.fetch(url),
        run: (cmd, args) =>
          new Promise((ok, ko) => execFile(cmd, args, { encoding: 'utf8', maxBuffer: 4 << 20 }, (e, out) => (e ? ko(e) : ok(out)))),
        spawnDetached: (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(),
        quit: () => app.quit(),
      });
    } catch {
      mac = undefined; // emplacement inattendu : notification et téléchargement manuel
    }
  }
  const updates = createUpdater({
    mac,
    updater: autoUpdater,
    platform: process.platform,
    // Pas de contrôle en développement ni en mode démo/tests.
    isPackaged: app.isPackaged && process.env.AZ_FAKE !== '1',
    releasesUrl: RELEASES_URL,
    send: (state) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update:state', state)),
    openExternal: (url) => shell.openExternal(url),
  });
  ipcMain.handle('update:get', () => ({ state: updates.state(), version: APP_VERSION }));
  ipcMain.handle('update:check', () => updates.check());
  ipcMain.handle('update:install', () => updates.install());
  updates.start();
  // Fermeture avec une version prête : elle est installée (sans relance), comme sous Windows.
  let installingOnQuit = false;
  app.on('before-quit', (e) => {
    if (process.platform !== 'darwin' || installingOnQuit || updates.state().kind !== 'ready') return;
    installingOnQuit = true;
    e.preventDefault();
    void updates.installOnQuit().finally(() => app.quit());
  });

  for (const m of API_METHODS) {
    ipcMain.handle(`api:${m}`, (_e, ...args: unknown[]) => (handlers[m] as (...a: unknown[]) => unknown)(...args));
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
