import { test, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MergeSession } from '../../src/main/merge/session';
import { unsafeConfig } from '../../src/main/merge/safety';
import { normalizeError } from '../../src/main/errors';
import { makeOrigin, git, commitFile, writeFile } from './gitFixtures';

const sessions: MergeSession[] = [];
afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});
async function start(...args: Parameters<typeof MergeSession.start>) {
  const s = await MergeSession.start(...args);
  sessions.push(s);
  return s;
}
const expectError = (p: Promise<unknown>, re: RegExp) =>
  p.then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).message).toMatch(re),
  );

/** Clone où master et feature/data modifient la même ligne de Service.cs. */
function conflicting() {
  const o = makeOrigin();
  commitFile(o.clone, 'src/Service.cs', 'class Service\n{\n    int Amount = 20;\n}\n', 'master change');
  return o;
}

test('merge sans conflit d’une branche distante dans une branche locale non extraite → worktree, prêt', async () => {
  const { clone } = makeOrigin();
  git(clone, 'branch', 'release', 'master');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'release' } });
  const st = s.state();
  expect(st.phase).toBe('ready');
  expect(st.location).toBe('worktree');
  expect(st.dir).toContain('abd-merge-');
  expect(st.conflicts).toEqual([]);
  expect(git(clone, 'status', '--porcelain')).toBe(''); // copie de travail intacte
});

test('conflit texte : liste et contenus base / cible / source', async () => {
  const { clone } = conflicting();
  git(clone, 'branch', 'release', 'master');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'release' } });
  expect(s.state().phase).toBe('conflicts');
  expect(s.state().conflicts).toEqual([{ path: 'src/Service.cs', kind: 'text', resolved: false }]);
  const sides = await s.conflictSides('src/Service.cs');
  expect(sides.base.content).toContain('Amount = 10');
  expect(sides.target.content).toContain('Amount = 20');
  expect(sides.source.content).toContain('Amount = 30');
});

test('conflit modifié / supprimé et binaire', async () => {
  const { clone } = makeOrigin();
  commitFile(clone, 'img.bin', Buffer.from([0, 1, 2]), 'bin');
  git(clone, 'push', '-q', 'origin', 'master');
  git(clone, 'checkout', '-q', '-b', 'other');
  git(clone, 'rm', '-q', 'README.md');
  commitFile(clone, 'img.bin', Buffer.from([0, 9, 9]), 'bin other');
  git(clone, 'checkout', '-q', 'master');
  commitFile(clone, 'README.md', '# changed\n', 'readme master');
  commitFile(clone, 'img.bin', Buffer.from([0, 5, 5]), 'bin master');
  git(clone, 'branch', 'tgt', 'master');
  const s = await start({ root: clone, source: { type: 'branch', name: 'other' }, target: { kind: 'local', branch: 'tgt' } });
  expect(s.state().conflicts).toEqual([
    { path: 'img.bin', kind: 'binary', resolved: false },
    { path: 'README.md', kind: 'deleted', resolved: false },
  ]);
});

test('déjà à jour', async () => {
  const { clone } = makeOrigin();
  git(clone, 'branch', 'tgt', 'origin/feature/data');
  const s = await start({ root: clone, source: { type: 'branch', name: 'master' }, target: { kind: 'local', branch: 'tgt' } });
  expect(s.state().phase).toBe('upToDate');
});

test('cible extraite : merge en worktree, puis la copie de travail avance par fast-forward (modifs sans rapport conservées)', async () => {
  const { clone } = conflicting();
  writeFile(clone, 'README.md', 'wip\n'); // modification sans rapport avec le merge
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'master' } });
  expect(s.state().dir).not.toBe(s.state().root);
  expect(git(clone, 'status', '--porcelain')).toBe('M README.md'); // copie de travail jamais en état de merge
  await s.resolve('src/Service.cs', { kind: 'source' });
  await s.commit('');
  expect(git(clone, 'rev-parse', 'HEAD')).toBe(s.state().commit);
  expect(readFileSync(join(clone, 'src/Service.cs'), 'utf8')).toContain('Amount = 30');
  expect(readFileSync(join(clone, 'README.md'), 'utf8')).toBe('wip\n');
});

test('cible extraite modifiée sur un fichier du merge : commit conservé (ancre), branche et fichiers intacts', async () => {
  const { clone } = conflicting();
  const before = git(clone, 'rev-parse', 'HEAD');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'master' } });
  writeFile(clone, 'src/Service.cs', 'travail en cours\n');
  await s.resolve('src/Service.cs', { kind: 'source' });
  await expectError(s.commit(''), /n'a pas pu avancer/);
  expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
  expect(readFileSync(join(clone, 'src/Service.cs'), 'utf8')).toBe('travail en cours\n');
  expect(git(clone, 'for-each-ref', '--format=%(objectname)', 'refs/abd/merges/')).toBe(s.state().commit);
});

test('config hostile : merge refusé, aucune commande exécutée', async () => {
  const { clone } = makeOrigin();
  const marker = join(clone, 'PWNED');
  writeFile(clone, '.git/info/attributes', '*.cs merge=evil\n');
  git(clone, 'config', 'merge.evil.driver', `touch '${marker}'`);
  expect(await unsafeConfig(clone)).toEqual(['merge.evil.driver']);
  git(clone, 'branch', 'tgt', 'master');
  await expectError(MergeSession.start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' } }), /merge\.evil\.driver/);
  expect(existsSync(marker)).toBe(false);
});

test('identité git absente : message explicite', async () => {
  const { clone } = makeOrigin();
  git(clone, 'config', '--unset', 'user.email');
  git(clone, 'branch', 'tgt', 'master');
  const env = { HOME: join(clone, 'nohome'), XDG_CONFIG_HOME: join(clone, 'nohome'), GIT_CONFIG_NOSYSTEM: '1' };
  await expectError(
    MergeSession.start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' }, env }),
    /user\.email/,
  );
});

test('fichier lu tel quel (BOM conservé dans le contenu)', async () => {
  const { clone } = conflicting();
  git(clone, 'branch', 'release', 'master');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'release' } });
  expect(readFileSync(join(s.state().dir, 'src/Service.cs'), 'utf8')).toContain('<<<<<<<');
});

import { cleanupStaleMerges } from '../../src/main/merge/cleanup';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('résolution des conflits (contenu, source, cible, suppression) puis commit de merge à 2 parents', async () => {
  const { clone } = makeOrigin();
  commitFile(clone, 'src/Service.cs', 'class Service\n{\n    int Amount = 20;\n}\n', 'master change');
  commitFile(clone, 'a.txt', 'master\n', 'a');
  commitFile(clone, 'b.txt', 'master\n', 'b');
  commitFile(clone, 'c.txt', 'master\n', 'c');
  git(clone, 'checkout', '-q', '-b', 'src', 'origin/feature/data');
  commitFile(clone, 'a.txt', 'src\n', 'a');
  commitFile(clone, 'b.txt', 'src\n', 'b');
  commitFile(clone, 'c.txt', 'src\n', 'c');
  git(clone, 'checkout', '-q', 'master');
  git(clone, 'branch', 'tgt', 'master');
  const s = await start({ root: clone, source: { type: 'branch', name: 'src' }, target: { kind: 'local', branch: 'tgt' } });
  expect(s.state().conflicts.map((c) => c.path)).toEqual(['a.txt', 'b.txt', 'c.txt', 'src/Service.cs']);
  await expectError(s.commit('trop tôt'), /conflits/);
  await s.resolve('src/Service.cs', { kind: 'content', text: 'merged\n' });
  await s.resolve('a.txt', { kind: 'source' });
  await s.resolve('b.txt', { kind: 'target' });
  await s.resolve('c.txt', { kind: 'delete' });
  expect(s.state().conflicts.every((c) => c.resolved)).toBe(true);
  await s.commit("Merge branch 'src' into tgt");
  const st = s.state();
  expect(st.phase).toBe('committed');
  expect(git(clone, 'rev-parse', 'tgt')).toBe(st.commit);
  expect(git(clone, 'rev-list', '--parents', '-n', '1', 'tgt').split(' ')).toHaveLength(3);
  expect(git(clone, 'show', 'tgt:src/Service.cs')).toBe('merged');
  expect(git(clone, 'show', 'tgt:a.txt')).toBe('src');
  expect(git(clone, 'show', 'tgt:b.txt')).toBe('master');
  expect(() => git(clone, 'show', 'tgt:c.txt')).toThrow();
  expect(git(clone, 'log', '-1', '--format=%s', 'tgt')).toBe("Merge branch 'src' into tgt");
});

test('résolution par contenu refusée pour un binaire ; BOM de la cible conservé', async () => {
  const { clone } = makeOrigin();
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  commitFile(clone, 'bom.cs', Buffer.concat([bom, Buffer.from('a\n')]), 'bom');
  commitFile(clone, 'img.bin', Buffer.from([0, 1]), 'bin');
  git(clone, 'checkout', '-q', '-b', 'src');
  commitFile(clone, 'bom.cs', Buffer.concat([bom, Buffer.from('src\n')]), 'bom src');
  commitFile(clone, 'img.bin', Buffer.from([0, 2]), 'bin src');
  git(clone, 'checkout', '-q', 'master');
  commitFile(clone, 'bom.cs', Buffer.concat([bom, Buffer.from('master\n')]), 'bom master');
  commitFile(clone, 'img.bin', Buffer.from([0, 3]), 'bin master');
  git(clone, 'branch', 'tgt', 'master');
  const s = await start({ root: clone, source: { type: 'branch', name: 'src' }, target: { kind: 'local', branch: 'tgt' } });
  await expectError(s.resolve('img.bin', { kind: 'content', text: 'x' }), /binaire|éditer/);
  const sides = await s.conflictSides('bom.cs');
  expect(sides.target.bom).toBe(true);
  await s.resolve('bom.cs', { kind: 'content', text: 'merged\n' });
  expect(readFileSync(join(s.state().dir, 'bom.cs')).subarray(0, 3)).toEqual(bom);
});

test('annulation : branche cible inchangée, worktree supprimé', async () => {
  const { clone } = makeOrigin();
  commitFile(clone, 'src/Service.cs', 'class Service\n{\n    int Amount = 20;\n}\n', 'master change');
  git(clone, 'branch', 'tgt', 'master');
  const before = git(clone, 'rev-parse', 'tgt');
  const s = await start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' } });
  const dir = s.state().dir;
  await s.abort();
  expect(s.state().phase).toBe('aborted');
  expect(existsSync(dir)).toBe(false);
  expect(git(clone, 'rev-parse', 'tgt')).toBe(before);
  expect(git(clone, 'worktree', 'list')).not.toContain('abd-merge-');
});

test('nettoyage des worktrees orphelins (crash pendant un merge)', async () => {
  const { clone } = makeOrigin();
  git(clone, 'branch', 'tgt', 'master');
  const s = await MergeSession.start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' } });
  const dir = s.state().dir;
  // « crash » : la session n'est jamais fermée
  await cleanupStaleMerges([clone]);
  expect(existsSync(dir)).toBe(false);
  expect(git(clone, 'worktree', 'list')).not.toContain('abd-merge-');
  expect(readdirSync(tmpdir()).some((d) => join(tmpdir(), d) === dir)).toBe(false);
});
