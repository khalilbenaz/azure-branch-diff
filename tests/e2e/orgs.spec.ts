import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-orgs-')) } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('dialog', (d) => d.accept());
});
test.afterAll(async () => app?.close());

test('jeton multi-organisations : découvrir, ajouter, basculer, se déconnecter, retirer', async () => {
  await page.getByLabel('Personal Access Token').fill('multi');
  await page.getByLabel('Nom du jeton (facultatif)').fill('Toutes mes organisations');
  await page.getByRole('button', { name: 'Découvrir mes organisations' }).click();
  await expect(page.getByLabel('demo2')).toBeChecked();
  await page.getByRole('button', { name: 'Ajouter 2 organisations' }).click();

  await expect(page.getByRole('tab', { name: 'Comparer' })).toBeVisible();
  const switcher = page.getByLabel('Organisation active');
  await expect(switcher).toHaveValue('https://dev.azure.com/demo');
  await switcher.selectOption('https://dev.azure.com/demo2');
  await expect(page.locator('.brand-name span')).toHaveText('dev.azure.com/demo2');

  await page.getByRole('button', { name: 'Déconnexion' }).click();
  const list = page.getByRole('list', { name: 'Organisations enregistrées' });
  await expect(list.getByText('demo', { exact: true })).toBeVisible();
  await expect(list.getByText('demo2')).toBeVisible();
  await expect(list.getByText('Jeton : Toutes mes organisations').first()).toBeVisible();

  await page.getByRole('button', { name: 'Retirer demo2' }).click();
  await expect(list.getByText('demo2')).toHaveCount(0);
  await page.getByRole('button', { name: 'Se connecter à demo' }).click();
  await expect(page.getByRole('tab', { name: 'Comparer' })).toBeVisible();
  await expect(page.getByLabel('Organisation active')).toHaveCount(0); // une seule organisation : pas de sélecteur
});
