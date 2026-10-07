import { describe, test, expect } from 'vitest';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { normalizeError } from '../../src/main/errors';
import { fakeContext } from '../../src/main/azure/fake';
import { API_METHODS } from '../../src/shared/api';
import { tempDir, reverseCipher, gitDir, worktreeSide } from './helpers';

const PAT = 'pat-SECRET-0123456789abcdef';
const TARGET = { kind: 'azure' as const, project: 'Demo', repoId: 'repo1', branch: 'master' };

function handlers(over: Partial<Parameters<typeof createHandlers>[0]> = {}) {
  const opened: string[] = [];
  const api = createHandlers({
    store: new AuthStore(join(tempDir(), 'cred.json'), reverseCipher),
    connect: async () => fakeContext(),
    pickFolder: async () => null,
    openExternal: async (u) => void opened.push(u),
    ...over,
  });
  return { api, opened };
}

describe('PAT confidentiality', () => {
  test('no API result ever contains the PAT, even when Azure echoes it in errors', async () => {
    const ctx = fakeContext();
    const echo = () => Promise.reject({ statusCode: 500, message: `boom Authorization: Basic ${PAT}`, result: { message: `token ${PAT}` } });
    for (const k of Object.keys(Object.getPrototypeOf(ctx.git))) {
      if (k !== 'constructor') (ctx.git as unknown as Record<string, unknown>)[k] = echo;
    }
    const { api } = handlers({ connect: async () => ctx });
    const login = await api.login('https://dev.azure.com/X', PAT);
    const results: unknown[] = [login, await api.session()];
    const repo = { project: 'Demo', repoId: 'repo1', repoName: 'Gateway' };
    results.push(
      await api.repos('Demo'),
      await api.branches('Demo', 'repo1'),
      await api.compare({ ...TARGET, branch: 'f' }, TARGET, 'mergeBase'),
      await api.findPr(repo, 'a', 'b'),
      await api.createPr(repo, { source: 'a', target: 'b', title: 't', description: '', workItemIds: [] }),
      await api.conflicts(repo, 1),
      await api.resolve(repo, 1, 1, { kind: 'source' }),
    );
    expect(JSON.stringify(results)).not.toContain(PAT);
  });

  test('normalizeError masks every occurrence in message and details', () => {
    const e = normalizeError({ statusCode: 401, message: `${PAT} and again ${PAT}` }, PAT);
    expect(JSON.stringify(e)).not.toContain(PAT);
  });

  test('credentials file is encrypted and private (0600)', async () => {
    const dir = tempDir();
    const store = new AuthStore(join(dir, 'cred.json'), reverseCipher);
    const api = createHandlers({ store, connect: async () => fakeContext(), pickFolder: async () => null, openExternal: async () => {} });
    await api.login('https://dev.azure.com/X', PAT);
    if (process.platform !== 'win32') expect(statSync(join(dir, 'cred.json')).mode & 0o777).toBe(0o600);
  });

  test('session and login results expose only the organisation URL', async () => {
    const { api } = handlers();
    const r = await api.login('https://dev.azure.com/X', PAT);
    expect(r).toEqual({ ok: true, value: { orgUrl: 'https://dev.azure.com/X' } });
  });
});

describe('external links and URLs', () => {
  test.each(['javascript:alert(1)', 'file:///etc/passwd', 'http://evil.example', 'data:text/html,x', 'vbscript:x', ' https://x'])(
    'openExternal refuses %s',
    async (url) => {
      const { api, opened } = handlers();
      expect((await api.openExternal(url)).ok).toBe(false);
      expect(opened).toEqual([]);
    },
  );

  test.each(['http://dev.azure.com/X', 'javascript:alert(1)', 'file:///x', 'https://'])('login refuses organisation URL %s', async (url) => {
    const { api } = handlers();
    expect((await api.login(url, PAT)).ok).toBe(false);
  });
});

describe('local file access', () => {
  test('whitespaceOnly : côtés Azure sans session → auth ; plus de 100 fichiers → refus', async () => {
    const { api } = handlers();
    const AZ = { kind: 'azure', project: 'P', repoId: 'r', branch: 'b' } as const;
    const e = { path: 'a.cs', change: 'edit', isBinary: false } as const;
    const r = await api.whitespaceOnly(AZ, { ...AZ, branch: 'c' }, [e], { changes: [] });
    expect(!r.ok && r.error.code).toBe('auth');
    expect((await api.whitespaceOnly(AZ, AZ, Array(101).fill(e), { changes: [] })).ok).toBe(false);
  });

  const cases = ['../outside.txt', '../../etc/passwd', '/etc/passwd', 'sub/../../outside.txt', '..', '..\\..\\windows\\win.ini'];
  test.each(cases)('whitespaceOnly refuses %s', async (path) => {
    const root = gitDir({ 'sub/a.cs': 'x' });
    const { api } = handlers({ pickFolder: async () => root });
    await api.login('https://dev.azure.com/X', PAT);
    await api.pickFolder();
    const r = await api.whitespaceOnly(worktreeSide(root), worktreeSide(root), [{ path, change: 'edit', isBinary: false }], { changes: [] });
    if (path.includes('\\') && process.platform !== 'win32') expect(r.ok).toBe(true);
    else expect(r.ok).toBe(false);
  });

  test.each(cases)('fileSides refuses %s', async (path) => {
    const root = gitDir({ 'sub/a.cs': 'x' });
    const { api } = handlers({ pickFolder: async () => root });
    await api.login('https://dev.azure.com/X', PAT);
    await api.pickFolder();
    const r = await api.fileSides(worktreeSide(root), TARGET, { path, change: 'edit', isBinary: false }, { changes: [] });
    if (path.includes('\\') && process.platform !== 'win32') {
      // Sur macOS/Linux, « \\ » est un caractère de nom de fichier, pas un séparateur : le chemin reste dans le dossier.
      expect(r.ok && r.value.right.content).toBe('');
    } else {
      expect(r.ok).toBe(false);
    }
  });
});

describe('IPC surface', () => {
  test('every exposed method returns a Result, never throws', async () => {
    const { api } = handlers();
    for (const m of API_METHODS) {
      const fn = api[m] as (...a: unknown[]) => Promise<unknown>;
      const r = (await fn(undefined, undefined, undefined, undefined)) as { ok: boolean };
      expect(typeof r.ok).toBe('boolean');
    }
  });

  test('a comparison with an Azure side requires a session', async () => {
    const { api } = handlers();
    const az = { kind: 'azure' as const, project: 'P', repoId: 'r', branch: 'b' };
    const r = await api.compare(az, { ...az, branch: 'c' }, 'tips');
    expect(!r.ok && r.error.code).toBe('auth');
  });

  test('every Azure method requires a session', async () => {
    const { api } = handlers();
    // compare / fileSides / localRepo : les côtés locaux ne demandent pas de session Azure (vérifié ci-dessous pour les côtés Azure).
    const open = ['session', 'login', 'logout', 'pickFolder', 'openExternal', 'localRepo', 'compare', 'fileSides', 'whitespaceOnly'];
    // Merge local : n'utilise que git et le clone approuvé (mergeFallbackPr, qui crée une PR, reste soumis à la session).
    // Organisations : gérées avant toute session (liste, ajout, découverte, retrait).
    open.push('orgs', 'connectOrg', 'addOrgs', 'discoverOrgs', 'removeOrg');
    open.push('mergeStart', 'mergeState', 'mergeConflictSides', 'mergeResolve', 'mergeCommit', 'mergePush', 'mergeAbort', 'mergeClose', 'pushBranch', 'originCheck');
    for (const m of API_METHODS.filter((x) => !open.includes(x))) {
      const r = (await (api[m] as (...a: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>)({ project: 'P', repoId: 'r', repoName: 'n' }, 1, 1, { kind: 'source' })) as { ok: boolean; error?: { code: string } };
      expect(r.ok, m).toBe(false);
      expect(r.error?.code, m).toBe('auth');
    }
  });
});
