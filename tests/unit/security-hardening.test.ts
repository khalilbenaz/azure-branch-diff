import { test, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { fakeContext } from '../../src/main/azure/fake';
import { listLocalFiles } from '../../src/main/local/listFiles';
import { hashLocalFiles } from '../../src/main/local/hashFiles';
import { getGitInfo } from '../../src/main/local/gitInfo';
import { compareLocalToAzure } from '../../src/main/compare/compareLocal';
import { normalizeError } from '../../src/main/errors';
import { isSafeExternalUrl } from '../../src/main/urls';
import { blobSha } from '../../src/main/local/blobSha';
import { tempDir, reverseCipher, gitDir, worktreeSide } from './helpers';

const TARGET = { kind: 'azure' as const, project: 'Demo', repoId: 'repo1', branch: 'master' };

function setup(picked: string | null) {
  return createHandlers({
    store: new AuthStore(join(tempDir(), 'c.json'), reverseCipher),
    connect: async () => fakeContext(),
    pickFolder: async () => picked,
    openExternal: async () => {},
  });
}

test('M1: un dossier local non choisi via la boîte de dialogue est refusé', async () => {
  const chosen = gitDir({ 'a.cs': 'x' });
  const other = gitDir({ 'secret.txt': 'secret' });
  const api = setup(chosen);
  await api.login('https://dev.azure.com/X', 'pat');
  const before = await api.compare(worktreeSide(chosen), TARGET, 'tips');
  expect(before.ok).toBe(false);
  await api.pickFolder();
  expect((await api.compare(worktreeSide(chosen), TARGET, 'tips')).ok).toBe(true);
  const r = await api.fileSides(worktreeSide(other), TARGET, { path: 'secret.txt', change: 'add', isBinary: false }, { changes: [] });
  expect(r.ok).toBe(false);
  expect(JSON.stringify(r)).not.toContain('secret');
  expect((await api.compare({ kind: 'local', root: '/', ref: { type: 'worktree' } }, TARGET, 'tips')).ok).toBe(false);
});

test('M1: les arguments IPC de mauvais type sont refusés proprement', async () => {
  const api = setup(null);
  await api.login('https://dev.azure.com/X', 'pat');
  const repo = { project: 'Demo', repoId: 'repo1', repoName: 'Gateway' };
  for (const r of [
    await api.repos(42 as unknown as string),
    await api.branches('Demo', { $ne: 1 } as unknown as string),
    await api.conflicts(repo, '1; drop' as unknown as number),
    await api.resolve(repo, 1, 1.5, { kind: 'source' }),
    await api.resolve(repo, 1, 1, { kind: 'content', text: 3 } as unknown as { kind: 'content'; text: string }),
    await api.findPr({ project: 1 } as unknown as typeof repo, 'a', 'b'),
  ]) {
    expect(r.ok).toBe(false);
  }
});

test('M2: un dossier piégé (filtre git, fsmonitor, hooks) n’exécute aucune commande', async () => {
  const root = tempDir({ 'a.cs': 'class A {}\r\n', '.gitattributes': '*.cs filter=evil\n' });
  const marker = join(root, 'PWNED');
  execSync('git init -q', { cwd: root });
  execSync(`git config filter.evil.clean "touch '${marker}-filter'; cat"`, { cwd: root });
  execSync(`git config core.fsmonitor "touch '${marker}-fsmonitor'"`, { cwd: root });
  execSync('git config core.autocrlf true', { cwd: root });
  await listLocalFiles(root);
  const m = await hashLocalFiles(root, ['a.cs']);
  await getGitInfo(root);
  await compareLocalToAzure(root, []);
  expect(existsSync(`${marker}-filter`)).toBe(false);
  expect(existsSync(`${marker}-fsmonitor`)).toBe(false);
  // Sans filtre, autocrlf reste appliqué : le CRLF local équivaut au blob LF.
  expect(m.get('a.cs')).toBe(blobSha(Buffer.from('class A {}\n')));
});

test('L8: un nom de fichier contenant un saut de ligne ne décale pas les SHA', async () => {
  if (process.platform === 'win32') return; // nom interdit sous Windows
  const root = tempDir({ 'a.cs': 'A', 'we\nird.cs': 'W', 'z.cs': 'Z' });
  execSync('git init -q', { cwd: root });
  const m = await hashLocalFiles(root, ['a.cs', 'we\nird.cs', 'z.cs']);
  expect(m.get('a.cs')).toBe(blobSha(Buffer.from('A')));
  expect(m.get('we\nird.cs')).toBe(blobSha(Buffer.from('W')));
  expect(m.get('z.cs')).toBe(blobSha(Buffer.from('Z')));
});

test('L7: un lien symbolique vers l’extérieur n’est pas lu pour détecter le binaire', async () => {
  if (process.platform === 'win32') return;
  const outside = tempDir({ 'bin.dat': Buffer.from([0, 1, 2]) });
  const root = tempDir({});
  execSync(`ln -s '${join(outside, 'bin.dat')}' link.dat`, { cwd: root });
  const r = await compareLocalToAzure(root, []);
  expect(r).toEqual([{ path: 'link.dat', change: 'add', isBinary: false, sizeBytes: 0 }]);
});

test('L6: le jeton est aussi masqué sous sa forme Basic (base64)', () => {
  const pat = 'abcSECRET123';
  const b64 = Buffer.from(`:${pat}`).toString('base64');
  expect(JSON.stringify(normalizeError(new Error(`Authorization: Basic ${b64}`), pat))).not.toContain(b64);
});

test('L4: liens externes : https uniquement, sans identifiants, URL valide', () => {
  expect(isSafeExternalUrl('https://dev.azure.com/o/p/_git/r/pullrequest/1')).toBe(true);
  expect(isSafeExternalUrl('https://user:pass@evil.example/')).toBe(false);
  expect(isSafeExternalUrl('https://')).toBe(false);
  expect(isSafeExternalUrl('http://dev.azure.com')).toBe(false);
  expect(isSafeExternalUrl('HTTPS://dev.azure.com/x')).toBe(true);
  expect(isSafeExternalUrl('javascript:alert(1)//https://')).toBe(false);
});

test('M2: un filtre caché derrière include.path n’est pas exécuté non plus', async () => {
  const root = tempDir({ 'a.cs': 'x\n', '.gitattributes': '*.cs filter=evil\n' });
  const marker = join(root, 'PWNED-include');
  execSync('git init -q', { cwd: root });
  writeFileSync(join(root, '.git', 'evil.conf'), `[filter "evil"]\n\tclean = touch '${marker}'; cat\n`);
  execSync('git config include.path evil.conf', { cwd: root });
  await hashLocalFiles(root, ['a.cs']);
  expect(existsSync(marker)).toBe(false);
});
