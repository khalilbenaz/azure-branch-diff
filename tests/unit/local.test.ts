import { describe, test, expect } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { blobSha } from '../../src/main/local/blobSha';
import { listLocalFiles } from '../../src/main/local/listFiles';
import { getGitInfo } from '../../src/main/local/gitInfo';
import { hashLocalFiles } from '../../src/main/local/hashFiles';
import { tempDir } from './helpers';

const GIT = 'git -c user.email=t@t -c user.name=t';

describe('blobSha', () => {
  test('matches git hash-object, CRLF included', () => {
    const root = tempDir({ 'a.txt': 'hello\r\nworld\n' });
    const expected = execSync('git hash-object --no-filters a.txt', { cwd: root }).toString().trim();
    expect(blobSha(Buffer.from('hello\r\nworld\n'))).toBe(expected);
  });
  test('empty file', () => expect(blobSha(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'));
});

describe('listLocalFiles', () => {
  test('non-git folder excludes build dirs at any depth', async () => {
    const root = tempDir({ 'src/A.cs': 'x', 'bin/Debug/a.dll': 'x', 'src/Proj/obj/x': 'x', 'node_modules/p/i.js': 'x', '.vs/s': 'x' });
    expect(await listLocalFiles(root)).toEqual(['src/A.cs']);
  });
  test('git folder respects .gitignore, includes untracked, skips deleted', async () => {
    const root = tempDir({ '.gitignore': '*.log\n', 'a.cs': 'x', 'gone.cs': 'x', 'b.log': 'x', 'obj/z': 'x' });
    execSync(`git init -q && git add a.cs gone.cs .gitignore && ${GIT} commit -qm i`, { cwd: root });
    writeFileSync(join(root, 'new.cs'), 'y');
    rmSync(join(root, 'gone.cs'));
    expect(await listLocalFiles(root)).toEqual(['.gitignore', 'a.cs', 'new.cs']);
  });
  test('subfolder of a git repo lists paths relative to the chosen folder', async () => {
    const root = tempDir({ 'sub/x.cs': 'x', 'top.cs': 'y' });
    execSync('git init -q && git add .', { cwd: root });
    expect(await listLocalFiles(join(root, 'sub'))).toEqual(['x.cs']);
  });
});

describe('getGitInfo', () => {
  test('null outside git', async () => expect(await getGitInfo(tempDir({ a: '1' }))).toBeNull());
  test('branch and commit', async () => {
    const root = tempDir({ a: '1' });
    execSync(`git init -q -b dev && git add a && ${GIT} commit -q -m first`, { cwd: root });
    const info = await getGitInfo(root);
    expect(info?.branch).toBe('dev');
    expect(info?.subject).toBe('first');
    expect(info?.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('hashLocalFiles', () => {
  test('outside git: raw blob sha', async () => {
    const root = tempDir({ 'a.txt': 'x\r\n' });
    expect(await hashLocalFiles(root, ['a.txt'])).toEqual(new Map([['a.txt', blobSha(Buffer.from('x\r\n'))]]));
  });
  test('inside git with autocrlf: CRLF working file hashes like the LF blob', async () => {
    const root = tempDir({ 'a.txt': 'x\r\ny\r\n', 'b.txt': 'z' });
    execSync('git init -q && git config core.autocrlf true', { cwd: root });
    const m = await hashLocalFiles(root, ['a.txt', 'b.txt']);
    expect(m.get('a.txt')).toBe(blobSha(Buffer.from('x\ny\n')));
    expect(m.get('b.txt')).toBe(blobSha(Buffer.from('z')));
  });
  test('missing file is skipped', async () => {
    const root = tempDir({ 'a.txt': 'x' });
    expect([...(await hashLocalFiles(root, ['a.txt', 'nope.txt'])).keys()]).toEqual(['a.txt']);
  });
});
