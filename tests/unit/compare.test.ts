import { test, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { fromAzureDiff } from '../../src/main/compare/fromAzureDiff';
import { compareLocalToAzure, isBinaryBuffer } from '../../src/main/compare/compareLocal';
import { blobSha } from '../../src/main/local/blobSha';
import { tempDir } from './helpers';

test('fromAzureDiff maps flags, skips folders, strips slash, sorts', () => {
  const r = fromAzureDiff([
    { changeType: 2, item: { path: '/src/B.cs', gitObjectType: 3 } },
    { changeType: 1, item: { path: '/src', isFolder: true } },
    { changeType: 1, item: { path: '/src', gitObjectType: 2 } },
    { changeType: 1, item: { path: '/src/A.cs', gitObjectType: 3 } },
    { changeType: 16, item: { path: '/old.sql', gitObjectType: 3 } },
    { changeType: 8 | 2, item: { path: '/new/N.cs', gitObjectType: 3 }, sourceServerItem: '/old/N.cs' },
  ]);
  expect(r.map((c) => [c.path, c.change, c.originalPath])).toEqual([
    ['new/N.cs', 'rename', 'old/N.cs'],
    ['old.sql', 'delete', undefined],
    ['src/A.cs', 'add', undefined],
    ['src/B.cs', 'edit', undefined],
  ]);
});

test('isBinaryBuffer', () => {
  expect(isBinaryBuffer(Buffer.from('abc'))).toBe(false);
  expect(isBinaryBuffer(Buffer.from([0x50, 0x00, 0x01]))).toBe(true);
});

test('compareLocalToAzure outside git: unchanged/edit/add/delete, CRLF counts as edit', async () => {
  const root = tempDir({ 'src/same.cs': 'a\n', 'src/crlf.cs': 'a\r\n', 'local-only.png': Buffer.from([1, 0, 2]) });
  const remote = [
    { path: 'src/same.cs', objectId: blobSha(Buffer.from('a\n')) },
    { path: 'src/crlf.cs', objectId: blobSha(Buffer.from('a\n')) },
    { path: 'remote-only.cs', objectId: blobSha(Buffer.from('r')) },
  ];
  const r = await compareLocalToAzure(root, remote);
  expect(r.map((c) => [c.path, c.change, c.isBinary])).toEqual([
    ['local-only.png', 'add', true],
    ['remote-only.cs', 'delete', false],
    ['src/crlf.cs', 'edit', false],
  ]);
  expect(r[2].sizeBytes).toBe(3);
});

test('compareLocalToAzure inside git with autocrlf: CRLF file equal to LF blob is unchanged', async () => {
  const root = tempDir({ 'a.cs': 'a\r\nb\r\n' });
  execSync('git init -q && git config core.autocrlf true', { cwd: root });
  expect(await compareLocalToAzure(root, [{ path: 'a.cs', objectId: blobSha(Buffer.from('a\nb\n')) }])).toEqual([]);
});
