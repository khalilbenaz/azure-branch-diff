import { test, expect } from 'vitest';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, repoInfo, refSpec, refName, resolveCommit } from '../../src/main/local/repo';
import { normalizeError } from '../../src/main/errors';
import { makeOrigin, git, writeFile } from './gitFixtures';
import { tempDir } from './helpers';

test('repoRoot : racine réelle depuis un sous-dossier ; erreur hors git', async () => {
  const { clone } = makeOrigin();
  mkdirSync(join(clone, 'src', 'deep'), { recursive: true });
  expect(await repoRoot(join(clone, 'src', 'deep'))).toBe(realpathSync.native(clone));
  await repoRoot(tempDir()).then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).message).toMatch(/pas un dépôt git/),
  );
});

test('repoInfo : branches locales, origin, branche courante, propreté, origin url', async () => {
  const { clone, bare } = makeOrigin();
  git(clone, 'branch', 'local-only');
  let info = await repoInfo(clone);
  expect(info.current).toBe('master');
  expect(info.branches).toEqual(['local-only', 'master']);
  expect(info.remoteBranches).toEqual(['feature/data', 'master']);
  expect(info.dirty).toBe(false);
  expect(info.originUrl).toBe(bare);
  writeFile(clone, 'README.md', 'changed\n');
  info = await repoInfo(clone);
  expect(info.dirty).toBe(true);
});

test('refSpec / refName', () => {
  expect(refSpec({ type: 'branch', name: 'feature/x' })).toBe('refs/heads/feature/x');
  expect(refSpec({ type: 'remote', name: 'feature/x' })).toBe('refs/remotes/origin/feature/x');
  expect(refSpec({ type: 'worktree' })).toBe('HEAD');
  expect(refName({ type: 'remote', name: 'master' })).toBe('origin/master');
  expect(refName({ type: 'worktree' })).toBe('copie de travail');
  expect(() => refSpec({ type: 'branch', name: '-x' })).toThrow();
  expect(() => refSpec({ type: 'branch', name: 'a..b' })).toThrow();
});

test('resolveCommit renvoie le SHA de la référence', async () => {
  const { clone } = makeOrigin();
  const sha = await resolveCommit(clone, { type: 'remote', name: 'feature/data' });
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  expect(sha).toBe(git(clone, 'rev-parse', 'origin/feature/data'));
});

import { mkdirSync as mk } from 'node:fs';

test('dossier parent de plusieurs clones : les dépôts trouvés sont proposés', async () => {
  const parent = tempDir();
  for (const n of ['api', 'web']) {
    mk(join(parent, n));
    git(join(parent, n), 'init', '-q');
  }
  mk(join(parent, 'docs'));
  await repoRoot(parent).then(
    () => expect.unreachable(),
    (e) => {
      const m = normalizeError(e).message;
      expect(m).toMatch(/pas un dépôt git/);
      expect(m).toContain(parent);
      expect(m).toMatch(/api.*web/);
      expect(m).not.toMatch(/docs/);
    },
  );
});

test('git absent : message explicite', async () => {
  const before = process.env.PATH;
  process.env.PATH = tempDir();
  process.env.ABD_NO_GIT_EXTRA_PATH = '1';
  try {
    await repoRoot(tempDir()).then(
      () => expect.unreachable(),
      (e) => expect(normalizeError(e).message).toMatch(/git est introuvable/),
    );
  } finally {
    process.env.PATH = before;
    delete process.env.ABD_NO_GIT_EXTRA_PATH;
  }
});
