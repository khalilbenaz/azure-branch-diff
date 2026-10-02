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
  const L = { kind: 'local' as const, root: '/x', ref: { type: 'worktree' as const } };
  expect(azureFileBranch({ path: 'a', change: 'edit', isBinary: false }, L, T)).toBe('master');
  expect(azureFileBranch({ path: 'a', change: 'delete', isBinary: false }, L, T)).toBe('master');
  expect(azureFileBranch({ path: 'a', change: 'add', isBinary: false }, L, T)).toBeNull();
});

import { mergeInput, parseRefKey, refKey, toSide } from '../../src/renderer/src/lib/sides';

const CLONE = { root: '/c', git: true, current: 'dev', dirty: false, branches: ['dev', 'main'], remoteBranches: ['main'], originUrl: null };
const AZ = (branch: string) => ({ kind: 'azure' as const, project: 'P', repoId: 'r', branch });
const LO = (ref: Parameters<typeof refKey>[0] & object) => ({ kind: 'local' as const, root: '/c', ref });

test('refKey / parseRefKey aller-retour', () => {
  for (const r of [{ type: 'branch' as const, name: 'feature/x' }, { type: 'remote' as const, name: 'main' }, { type: 'worktree' as const }]) {
    expect(parseRefKey(refKey(r))).toEqual(r);
  }
  expect(parseRefKey('nope')).toBeNull();
});

test('toSide : informations manquantes → null', () => {
  expect(toSide({ kind: 'azure', branch: 'm' }, null, null)).toBeNull();
  expect(toSide({ kind: 'local', ref: null }, null, CLONE)).toBeNull();
  expect(toSide({ kind: 'local', ref: { type: 'worktree' } }, null, CLONE)).toEqual(LO({ type: 'worktree' }));
});

test('mergeInput : toutes les directions', () => {
  expect(mergeInput(AZ('f'), AZ('main'), CLONE)).toEqual({ input: { root: '/c', source: { type: 'remote', name: 'f' }, target: { kind: 'remote', branch: 'main' } } });
  expect(mergeInput(LO({ type: 'branch', name: 'dev' }), AZ('main'), CLONE)).toEqual({ input: { root: '/c', source: { type: 'branch', name: 'dev' }, target: { kind: 'remote', branch: 'main' } } });
  expect(mergeInput(AZ('f'), LO({ type: 'branch', name: 'dev' }), CLONE)).toEqual({ input: { root: '/c', source: { type: 'remote', name: 'f' }, target: { kind: 'local', branch: 'dev' } } });
  expect(mergeInput(LO({ type: 'remote', name: 'main' }), LO({ type: 'worktree' }), CLONE)).toEqual({ input: { root: '/c', source: { type: 'remote', name: 'main' }, target: { kind: 'local', branch: 'dev' } } });
  expect('reason' in mergeInput(LO({ type: 'worktree' }), AZ('main'), CLONE)).toBe(true);
  expect('reason' in mergeInput(AZ('f'), AZ('main'), null)).toBe(true);
  const plain = { ...CLONE, git: false, current: null, branches: [], remoteBranches: [] };
  const r = mergeInput(LO({ type: 'worktree' }), AZ('main'), plain);
  expect('reason' in r && r.reason).toMatch(/clone git/);
});
