import { test, expect } from 'vitest';
import { join } from 'node:path';
import { createHandlers, type HandlerDeps } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { fakeContext } from '../../src/main/azure/fake';
import type { AzureSource, Result } from '../../src/shared/types';
import { tempDir, reverseCipher, gitDir, worktreeSide } from './helpers';

const TARGET: AzureSource = { kind: 'azure', project: 'Demo', repoId: 'repo1', branch: 'master' };
const SOURCE: AzureSource = { kind: 'azure', project: 'Demo', repoId: 'repo1', branch: 'feature/data' };
const REPO = { project: 'Demo', repoId: 'repo1', repoName: 'Gateway' };

function setup(over: Partial<HandlerDeps> = {}) {
  const store = new AuthStore(join(tempDir(), 'cred.json'), reverseCipher);
  const opened: string[] = [];
  const api = createHandlers({
    store,
    connect: async () => fakeContext(),
    pickFolder: async () => '/tmp/x',
    openExternal: async (u) => void opened.push(u),
    ...over,
  });
  return { api, store, opened };
}

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

test('no session at start, login stores credentials, session restores after restart', async () => {
  const { api, store } = setup();
  expect(ok(await api.session())).toBeNull();
  expect(ok(await api.login('https://dev.azure.com/X/ ', 'pat'))).toEqual({ orgUrl: 'https://dev.azure.com/X' });
  expect(store.load()).toEqual({ orgUrl: 'https://dev.azure.com/X', pat: 'pat' });
  const restarted = createHandlers({ store, connect: async () => fakeContext(), pickFolder: async () => null, openExternal: async () => {} });
  expect(ok(await restarted.session())).toEqual({ orgUrl: 'https://dev.azure.com/X' });
});

test('login rejects non-https org url', async () => {
  const { api } = setup();
  const r = await api.login('http://dev.azure.com/X', 'pat');
  expect(r.ok).toBe(false);
});

test('calls before login fail with auth', async () => {
  const { api } = setup();
  const r = await api.projects();
  expect(!r.ok && r.error.code).toBe('auth');
});

test('auth error during session resets the session', async () => {
  const ctx = fakeContext();
  const { api } = setup({ connect: async () => ctx });
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ctx.core.getProjects = async () => {
    throw { statusCode: 401, message: 'nope' };
  };
  const r = await api.projects();
  expect(!r.ok && r.error.code).toBe('auth');
  expect((await api.repos('Demo')).ok).toBe(false);
});

test('PAT never appears in error messages', async () => {
  const { api } = setup({
    connect: async (_u, pat) => {
      throw new Error(`bad credentials ${pat}`);
    },
  });
  const r = await api.login('https://dev.azure.com/X', 'super-secret-pat');
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain('super-secret-pat');
});

test('logout keeps saved organisations; removing the last one forgets its PAT', async () => {
  const { api, store } = setup();
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.logout());
  expect(store.load()).toEqual({ orgUrl: 'https://dev.azure.com/X', pat: 'pat' });
  ok(await api.removeOrg('https://dev.azure.com/X'));
  expect(store.load()).toBeNull();
  expect(ok(await api.session())).toBeNull();
});

test('compare azure↔azure and file sides (edit, add, delete)', async () => {
  const { api } = setup();
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  const cmp = ok(await api.compare(SOURCE, TARGET, 'mergeBase'));
  expect(cmp.baseCommit).toBe('base000');
  const byPath = Object.fromEntries(cmp.changes.map((c) => [c.path, c]));
  const edit = ok(await api.fileSides(SOURCE, TARGET, byPath['src/Service.cs'], cmp));
  expect(edit.left.content).toContain('Amount => 10');
  expect(edit.right.content).toContain('Export csv');
  const add = ok(await api.fileSides(SOURCE, TARGET, byPath['src/Data.cs'], cmp));
  expect(add.left.content).toBe('');
  const del = ok(await api.fileSides(SOURCE, TARGET, byPath['old.sql'], cmp));
  expect(del.right.content).toBe('');
  expect(del.left.content).toContain('select 1');
});

test('compare refuses branches from two different repositories', async () => {
  const { api } = setup();
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  const r = await api.compare({ ...SOURCE, repoId: 'other' }, TARGET, 'mergeBase');
  expect(r.ok).toBe(false);
});

test('compare local↔azure and local file sides', async () => {
  const root = gitDir({ 'src/Service.cs': 'local version\n', 'old.sql': 'select 1;\n', 'mine.cs': 'new\n' });
  const { api } = setup({ pickFolder: async () => root });
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  const local = worktreeSide(root);
  const cmp = ok(await api.compare(local, TARGET, 'tips'));
  expect(cmp.changes.map((c) => [c.path, c.change])).toEqual([
    ['big.sql', 'delete'],
    ['mine.cs', 'add'],
    ['src/Service.cs', 'edit'],
  ]);
  const sides = ok(await api.fileSides(local, TARGET, cmp.changes[2], cmp));
  expect(sides.left.content).toContain('Amount => 20');
  expect(sides.right.content).toBe('local version\n');
});

test('local file sides refuse paths outside the chosen folder', async () => {
  const root = gitDir({ 'a.cs': 'x' });
  const { api } = setup({ pickFolder: async () => root });
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  const r = await api.fileSides(worktreeSide(root), TARGET, { path: '../../etc/passwd', change: 'edit', isBinary: false }, { changes: [] });
  expect(r.ok).toBe(false);
});

test('PR flow through handlers: create, wait, conflicts, resolve, urls', async () => {
  const { api, opened } = setup();
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  expect(ok(await api.findPr(REPO, 'feature/data', 'master'))).toBeNull();
  const pr = ok(await api.createPr(REPO, { source: 'feature/data', target: 'master', title: 't', description: '', workItemIds: [] }));
  expect(ok(await api.waitPr(REPO, pr.id)).mergeStatus).toBe('conflicts');
  const conflicts = ok(await api.conflicts(REPO, pr.id));
  expect(conflicts).toHaveLength(2);
  expect(ok(await api.conflictSides(REPO, pr.id, 1)).source.content).toContain('Export csv');
  ok(await api.resolve(REPO, pr.id, 1, { kind: 'source' }));
  const stale = await api.resolve(REPO, pr.id, 42, { kind: 'source' });
  expect(!stale.ok && stale.error.code).toBe('stale');
  expect(ok(await api.conflictsUrl(REPO, pr.id))).toBe('https://dev.azure.com/Fake/Demo/_git/Gateway/pullrequest/1?_a=conflicts');
  ok(await api.openExternal('https://dev.azure.com/Fake'));
  expect(opened).toEqual(['https://dev.azure.com/Fake']);
});

test('openExternal rejects non-https urls', async () => {
  const { api, opened } = setup();
  expect((await api.openExternal('file:///etc/passwd')).ok).toBe(false);
  expect(opened).toEqual([]);
});
