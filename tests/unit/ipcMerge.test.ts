import { test, expect } from 'vitest';
import { join } from 'node:path';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { fakeContext } from '../../src/main/azure/fake';
import type { Result } from '../../src/shared/types';
import { makeOrigin, git, commitFile, azureOrigin } from './gitFixtures';
import { tempDir, reverseCipher } from './helpers';

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

function setup(picked: string) {
  return createHandlers({
    store: new AuthStore(join(tempDir(), 'c.json'), reverseCipher),
    connect: async () => fakeContext(),
    pickFolder: async () => picked,
    openExternal: async () => {},
    confirm: async () => true,
  });
}

test('parcours de merge complet via l’API : démarrage, conflit, résolution, commit, push', async () => {
  const { clone, bare } = makeOrigin();
  commitFile(clone, 'src/Service.cs', 'class Service\n{\n    int Amount = 20;\n}\n', 'master change');
  git(clone, 'push', '-q', 'origin', 'master');
  git(clone, 'branch', 'tgt', 'master');
  git(clone, 'push', '-q', 'origin', 'tgt');
  const api = setup(clone);
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  const info = ok(await api.localRepo(clone));
  const st = ok(await api.mergeStart({ root: info.root, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' } }));
  expect(st.phase).toBe('conflicts');
  const again = await api.mergeStart({ root: info.root, source: { type: 'branch', name: 'master' }, target: { kind: 'local', branch: 'tgt' } });
  expect(!again.ok && again.error.message).toMatch(/déjà en cours/);
  const sides = ok(await api.mergeConflictSides('src/Service.cs'));
  expect(sides.source.content).toContain('Amount = 30');
  expect((await api.mergeResolve('../outside', { kind: 'source' })).ok).toBe(false);
  ok(await api.mergeResolve('src/Service.cs', { kind: 'source' }));
  const committed = ok(await api.mergeCommit('Merge test'));
  expect(committed.phase).toBe('committed');
  const pushed = ok(await api.mergePush());
  expect(pushed.phase).toBe('pushed');
  expect(git(bare, 'rev-parse', 'tgt')).toBe(committed.commit);
  ok(await api.mergeClose());
  expect(ok(await api.mergeState())).toBeNull();
});

test('mergeStart refuse un clone non approuvé et des références invalides', async () => {
  const { clone } = makeOrigin();
  const api = setup(tempDir());
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  expect((await api.mergeStart({ root: clone, source: { type: 'branch', name: 'master' }, target: { kind: 'local', branch: 'x' } })).ok).toBe(false);
  const api2 = setup(clone);
  ok(await api2.login('https://dev.azure.com/X', 'pat'));
  ok(await api2.pickFolder());
  const root = ok(await api2.localRepo(clone)).root;
  for (const bad of [
    { root, source: { type: 'branch', name: '--upload-pack=x' }, target: { kind: 'local', branch: 'x' } },
    { root, source: { type: 'worktree' }, target: { kind: 'local', branch: 'x' } },
    { root, source: { type: 'branch', name: 'master' }, target: { kind: 'other', branch: 'x' } },
  ]) {
    expect((await api2.mergeStart(bad as never)).ok).toBe(false);
  }
});

test('mergeAbort libère la session ; originCheck ; pushBranch', async () => {
  const { clone, bare } = makeOrigin();
  git(clone, 'branch', 'tgt', 'master');
  const api = setup(clone);
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  const root = ok(await api.localRepo(clone)).root;
  ok(await api.mergeStart({ root, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' } }));
  ok(await api.mergeAbort());
  expect(ok(await api.mergeState())).toBeNull();
  const REPO = { project: 'Demo', repoId: 'repo1', repoName: 'Gateway' };
  expect(ok(await api.originCheck(root, REPO))).toEqual({ matches: false, originUrl: bare });
  git(clone, 'checkout', '-q', '-b', 'mine');
  commitFile(clone, 'y.cs', 'y\n');
  // origin étranger : pas de push pour une PR
  expect((await api.pushBranch(root, 'mine', REPO)).ok).toBe(false);
  const restore = azureOrigin(clone, bare);
  try {
    expect(ok(await api.originCheck(root, REPO)).matches).toBe(true);
    ok(await api.pushBranch(root, 'mine', REPO));
  } finally {
    restore();
  }
  expect(git(bare, 'rev-parse', 'mine')).toBe(git(clone, 'rev-parse', 'mine'));
});

test('secours PR : le commit de merge part sur une branche dédiée puis la PR est créée', async () => {
  const { clone, bare } = makeOrigin();
  const restore = azureOrigin(clone, bare);
  const api = setup(clone);
  ok(await api.login('https://dev.azure.com/X', 'pat'));
  ok(await api.pickFolder());
  const root = ok(await api.localRepo(clone)).root;
  ok(await api.mergeStart({ root, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'remote', branch: 'master' } }));
  ok(await api.mergeCommit(''));
  const pr = ok(await api.mergeFallbackPr({ project: 'Demo', repoId: 'repo1', repoName: 'Gateway' }, 'Merge feature/data into master'));
  restore();
  expect(pr.sourceBranch).toMatch(/^merge\/feature-data-into-master-[0-9a-z]+$/);
  expect(pr.targetBranch).toBe('master');
  expect(git(bare, 'rev-parse', `refs/heads/${pr.sourceBranch}`)).toMatch(/^[0-9a-f]{40}$/);
});
