import { test, expect, chromium } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Vérifie l'app packagée (release.noindex/). Ignoré si aucun build packagé.
const exe =
  process.platform === 'darwin'
    ? `release.noindex/mac${process.arch === 'arm64' ? '-arm64' : ''}/Azure Branch Diff.app/Contents/MacOS/Azure Branch Diff`
    : 'release.noindex/win-unpacked/Azure Branch Diff.exe';

test.skip(!existsSync(exe), 'pas de build packagé');

// Fermé aussi quand le test dépasse son délai (le finally ne s'exécute pas toujours dans ce cas).
let child: ChildProcess | undefined;
test.afterEach(() => {
  child?.kill('SIGKILL');
  child = undefined;
});

test('l’app packagée démarre et affiche l’écran de connexion', async () => {
  test.setTimeout(90_000);
  // Les fuses interdisent --inspect (utilisé par _electron.launch) : on passe par le protocole CDP de Chromium.
  const port = 9300 + Math.floor(Math.random() * 600);
  child = spawn(exe, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-pkg-')) },
    stdio: 'ignore',
  });
  try {
    let browser;
    for (let i = 0; i < 60 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
      if (!browser) await new Promise((r) => setTimeout(r, 500));
    }
    expect(browser, 'connexion CDP').toBeTruthy();
    let page = browser!.contexts()[0]?.pages()[0];
    for (let i = 0; i < 20 && !page; i++) {
      await new Promise((r) => setTimeout(r, 250));
      page = browser!.contexts()[0]?.pages()[0];
    }
    await expect(page!.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await page!.getByLabel('Organisation').fill('https://dev.azure.com/demo');
    await page!.getByLabel('Personal Access Token').fill('x');
    await page!.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page!.getByRole('tab', { name: 'Comparer' })).toBeVisible();
    await browser!.close();
  } finally {
    child?.kill();
  }
});

test('fuses : l’app packagée refuse de s’exécuter comme Node', () => {
  const r = spawnSync(exe, ['-e', 'console.log("RUN_AS_NODE_OK")'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-fuse-')) },
    timeout: 8000,
    encoding: 'utf8',
  });
  expect(`${r.stdout ?? ''}`).not.toContain('RUN_AS_NODE_OK');
});
