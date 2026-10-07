import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

let app: ElectronApplication;
let page: Page;
const shots = process.env.ABD_SHOTS;

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-e2e-')) },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('dialog', (d) => d.accept());
});

test.afterAll(async () => {
  await app?.close();
});

test('connexion, comparaison, diff, PR et conflits', async () => {
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await shot('01-login');
  await page.getByLabel('Organisation').fill('https://dev.azure.com/demo');
  await page.getByLabel('Personal Access Token').fill('x');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('tab', { name: 'Comparer' })).toBeVisible();

  await page.getByLabel('Projet').selectOption('Demo');
  await page.getByLabel('Dépôt').selectOption('repo1');
  await page.getByLabel('Branche source').selectOption('feature/data');
  await expect(page.getByLabel('Branche cible')).toHaveValue('master');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();

  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await expect(page.locator('.counts').first()).toContainText('+');
  await shot('02-diff');

  await page.getByRole('button', { name: /logo\.png/ }).click();
  await expect(page.getByText(/fichier binaire/)).toBeVisible();
  await page.getByRole('button', { name: /big\.sql/ }).click();
  await expect(page.getByText(/trop volumineux/)).toBeVisible();

  await page.getByRole('button', { name: 'Créer / ouvrir la PR' }).click();
  await page.getByRole('button', { name: 'Créer la PR' }).click();
  await expect(page.getByRole('button', { name: 'Gérer les conflits' })).toBeVisible({ timeout: 15000 });
  await shot('03-pr');
  await page.getByRole('button', { name: 'Gérer les conflits' }).click();

  await expect(page.getByLabel('Conflits', { exact: true }).getByText('src/Service.cs')).toBeVisible();
  await shot('04-conflicts');
  const appButtons = page.getByRole('button', { name: "Régler dans l'app" });
  await expect(appButtons.nth(1)).toBeDisabled();
  await appButtons.first().click();
  await expect(page.getByText('Fichier final', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tout prendre de feature/data' }).click();
  await shot('05-resolver');
  await page.getByRole('button', { name: 'Valider la résolution' }).click();
  await expect(page.getByText('Conflit résolu : src/Service.cs')).toBeVisible();
  await expect(page.getByText('Résolu', { exact: true })).toBeVisible();
  // Un conflit déjà résolu ne se règle plus dans l'app.
  await expect(page.getByRole('button', { name: "Régler dans l'app" }).first()).toBeDisabled();
});

test('recomparer les mêmes branches recharge l’onglet PR sur la PR active', async () => {
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: 'Créer / ouvrir la PR' }).click();
  await expect(page.getByRole('heading', { name: /PR #1 : Merge feature\/data into master/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer la PR' })).toHaveCount(0);
});

test('comparaison avec un dossier local', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abd-local-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/Service.cs'), 'local\n');
  writeFileSync(join(dir, 'old.sql'), 'select 1;\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, dir);
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await page.getByRole('button', { name: 'Clone local' }).click();
  await expect(page.getByRole('button', { name: 'Clone local' })).toContainText(basename(realpathSync.native(dir)));
  await page.getByRole('group', { name: 'Type de source' }).getByRole('button', { name: 'Local' }).click();
  await page.getByLabel('Référence source').selectOption('worktree');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await shot('06-local');
  // Fichier uniquement local : rien à ouvrir dans Azure.
  writeFileSync(join(dir, 'only-local.cs'), 'x\n');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: /only-local\.cs/ }).click();
  await expect(page.getByRole('button', { name: 'Ouvrir dans Azure' })).toBeDisabled();
  // Une comparaison locale vide l'onglet PR.
  await page.getByRole('tab', { name: 'Pull Request' }).click();
  await expect(page.getByText(/Comparez d'abord deux branches Azure/)).toBeVisible();
});

test('dossier téléchargé sans git : ouvert sans erreur et comparé à une branche Azure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abd-zip-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/Service.cs'), 'from zip\n');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, dir);
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await page.getByRole('button', { name: 'Clone local' }).click();
  await expect(page.getByRole('button', { name: 'Clone local' })).toContainText(basename(realpathSync.native(dir)));
  await expect(page.locator('.banner-error')).toHaveCount(0);
  await page.getByLabel('Référence source').selectOption('worktree');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
});

test('fichiers qui ne diffèrent que par des espaces : masqués, affichables', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abd-ws-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/Service.cs'), 'vraiment différent\n');
  writeFileSync(join(dir, 'old.sql'), '\n   select    1;\r\n\r\n'); // master : « select 1;\n »
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, dir);
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await page.getByRole('button', { name: 'Clone local' }).click();
  await expect(page.getByRole('button', { name: 'Clone local' })).toContainText(basename(realpathSync.native(dir)));
  await page.getByLabel('Référence source').selectOption('worktree');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  const note = page.getByRole('note');
  await expect(note).toContainText('1 fichier qui ne diffère que par des espaces');
  await expect(page.getByRole('button', { name: /old\.sql/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Service\.cs/ })).toBeVisible();
  await note.getByRole('button', { name: 'Afficher' }).click();
  await expect(page.getByRole('button', { name: /old\.sql/ })).toContainText('espaces seulement');
  await note.getByRole('button', { name: 'Masquer' }).click();
});
