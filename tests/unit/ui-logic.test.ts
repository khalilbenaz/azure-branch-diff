import { test, expect } from 'vitest';
import { parseWorkItems, toResolution } from '../../src/renderer/src/lib/prLogic';

test('parseWorkItems accepts commas, spaces, semicolons; empty → []', () => {
  expect(parseWorkItems('1234, 5678 9012;7')).toEqual([1234, 5678, 9012, 7]);
  expect(parseWorkItems('  ')).toEqual([]);
});
test('parseWorkItems rejects non-numeric or zero', () => {
  expect(parseWorkItems('12, abc')).toBeNull();
  expect(parseWorkItems('0')).toBeNull();
  expect(parseWorkItems('-3')).toBeNull();
});
test('toResolution picks a whole side when identical, else edited content', () => {
  expect(toResolution('s', 's', 't')).toEqual({ kind: 'source' });
  expect(toResolution('t', 's', 't')).toEqual({ kind: 'target' });
  expect(toResolution('mix', 's', 't')).toEqual({ kind: 'content', text: 'mix' });
});

import { azureFileBranch } from '../../src/renderer/src/lib/prLogic';

const T = { kind: 'azure' as const, project: 'P', repoId: 'r', branch: 'master' };
const S = { kind: 'azure' as const, project: 'P', repoId: 'r', branch: 'feature/x' };
test('azureFileBranch: where the file exists on Azure (null if nowhere)', () => {
  expect(azureFileBranch({ path: 'a', change: 'edit', isBinary: false }, S, T)).toBe('feature/x');
  expect(azureFileBranch({ path: 'a', change: 'delete', isBinary: false }, S, T)).toBe('master');
  const L = { kind: 'local' as const, path: '/x' };
  expect(azureFileBranch({ path: 'a', change: 'edit', isBinary: false }, L, T)).toBe('master');
  expect(azureFileBranch({ path: 'a', change: 'delete', isBinary: false }, L, T)).toBe('master');
  expect(azureFileBranch({ path: 'a', change: 'add', isBinary: false }, L, T)).toBeNull();
});
