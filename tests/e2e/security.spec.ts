import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, AZ_FAKE: '1', ABD_USER_DATA: mkdtempSync(join(tmpdir(), 'abd-sec-')) } });
  page = await app.firstWindow();
});
test.afterAll(async () => app?.close());

test('le renderer n’a accès ni à Node ni à Electron', async () => {
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    module: typeof (window as unknown as { module?: unknown }).module,
    electron: typeof (window as unknown as { electron?: unknown }).electron,
  }));
  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined', electron: 'undefined' });
});

test('window.api n’expose que les méthodes du contrat', async () => {
  const keys = await page.evaluate(() => Object.keys((window as unknown as { api: object }).api).sort());
  expect(keys).toContain('login');
  expect(keys).not.toContain('invoke');
  expect(await page.evaluate(() => typeof (window as unknown as { api: { invoke?: unknown } }).api.invoke)).toBe('undefined');
});

test('webPreferences sécurisées', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = (w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null }).getLastWebPreferences() ?? {};
    return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox, webSecurity: p.webSecurity };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
});

test('une CSP stricte est appliquée', async () => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  for (const d of ["object-src 'none'", "base-uri 'none'", "form-action 'none'", "connect-src 'self'"]) expect(csp).toContain(d);
  // Un script inline injecté (ex. via du HTML malveillant) ne doit pas s'exécuter.
  const blocked = await page.evaluate(async () => {
    const w = window as unknown as { __pwned?: boolean };
    const el = document.createElement('script');
    el.textContent = 'window.__pwned = true';
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));
    return w.__pwned !== true;
  });
  expect(blocked).toBe(true);
});

test('la fenêtre ne peut pas naviguer ailleurs ni ouvrir de popup', async () => {
  const before = page.url();
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  const windows = app.windows().length;
  await page.evaluate(() => window.open('https://example.com/', '_blank'));
  await page.waitForTimeout(300);
  expect(app.windows().length).toBe(windows);
});

test('les permissions navigateur sont refusées', async () => {
  const notif = await page.evaluate(() => Notification.requestPermission());
  expect(notif).toBe('denied');
  const geo = await page.evaluate(
    () => new Promise<string>((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('granted'), (e) => resolve(`denied:${e.code}`))),
  );
  expect(geo).toMatch(/^denied/);
});
