import { test, expect } from 'vitest';
import { realpathSync } from 'node:fs';
import { sameIgnoringWhitespace, whitespaceOnlyPaths } from '../../src/main/compare/whitespace';
import { compareSides } from '../../src/main/compare/compareSides';
import { toFileSide, EMPTY_SIDE } from '../../src/main/azure/diff';
import type { LocalSide } from '../../src/shared/types';
import { makeOrigin, git, commitFile } from './gitFixtures';

const fs = (s: string) => toFileSide(Buffer.from(s));

test('espaces seuls : indentation, lignes vides, fins de ligne, BOM → identiques', () => {
  expect(sameIgnoringWhitespace(fs('a b\n  c;\n'), fs('\n a  b\r\n\n\tc;   \r\n'))).toBe(true);
  expect(sameIgnoringWhitespace(fs('﻿using X;\n'), fs('using X;'))).toBe(true);
});

test('vraies différences → pas identiques', () => {
  expect(sameIgnoringWhitespace(fs('int x = 1;'), fs('int x = 2;'))).toBe(false);
  expect(sameIgnoringWhitespace(fs('int x'), fs('intx'))).toBe(false); // les mots restent séparés
  expect(sameIgnoringWhitespace(EMPTY_SIDE, fs('   \n'))).toBe(false); // fichier absent d'un côté
  expect(sameIgnoringWhitespace(toFileSide(Buffer.from([0, 1, 2])), toFileSide(Buffer.from([0, 1, 2])))).toBe(false); // binaire
});

test('whitespaceOnlyPaths : repère les fichiers modifiés uniquement par des espaces (local)', async () => {
  const { clone } = makeOrigin();
  git(clone, 'checkout', '-q', 'master');
  const svc = git(clone, 'show', 'master:src/Service.cs');
  git(clone, 'checkout', '-q', '-b', 'reformat');
  commitFile(clone, 'src/Service.cs', '\n' + svc.replace(/^ +/gm, '\t') + '\r\n\r\n');
  commitFile(clone, 'README.md', 'vraiment différent\n');
  const local = (ref: LocalSide['ref']): LocalSide => ({ kind: 'local', root: realpathSync.native(clone), ref });
  const src = local({ type: 'branch', name: 'reformat' });
  const tgt = local({ type: 'branch', name: 'master' });
  const cmp = await compareSides(null, src, tgt, 'tips');
  expect(cmp.changes.map((c) => c.path).sort()).toEqual(['README.md', 'src/Service.cs']);
  expect(await whitespaceOnlyPaths(null, src, tgt, cmp.changes, cmp)).toEqual(['src/Service.cs']);
});
