import { test, expect } from 'vitest';
import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { assertSafeRepo } from '../../src/main/merge/safety';
import { MergeSession } from '../../src/main/merge/session';
import { cleanGitMessage, pushLocalBranch } from '../../src/main/merge/origin';
import { repoInfo } from '../../src/main/local/repo';
import { localFileSide, WORKTREE } from '../../src/main/local/localDiff';
import { createHandlers } from '../../src/main/ipc';
import { AuthStore } from '../../src/main/auth';
import { fakeContext } from '../../src/main/azure/fake';
import { normalizeError } from '../../src/main/errors';
import { makeOrigin, git, commitFile, writeFile, azureOrigin } from './gitFixtures';
import { tempDir, reverseCipher } from './helpers';

const refused = async (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e) => expect(normalizeError(e).message).toMatch(/refus|exécuterait|non autorisé|racine|\.git|ne peut pas être édité/i),
  );

test.each([
  ['filter.a.b.smudge', 'touch PWN'],
  ['merge.a.b.driver', 'touch PWN'],
  ['diff.a.b.textconv', 'cat'],
  ['credential.helper', '!touch PWN'],
  ['credential.https://x.helper', '!touch PWN'],
  ['core.askPass', '/tmp/pwn'],
  ['core.sshCommand', 'touch PWN'],
  ['core.gitProxy', 'touch PWN'],
  ['core.worktree', '/tmp'],
  ['core.alternateRefsCommand', 'touch PWN'],
  ['remote.origin.uploadpack', 'touch PWN'],
  ['remote.origin.receivepack', 'touch PWN'],
  ['remote.origin.proxy', 'http://evil'],
  ['url.https://evil/.insteadOf', 'https://dev.azure.com/'],
  ['url.https://evil/.pushInsteadOf', 'https://dev.azure.com/'],
  ['gpg.program', 'touch PWN'],
  ['gpg.ssh.program', 'touch PWN'],
  ['diff.external', 'touch PWN'],
  ['protocol.ext.allow', 'always'],
  ['include.path', '/tmp/x.conf'],
])('H1/H2 : config locale dangereuse refusée — %s', async (key, value) => {
  const { clone } = makeOrigin();
  git(clone, 'config', key, value);
  await refused(assertSafeRepo(clone));
});

test('H2 : la config de worktree (extensions.worktreeConfig) est aussi vérifiée', async () => {
  const { clone } = makeOrigin();
  git(clone, 'config', 'extensions.worktreeConfig', 'true');
  git(clone, 'config', '--worktree', 'filter.z.smudge', 'touch PWN');
  await refused(assertSafeRepo(clone));
});

test('H2 : un dépôt ordinaire est accepté', async () => {
  const { clone } = makeOrigin();
  git(clone, 'config', 'core.autocrlf', 'input');
  git(clone, 'config', 'branch.master.rebase', 'true');
  await expect(assertSafeRepo(clone)).resolves.toBeUndefined();
});

test('H3 : push et merge refusés sur un dépôt hostile, aucune commande exécutée', async () => {
  const { clone } = makeOrigin();
  const marker = join(clone, 'PWNED');
  git(clone, 'config', 'remote.origin.receivepack', `touch '${marker}'`);
  git(clone, 'checkout', '-q', '-b', 'mine');
  await refused(pushLocalBranch(clone, 'mine'));
  git(clone, 'branch', 'tgt', 'master');
  await refused(MergeSession.start({ root: clone, source: { type: 'remote', name: 'feature/data' }, target: { kind: 'local', branch: 'tgt' } }));
  expect(existsSync(marker)).toBe(false);
});

function handlers(picked: string, confirm = async () => true) {
  return createHandlers({
    store: new AuthStore(join(tempDir(), 'c.json'), reverseCipher),
    connect: async () => fakeContext(),
    pickFolder: async () => picked,
    openExternal: async () => {},
    confirm,
  });
}

test('M1 : un sous-dossier d’un dépôt n’approuve pas la racine ; un dépôt hostile est refusé à l’ouverture', async () => {
  const { clone } = makeOrigin();
  mkdirSync(join(clone, 'sub'));
  const api = handlers(join(clone, 'sub'));
  await api.login('https://dev.azure.com/X', 'pat');
  await api.pickFolder();
  const r = await api.localRepo(join(clone, 'sub'));
  expect(!r.ok && r.error.message).toMatch(/racine/);
  const hostile = makeOrigin().clone;
  git(hostile, 'config', 'core.worktree', tempDir());
  const api2 = handlers(hostile);
  await api2.login('https://dev.azure.com/X', 'pat');
  await api2.pickFolder();
  expect((await api2.localRepo(hostile)).ok).toBe(false);
});

test('M2 : un conflit sur un lien symbolique n’est ni éditable ni suivi', async () => {
  if (process.platform === 'win32') return;
  const { clone } = makeOrigin();
  writeFile(clone, 'target.txt', 'keep me\n');
  symlinkSync('target.txt', join(clone, 'link'));
  git(clone, 'add', 'target.txt', 'link');
  git(clone, 'commit', '-q', '-m', 'link');
  git(clone, 'checkout', '-q', '-b', 'src');
  git(clone, 'rm', '-q', 'link');
  symlinkSync('README.md', join(clone, 'link'));
  git(clone, 'add', 'link');
  git(clone, 'commit', '-q', '-m', 'link src');
  git(clone, 'checkout', '-q', 'master');
  git(clone, 'rm', '-q', 'link');
  symlinkSync('src/Service.cs', join(clone, 'link'));
  git(clone, 'add', 'link');
  git(clone, 'commit', '-q', '-m', 'link master');
  git(clone, 'branch', 'tgt', 'master');
  const s = await MergeSession.start({ root: clone, source: { type: 'branch', name: 'src' }, target: { kind: 'local', branch: 'tgt' } });
  try {
    expect(s.state().conflicts.find((c) => c.path === 'link')?.kind).toBe('binary');
    await refused(s.resolve('link', { kind: 'content', text: 'x' }));
    await s.resolve('link', { kind: 'delete' });
    expect(existsSync(join(s.state().dir, 'target.txt'))).toBe(true);
  } finally {
    await s.dispose();
  }
});

test('L1 : identifiants retirés de l’URL origin', async () => {
  const { clone } = makeOrigin();
  git(clone, 'remote', 'set-url', 'origin', 'https://user:S3CR3T@dev.azure.com/o/p/_git/r');
  expect((await repoInfo(clone)).originUrl).toBe('https://***@dev.azure.com/o/p/_git/r');
});

test('L2 : masquage même avec @ ou / dans le secret', () => {
  for (const u of ["fatal: 'https://user:p@ss@host/x' 403", "https://u:a/b@host/x"]) {
    const m = cleanGitMessage(u);
    expect(m).not.toMatch(/p@ss|a\/b|user:/);
  }
});

test('L3 : le push exige une confirmation native', async () => {
  const { clone, bare } = makeOrigin();
  const restore = azureOrigin(clone, bare);
  git(clone, 'checkout', '-q', '-b', 'mine');
  commitFile(clone, 'z.cs', 'z\n');
  const api = handlers(clone, async () => false);
  await api.login('https://dev.azure.com/X', 'pat');
  await api.pickFolder();
  const root = realpathSync.native(clone);
  expect((await api.localRepo(root)).ok).toBe(true);
  const r = await api.pushBranch(root, 'mine', { project: 'Demo', repoId: 'repo1', repoName: 'Gateway' });
  restore();
  expect(!r.ok && r.error.message).toMatch(/annulé/);
  expect(() => git(bare, 'rev-parse', 'mine')).toThrow();
});

test('L5 : lecture interdite dans .git', async () => {
  const { clone } = makeOrigin();
  await refused(localFileSide(clone, WORKTREE, '.git/config'));
  await refused(localFileSide(clone, WORKTREE, 'src/../.git/config'));
});

test('Windows : un clone ouvert par son chemin court (8.3, ex. RUNNER~1) est bien reconnu comme racine', async () => {
  if (process.platform !== 'win32') return;
  const { clone } = makeOrigin();
  const short = execSync(`cmd /c for %I in ("${clone}") do @echo %~sI`, { encoding: 'utf8' }).trim();
  const api = handlers(short);
  await api.login('https://dev.azure.com/X', 'pat');
  await api.pickFolder();
  const r = await api.localRepo(short);
  expect(r.ok).toBe(true);
});
