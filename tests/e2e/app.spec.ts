import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  await expect(page.getByText('Résultat (modifiable)')).toBeVisible();
  await page.getByRole('button', { name: 'Garder source' }).click();
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
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, dir);
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await page.getByRole('button', { name: 'Dossier local' }).click();
  await page.getByRole('button', { name: 'Choisir…' }).click();
  await expect(page.getByLabel('Dossier local')).toHaveValue(dir);
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await expect(page.getByText('Dossier hors git')).toBeVisible();
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
