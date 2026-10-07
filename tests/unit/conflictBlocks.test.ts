import { test, expect } from 'vitest';
import { conflictBlocks, applyChoice } from '../../src/renderer/src/lib/conflictBlocks';

const FILE = 'class A\n{\n<<<<<<< HEAD\n    int x = 20;\n=======\n    int x = 30;\n>>>>>>> cbac50f\n    int y;\n<<<<<<< HEAD\n    // main\n=======\n    // dev\n>>>>>>> cbac50f\n}\n';

test('conflictBlocks : lit chaque bloc (cible = HEAD, source = l’autre côté)', () => {
  const b = conflictBlocks(FILE);
  expect(b).toHaveLength(2);
  expect(b[0]).toMatchObject({ target: '    int x = 20;\n', source: '    int x = 30;\n', startLine: 3 });
  expect(b[1]).toMatchObject({ target: '    // main\n', source: '    // dev\n' });
});

test('applyChoice : remplace un bloc précis, garde le reste (y compris les retouches à la main)', () => {
  const edited = FILE.replace('    int y;', '    int y = 1; // retouché');
  const once = applyChoice(edited, 0, 'source');
  expect(once).toContain('    int x = 30;\n    int y = 1; // retouché');
  expect(conflictBlocks(once)).toHaveLength(1);
  const done = applyChoice(once, 0, 'both');
  expect(done).toBe('class A\n{\n    int x = 30;\n    int y = 1; // retouché\n    // main\n    // dev\n}\n');
  expect(conflictBlocks(done)).toHaveLength(0);
  expect(applyChoice(FILE, 1, 'target')).toContain('    // main\n}');
});

test('style diff3 (ancêtre) et fins de ligne CRLF', () => {
  const crlf = 'a\r\n<<<<<<< HEAD\r\nT\r\n||||||| base\r\nB\r\n=======\r\nS\r\n>>>>>>> x\r\nz\r\n';
  const [blk] = conflictBlocks(crlf);
  expect(blk).toMatchObject({ target: 'T\r\n', base: 'B\r\n', source: 'S\r\n' });
  expect(applyChoice(crlf, 0, 'target')).toBe('a\r\nT\r\nz\r\n');
});

test('marqueurs incomplets : ignorés (pas de bloc)', () => {
  expect(conflictBlocks('<<<<<<< HEAD\nx\n')).toHaveLength(0);
  expect(conflictBlocks('a <<<<<<< pas en début de ligne\n')).toHaveLength(0);
});
