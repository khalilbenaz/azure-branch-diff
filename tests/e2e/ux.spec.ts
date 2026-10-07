import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;

const AXE_SOURCE = readFileSync(createRequire(__filename).resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

/** Analyse axe-core (WCAG 2.1 AA) ; échoue sur toute violation sérieuse ou critique. */
async function a11y(context: string) {
  await page.evaluate(AXE_SOURCE); // evaluate passe par DevTools : non soumis à la CSP de la page
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: AxeViolation[] }> } }).axe;
    const r = await axe.run(
      // Monaco gère sa propre accessibilité (mode lecteur d'écran) : on l'exclut de l'analyse.
      { exclude: [['.monaco-editor'], ['.monaco-diff-editor']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) }));
  });
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${context}: ${v.id} — ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test.beforeAll(async () => {
  app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-ux-')) } });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
});
test.afterAll(async () => app?.close());

test('connexion au clavier seul, écran accessible', async () => {
  await expect(page.getByLabel('Organisation')).toBeFocused();
  await a11y('login');
  await page.keyboard.type('https://dev.azure.com/demo');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Personal Access Token')).toBeFocused();
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Comparer' })).toBeVisible();
});

test('écran Comparer accessible, avec résultat', async () => {
  await page.getByLabel('Projet').selectOption('Demo');
  await page.getByLabel('Dépôt').selectOption('repo1');
  await page.getByLabel('Branche source').selectOption('feature/data');
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByRole('button', { name: /Service\.cs/ }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await a11y('compare');
});

test('Actualiser recharge projets, dépôts et branches sans perdre la sélection', async () => {
  await page.getByRole('button', { name: 'Actualiser la liste' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByLabel('Projet')).toHaveValue('Demo');
  await expect(page.getByLabel('Dépôt')).toHaveValue('repo1');
  await expect(page.getByLabel('Branche source')).toHaveValue('feature/data');
  await expect(page.getByRole('button', { name: 'Comparer', exact: true })).toBeEnabled();
});

test('mode PR : les deux volets montrent l’état actuel des branches', async () => {
  await expect(page.getByText('Azure · master', { exact: true })).toBeVisible();
  await expect(page.getByText('Azure · feature/data', { exact: true })).toBeVisible();
  await expect(page.getByText(/ancêtre commun/)).toHaveCount(0);
});

test('liste des fichiers : chaque dossier se replie et se déplie', async () => {
  const src = page.getByRole('button', { name: /^src/ });
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /Data\.cs/ })).toBeVisible();
  await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /Data\.cs/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /big\.sql/ })).toBeVisible();
  await src.press('Enter');
  await expect(page.getByRole('button', { name: /Data\.cs/ })).toBeVisible();
  await page.getByRole('button', { name: 'Tout replier' }).click();
  await expect(page.locator('.tree-file')).toHaveCount(0);
  await a11y('tree-folded');
  await page.getByRole('button', { name: 'Tout déplier' }).click();
  await expect(page.locator('.tree-file')).toHaveCount(5);
});

test('guide d’utilisation : accessible depuis la barre latérale, sommaire navigable', async () => {
  await page.getByRole('tab', { name: 'Guide' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Guide d’utilisation' })).toBeVisible();
  const toc = page.getByRole('navigation', { name: 'Sommaire du guide' });
  await toc.getByRole('link', { name: 'Merge local, dans toutes les directions' }).click();
  await expect(page.getByRole('heading', { name: /Merge local, dans toutes les directions/ })).toBeInViewport();
  await a11y('guide');
  await page.getByRole('tab', { name: 'Comparer' }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
});

test('le bouton Comparer reste désactivé tant que la sélection est incomplète', async () => {
  await page.getByLabel('Branche source').selectOption('');
  await expect(page.getByRole('button', { name: 'Comparer', exact: true })).toBeDisabled();
  await page.getByLabel('Branche source').selectOption('master');
  await expect(page.getByText('Choisissez deux branches différentes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comparer', exact: true })).toBeDisabled();
  await page.getByLabel('Branche source').selectOption('feature/data');
});

test('filtre de fichiers par nom et par extension', async () => {
  await page.getByRole('button', { name: 'Comparer', exact: true }).click();
  await page.getByLabel('Filtrer les fichiers').fill('data');
  await expect(page.locator('.tree-file')).toHaveCount(1);
  await page.getByLabel('Filtrer les fichiers').fill('');
  await page.getByLabel('Extension').selectOption('sql');
  await expect(page.locator('.tree-file')).toHaveCount(2);
  await page.getByLabel('Extension').selectOption('');
});

test('écrans PR et Conflits accessibles', async () => {
  await page.getByRole('button', { name: 'Créer / ouvrir la PR' }).click();
  await a11y('pr-form');
  await page.getByRole('button', { name: 'Créer la PR' }).click();
  await page.getByRole('button', { name: 'Gérer les conflits' }).click();
  await expect(page.getByLabel('Conflits', { exact: true }).getByText('src/Service.cs')).toBeVisible();
  await a11y('conflicts');
});

test('thème sombre suivi automatiquement', async () => {
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'dark' });
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(light).not.toBe(dark);
  expect(dark).toBe('rgb(17, 22, 29)');
  await a11y('dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

test('petite fenêtre (900×600) : pas de défilement horizontal', async () => {
  await page.setViewportSize({ width: 900, height: 600 });
  for (const tab of ['Comparer', 'Pull Request', 'Conflits']) {
    await page.getByRole('tab', { name: tab }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, tab).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('bandeau de mise à jour : version disponible, progression, prête', async () => {
  const push = (state: unknown) =>
    app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', s), state);
  await push({ kind: 'available', version: '9.9.9', manual: true });
  await expect(page.getByText('La version 9.9.9 est disponible.')).toBeVisible();
  await a11y('update-banner');
  if (process.platform === 'darwin') {
    await app.evaluate(({ shell }) => {
      (globalThis as unknown as { opened: string[] }).opened = [];
      shell.openExternal = async (url: string) => void (globalThis as unknown as { opened: string[] }).opened.push(url);
    });
    await page.getByRole('button', { name: 'Télécharger' }).click();
    const opened = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
    expect(opened).toEqual(['https://github.com/khalilbenaz/azure-branch-diff/releases/latest']);
  }
  await push({ kind: 'downloading', version: '9.9.9', percent: 37 });
  await expect(page.getByText(/Téléchargement de la version 9\.9\.9… 37 %/)).toBeVisible();
  await push({ kind: 'ready', version: '9.9.9' });
  await expect(page.getByRole('button', { name: 'Redémarrer pour installer' })).toBeVisible();
  await page.getByRole('button', { name: 'Au prochain lancement' }).click();
  await expect(page.getByRole('button', { name: 'Redémarrer pour installer' })).toHaveCount(0);
});

test('barre d’outils : trois cartes de même hauteur, contrôles alignés sur la même ligne', async () => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('tab', { name: 'Comparer' }).click();
  const bottom = async (l: ReturnType<typeof page.locator>) => {
    const b = (await l.boundingBox())!;
    return Math.round(b.y + b.height);
  };
  const ref = await bottom(page.getByLabel('Branche source'));
  for (const l of [
    page.getByLabel('Branche cible'),
    page.getByRole('button', { name: 'Inverser source et cible' }),
    page.getByRole('button', { name: 'Comparer', exact: true }),
    page.getByRole('button', { name: 'Fusionner' }),
  ]) {
    expect(Math.abs((await bottom(l)) - ref)).toBeLessThanOrEqual(1);
  }
  const heights = await page.locator('.toolbar .side-card').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(heights).toHaveLength(3);
  // Même ordre que le diff : cible à gauche, source à droite.
  const order = await page.locator('.toolbar .side-card .eyebrow').allInnerTexts();
  expect(order.map((t) => t.toUpperCase())).toEqual(['CIBLE', 'SOURCE', 'MODE']);
  expect(new Set(heights).size).toBe(1);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('choix du thème : sombre, clair, puis système (mémorisé)', async () => {
  await page.emulateMedia({ colorScheme: null }); // pas d'émulation : le thème natif décide
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const group = page.getByRole('group', { name: 'Thème' });
  await group.getByRole('button', { name: 'Sombre' }).click();
  await expect.poll(bg).toBe('rgb(17, 22, 29)');
  await expect(group.getByRole('button', { name: 'Sombre' })).toHaveAttribute('aria-pressed', 'true');
  await a11y('theme-dark');
  await group.getByRole('button', { name: 'Clair' }).click();
  await expect.poll(bg).toBe('rgb(243, 244, 247)');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
  await group.getByRole('button', { name: 'Système' }).click();
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system');
});
