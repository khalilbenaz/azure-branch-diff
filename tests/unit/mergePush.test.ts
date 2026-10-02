import { test, expect, afterEach } from 'vitest';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { MergeSession, cleanGitMessage } from '../../src/main/merge/session';
import { originMatches, pushLocalBranch } from '../../src/main/merge/origin';
import { normalizeError } from '../../src/main/errors';
import { makeOrigin, git, commitFile, writeFile } from './gitFixtures';

const sessions: MergeSession[] = [];
afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});
async function start(...a: Parameters<typeof MergeSession.start>) {
  const s = await MergeSession.start(...a);
  sessions.push(s);
  return s;
}

/** Refuse côté serveur tout push vers master (politique de branche simulée). */
function protectMaster(bare: string) {
  writeFile(bare, 'hooks/pre-receive', '#!/bin/sh\nwhile read old new ref; do [ "$ref" = "refs/heads/master" ] && { echo "TF402455: Pushes to this branch are not permitted" >&2; exit 1; }; done; exit 0\n');
  chmodSync(join(bare, 'hooks/pre-receive'), 0o755);
}

test('local → local puis push de la branche cible', async () => {
  const { clone, bare } = makeOrigin();
  git(clone, 'checkout', '-q', '-b', 'release', 'origin/master');
  git(clone, 'push', '-q', '-u', 'origin', 'release');
  git(clone, 'checkout', '-q', 'master');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'release' } });
  await s.commit('');
  await s.push();
  expect(s.state().phase).toBe('pushed');
  expect(git(bare, 'rev-parse', 'release')).toBe(s.state().commit);
});

test('Azure → Azure : fetch, worktree détaché sur origin/cible, push HEAD:cible', async () => {
  const { clone, bare } = makeOrigin();
  // Le serveur avance pendant ce temps : le merge doit partir de la dernière version.
  const other = join(clone, '..', 'other');
  git(join(clone, '..'), 'clone', '-q', bare, 'other');
  git(other, 'config', 'user.email', 'o@example.com');
  git(other, 'config', 'user.name', 'O');
  commitFile(other, 'NEWS.md', 'news\n', 'server moves');
  git(other, 'push', '-q', 'origin', 'master');
  const branchesBefore = git(clone, 'branch', '--list');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'remote', branch: 'master' } });
  expect(s.state().targetIsRemote).toBe(true);
  await s.commit('');
  await s.push();
  expect(git(bare, 'rev-parse', 'master')).toBe(s.state().commit);
  expect(git(bare, 'show', 'master:NEWS.md')).toBe('news');
  expect(git(bare, 'show', 'master:src/Data.cs')).toBe('class Data {}');
  expect(git(clone, 'branch', '--list')).toBe(branchesBefore); // aucune branche locale créée
});

test('push refusé par une politique → erreur policy ; secours : pousser sur une branche dédiée', async () => {
  const { clone, bare } = makeOrigin();
  protectMaster(bare);
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'remote', branch: 'master' } });
  await s.commit('');
  await s.push().then(
    () => expect.unreachable(),
    (e) => {
      expect(normalizeError(e).code).toBe('policy');
      expect(normalizeError(e).message).toMatch(/refusé/);
    },
  );
  expect(s.state().phase).toBe('committed');
  const name = await s.pushAsBranch('merge/feature-data-into-master');
  expect(git(bare, 'rev-parse', `refs/heads/${name}`)).toBe(s.state().commit);
});

test('local → Azure : pousser une branche locale (pour la PR)', async () => {
  const { clone, bare } = makeOrigin();
  git(clone, 'checkout', '-q', '-b', 'mine');
  commitFile(clone, 'x.cs', 'x\n');
  await pushLocalBranch(clone, 'mine');
  expect(git(bare, 'rev-parse', 'mine')).toBe(git(clone, 'rev-parse', 'mine'));
});

test('originMatches : formes d’URL Azure DevOps', () => {
  const org = 'https://dev.azure.com/Contoso';
  expect(originMatches('https://dev.azure.com/Contoso/Plate%20forme/_git/Gateway', org, 'Plate forme', 'Gateway')).toBe(true);
  expect(originMatches('https://Contoso@dev.azure.com/Contoso/Plateforme/_git/Gateway', org, 'Plateforme', 'Gateway')).toBe(true);
  expect(originMatches('https://contoso.visualstudio.com/Plateforme/_git/Gateway', org, 'Plateforme', 'Gateway')).toBe(true);
  expect(originMatches('https://contoso.visualstudio.com/DefaultCollection/Plateforme/_git/Gateway', org, 'Plateforme', 'Gateway')).toBe(true);
  expect(originMatches('git@ssh.dev.azure.com:v3/Contoso/Plateforme/Gateway', org, 'Plateforme', 'Gateway')).toBe(true);
  expect(originMatches('https://dev.azure.com/Contoso/Plateforme/_git/Other', org, 'Plateforme', 'Gateway')).toBe(false);
  expect(originMatches('https://dev.azure.com/Fabrikam/Plateforme/_git/Gateway', org, 'Plateforme', 'Gateway')).toBe(false);
  expect(originMatches(null, org, 'Plateforme', 'Gateway')).toBe(false);
});

test('les identifiants d’une URL sont masqués dans les messages git', () => {
  expect(cleanGitMessage("fatal: unable to access 'https://user:s3cr3t@dev.azure.com/x/': 403")).not.toContain('s3cr3t');
});
