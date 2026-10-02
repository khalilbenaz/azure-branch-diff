import { test, expect } from 'vitest';
import { isEolOnlyDiff, countLines, languageFor } from '../../src/renderer/src/lib/eol';

test('isEolOnlyDiff', () => {
  expect(isEolOnlyDiff('a\r\nb', 'a\nb')).toBe(true);
  expect(isEolOnlyDiff('a', 'b')).toBe(false);
  expect(isEolOnlyDiff('a', 'a')).toBe(false);
});

test('countLines', () => {
  expect(countLines('a\nb\n', 'a\nc\nd\n')).toEqual({ added: 2, removed: 1 });
  expect(countLines('', 'x\ny\n')).toEqual({ added: 2, removed: 0 });
  expect(countLines('x\n', '')).toEqual({ added: 0, removed: 1 });
});

test('languageFor', () => {
  expect(languageFor('src/A.cs')).toBe('csharp');
  expect(languageFor('db/Script.SQL')).toBe('sql');
  expect(languageFor('Web.config')).toBe('xml');
  expect(languageFor('App.csproj')).toBe('xml');
  expect(languageFor('README')).toBe('plaintext');
});
